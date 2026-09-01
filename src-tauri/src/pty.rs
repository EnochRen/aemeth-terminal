//! PTY session management.
//!
//! Each app session is a pseudo-terminal spawned via `portable-pty` (ConPTY on
//! Windows). Output is streamed to the webview as base64-encoded `pty://output`
//! events; the frontend (xterm.js) renders them and pipes input back through
//! `pty_write`. The reaper thread observes process exit and emits `pty://exit`.

use std::{
    collections::{HashMap, HashSet, VecDeque},
    io::{Read, Write},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use parking_lot::Mutex;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::shells::{resolve_shell, ShellKind};

pub const EVENT_OUTPUT: &str = "pty://output";
pub const EVENT_EXIT: &str = "pty://exit";
pub const EVENT_PORTS: &str = "pty://ports";

const PORTS_POLL_MS: u64 = 2000;

const INITIAL_COLS: u16 = 110;
const INITIAL_ROWS: u16 = 28;
// Large on purpose: each read becomes one IPC event to the webview. Chatty
// services (dev servers) used to flood the event queue with 16 KiB events,
// and window-close events had to wait behind that backlog. 256 KiB keeps the
// queue shallow without adding latency for interactive output.
const READ_BUF_SIZE: usize = 256 * 1024;

/// One preset command line that is typed into the shell after startup.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetCommand {
    pub command: String,
    /// Milliseconds to wait after sending this line before the next one.
    #[serde(default)]
    pub delay_ms: u64,
}

/// Everything needed to spawn a session for an app.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSpec {
    pub app_id: String,
    pub name: String,
    pub shell: ShellKind,
    #[serde(default)]
    pub cwd: Option<String>,
    /// Milliseconds to wait for the shell prompt before sending preset commands.
    #[serde(default)]
    pub startup_delay_ms: u64,
    #[serde(default)]
    pub commands: Vec<PresetCommand>,
    /// Application kind ("service" | "script").
    #[serde(default = "default_kind")]
    pub app_kind: String,
    /// Environment variables injected into the shell.
    #[serde(default)]
    pub env_vars: Option<std::collections::HashMap<String, String>>,
    /// Health‑check URL (GET, any 2xx response is considered healthy).
    #[serde(default)]
    pub health_check_url: Option<String>,
}

fn default_kind() -> String {
    "service".into()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionState {
    Running,
    Exited,
}

/// Snapshot of a session's lifecycle state, mirrored to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStatus {
    pub session_id: String,
    pub app_id: String,
    pub name: String,
    pub shell: ShellKind,
    pub state: SessionState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    /// True when the session was killed by the user (stop/close) rather than
    /// exiting on its own — the raw exit code of a force-killed process
    /// (0xFFFFFFFF on Windows) is noise, so the UI shows this instead.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub killed: bool,
    pub started_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OutputEvent {
    session_id: String,
    /// Base64-encoded raw terminal bytes.
    data: String,
}

/// TCP ports the session's process tree currently listens on.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PortsEvent {
    session_id: String,
    ports: Vec<u16>,
}

struct SessionHandle {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    /// Detached kill handle — safe to call while the reaper owns the child.
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    app_id: String,
    name: String,
    shell: ShellKind,
    pid: Option<u32>,
    started_at: u64,
    alive: AtomicBool,
    /// Set by `close()` — distinguishes user-initiated kills from natural
    /// exits in the emitted exit status.
    killed: AtomicBool,
    health_check_url: Option<String>,
}

#[derive(Default)]
struct ManagerInner {
    sessions: Mutex<HashMap<String, Arc<SessionHandle>>>,
    /// Last emitted ports per session, to suppress unchanged polls.
    ports: Mutex<HashMap<String, Vec<u16>>>,
    /// Last health state per session.
    health_last: Mutex<HashMap<String, bool>>,
    /// Set once the user confirms the close-guard dialog; the next
    /// `CloseRequested` event is let through without interception.
    force_close: AtomicBool,
}

/// Cheaply cloneable handle to the process-wide session table.
#[derive(Clone, Default)]
pub struct PtyManager {
    inner: Arc<ManagerInner>,
    ticker_started: Arc<AtomicBool>,
    health_ticker_started: Arc<AtomicBool>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn sleep_ms(ms: u64) {
    if ms > 0 {
        std::thread::sleep(std::time::Duration::from_millis(ms));
    }
}

/// Suffix that terminates the shell once the last preset command returns,
/// so a session with preset commands lives exactly as long as its service
/// (docker-container semantics). Apps without commands stay interactive.
fn exit_suffix(shell: ShellKind) -> &'static str {
    match shell {
        ShellKind::Cmd => " & exit",
        _ => "; exit",
    }
}

impl PtyManager {
    pub fn new() -> Self {
        Self::default()
    }

    fn session(&self, session_id: &str) -> anyhow::Result<Arc<SessionHandle>> {
        self.inner
            .sessions
            .lock()
            .get(session_id)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("session '{session_id}' not found or already exited"))
    }

    /// Spawn a pty session for the given app spec.
    pub fn start(&self, app: &AppHandle, spec: AppSpec) -> anyhow::Result<SessionStatus> {
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize {
            rows: INITIAL_ROWS,
            cols: INITIAL_COLS,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        let (program, args) = resolve_shell(&spec.shell)?;
        let mut cmd = CommandBuilder::new(program);
        cmd.args(args);
        if let Some(cwd) = spec.cwd.as_deref() {
            let dir = std::path::Path::new(cwd);
            if dir.is_dir() {
                cmd.cwd(dir);
            }
        }
        cmd.env("AEMETH_APP", spec.name.as_str());
        // User-configured environment variables.
        if let Some(vars) = &spec.env_vars {
            for (k, v) in vars.iter() {
                cmd.env(k, v);
            }
        }

        let mut child = pair.slave.spawn_command(cmd)?;
        let pid = child.process_id();
        let killer = child.clone_killer();
        let writer = pair.master.take_writer()?;
        let mut reader = pair.master.try_clone_reader()?;

        let session_id = uuid::Uuid::new_v4().simple().to_string();
        let started_at = now_ms();
        let status = SessionStatus {
            session_id: session_id.clone(),
            app_id: spec.app_id.clone(),
            name: spec.name.clone(),
            shell: spec.shell,
            state: SessionState::Running,
            exit_code: None,
            pid,
            killed: false,
            started_at,
        };

        let handle = Arc::new(SessionHandle {
            writer: Mutex::new(writer),
            master: Mutex::new(pair.master),
            killer: Mutex::new(killer),
            app_id: spec.app_id.clone(),
            name: spec.name.clone(),
            shell: spec.shell,
            pid,
            started_at,
            alive: AtomicBool::new(true),
            killed: AtomicBool::new(false),
            health_check_url: spec.health_check_url.clone(),
        });
        self.inner
            .sessions
            .lock()
            .insert(session_id.clone(), handle.clone());

        // Output pump: pty -> webview.
        {
            let app = app.clone();
            let session_id = session_id.clone();
            std::thread::Builder::new()
                .name(format!("pty-read-{session_id}"))
                .spawn(move || {
                    // Heap buffer: 256 KiB would eat a quarter of the
                    // thread's 1 MiB stack on Windows.
                    let mut buf = vec![0u8; READ_BUF_SIZE];
                    loop {
                        match reader.read(&mut buf) {
                            Ok(0) | Err(_) => break,
                            Ok(n) => {
                                let _ = app.emit(
                                    EVENT_OUTPUT,
                                    OutputEvent {
                                        session_id: session_id.clone(),
                                        data: BASE64.encode(&buf[..n]),
                                    },
                                );
                            }
                        }
                    }
                })?;
        }

        // Reaper: blocks until the shell exits, then notifies the webview.
        let scheduler_handle = handle.clone();
        {
            let app = app.clone();
            let manager = self.clone();
            let session_id = session_id.clone();
            std::thread::Builder::new()
                .name(format!("pty-wait-{session_id}"))
                .spawn(move || {
                    // The reaper owns the child exclusively — no lock needed.
                    let exit_code = child.wait().ok().map(|st| st.exit_code());
                    let killed = handle.killed.load(Ordering::SeqCst);
                    // A force-killed process exits with garbage (0xFFFFFFFF
                    // on Windows). User-initiated kills are reported as a
                    // clean 0, Electron-style — no scary exit codes in the UI.
                    let exit_code = if killed { Some(0) } else { exit_code };
                    handle.alive.store(false, Ordering::SeqCst);
                    manager.inner.sessions.lock().remove(&session_id);
                    let _ = app.emit(
                        EVENT_EXIT,
                        SessionStatus {
                            session_id,
                            app_id: handle.app_id.clone(),
                            name: handle.name.clone(),
                            shell: handle.shell,
                            state: SessionState::Exited,
                            exit_code,
                            pid: handle.pid,
                            killed,
                            started_at: handle.started_at,
                        },
                    );
                })?;
        }

        self.ensure_ports_ticker(&app);
        self.ensure_health_ticker(&app);

        // Preset command scheduler: types the configured lines into the shell.
        if !spec.commands.is_empty() {
            let handle = scheduler_handle;
            let shell = spec.shell;
            let startup_delay = spec.startup_delay_ms;
            let commands = spec.commands.clone();
            let session_id = session_id.clone();
            std::thread::Builder::new()
                .name(format!("pty-cmds-{session_id}"))
                .spawn(move || {
                    sleep_ms(startup_delay);
                    let last = commands.len().saturating_sub(1);
                    for (idx, preset) in commands.iter().enumerate() {
                        if !handle.alive.load(Ordering::SeqCst) {
                            break;
                        }
                        let mut line = preset.command.trim_end().to_string();
                        if idx == last {
                            // Tie the shell's lifetime to the service: when
                            // the last command returns, the shell exits too.
                            line = if line.is_empty() {
                                "exit".to_string()
                            } else {
                                format!("{}{}", line, exit_suffix(shell))
                            };
                        }
                        line.push('\r');
                        let _ = handle.writer.lock().write_all(line.as_bytes());
                        sleep_ms(preset.delay_ms);
                    }
                })?;
        }

        Ok(status)
    }

    /// Forward user input (base64 bytes) to the pty.
    pub fn write(&self, session_id: &str, data_b64: &str) -> anyhow::Result<()> {
        let data = BASE64.decode(data_b64)?;
        let session = self.session(session_id)?;
        session.writer.lock().write_all(&data)?;
        Ok(())
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> anyhow::Result<()> {
        if cols == 0 || rows == 0 {
            return Ok(());
        }
        let session = self.session(session_id)?;
        session.master.lock().resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        Ok(())
    }

    /// Kill the session's process tree (exit event follows from the reaper).
    ///
    /// The sessions-map guard is dropped before touching the killer, and the
    /// killer is disjoint from the child handle the reaper blocks on — no
    /// deadlock path.
    pub fn close(&self, session_id: &str) {
        let session = self.inner.sessions.lock().get(session_id).cloned();
        if let Some(session) = session {
            session.killed.store(true, Ordering::SeqCst);
            // Kill the whole tree so services spawned by the shell (node,
            // yarn, vite, ...) don't survive the session.
            if let Some(pid) = session.pid {
                kill_tree(pid);
            }
            // Fallback if the tree kill missed the direct child.
            let _ = session.killer.lock().kill();
        }
    }

    /// Number of currently running sessions.
    pub fn running_count(&self) -> usize {
        self.inner.sessions.lock().len()
    }

    pub fn mark_force_close(&self) {
        self.inner.force_close.store(true, Ordering::SeqCst);
    }

    pub fn is_force_close(&self) -> bool {
        self.inner.force_close.load(Ordering::SeqCst)
    }

    /// All currently running sessions.
    pub fn list(&self) -> Vec<SessionStatus> {
        self.inner
            .sessions
            .lock()
            .iter()
            .map(|(id, s)| SessionStatus {
                session_id: id.clone(),
                app_id: s.app_id.clone(),
                name: s.name.clone(),
                shell: s.shell,
                state: SessionState::Running,
                exit_code: None,
                pid: s.pid,
                killed: false,
                started_at: s.started_at,
            })
            .collect()
    }

    /// Terminate everything — used on application exit.
    pub fn close_all(&self) {
        let ids: Vec<String> = self.inner.sessions.lock().keys().cloned().collect();
        for id in ids {
            self.close(&id);
        }
    }

    /// Block until every session's reaper has finished (or the timeout
    /// elapses). Lets the shutdown flow guarantee no stray processes before
    /// the window is destroyed.
    pub fn wait_idle(&self, timeout: Duration) {
        let start = std::time::Instant::now();
        while start.elapsed() < timeout {
            if self.inner.sessions.lock().is_empty() {
                return;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    }

    /// Spawn the background ports poller once.
    fn ensure_ports_ticker(&self, app: &AppHandle) {
        if self.ticker_started.swap(true, Ordering::SeqCst) {
            return;
        }
        let manager = self.clone();
        let app = app.clone();
        let _ = std::thread::Builder::new()
            .name("pty-ports".into())
            .spawn(move || loop {
                std::thread::sleep(Duration::from_millis(PORTS_POLL_MS));
                manager.poll_ports(&app);
            });
    }

    /// Recompute listening ports per session and emit `pty://ports` on change.
    fn poll_ports(&self, app: &AppHandle) {
        let targets: Vec<(String, u32)> = self
            .inner
            .sessions
            .lock()
            .iter()
            .filter_map(|(id, h)| h.pid.map(|pid| (id.clone(), pid)))
            .collect();
        if targets.is_empty() {
            self.inner.ports.lock().clear();
            return;
        }

        let table = crate::ports::ProcessTable::snapshot();
        let listeners = crate::ports::listening_ports();

        let mut cache = self.inner.ports.lock();
        let mut alive: HashSet<String> = HashSet::new();
        for (session_id, pid) in targets {
            alive.insert(session_id.clone());
            let tree = table.descendants(pid);
            let mut found: Vec<u16> = Vec::new();
            for (listener, ports) in &listeners {
                if tree.contains(listener) {
                    found.extend_from_slice(ports);
                }
            }
            found.sort_unstable();
            found.dedup();
            if cache.get(&session_id) != Some(&found) {
                cache.insert(session_id.clone(), found.clone());
                let _ = app.emit(
                    EVENT_PORTS,
                    PortsEvent {
                        session_id: session_id.clone(),
                        ports: found,
                    },
                );
            }
        }
        cache.retain(|id, _| alive.contains(id));
    }

    fn ensure_health_ticker(&self, app: &AppHandle) {
        if self.health_ticker_started.swap(true, Ordering::SeqCst) {
            return;
        }
        let manager = self.clone();
        let app = app.clone();
        let _ = std::thread::Builder::new()
            .name("health-check".into())
            .spawn(move || {
                let client = reqwest::blocking::Client::builder()
                    .timeout(Duration::from_secs(5))
                    .danger_accept_invalid_certs(true)
                    .build()
                    .expect("build reqwest client");
                loop {
                    std::thread::sleep(Duration::from_secs(15));
                    crate::health::poll_sessions(
                        &manager,
                        &app,
                        &client,
                        &mut manager.inner.health_last.lock(),
                    );
                }
            });
    }
}

/// Snapshot of sessions for the health ticker.
pub fn sessions_snapshot(manager: &PtyManager) -> Vec<(String, String, String)> {
    manager
        .inner
        .sessions
        .lock()
        .iter()
        .map(|(id, h)| {
            (
                id.clone(),
                h.app_id.clone(),
                h.health_check_url.clone().unwrap_or_default(),
            )
        })
        .collect()
}

/// Kill the process tree rooted at `pid`, **parents first**.
///
/// Wrappers like pnpm/npm print their `ELIFECYCLE` farewell only when they
/// live to see their child die — killing the wrapper before its children
/// keeps the terminal quiet. The session's reported exit code is normalized
/// to 0 by the reaper (`killed` flag).
fn kill_tree(root: u32) {
    let system = sysinfo::System::new_all();
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    for (pid, proc) in system.processes() {
        if let Some(parent) = proc.parent() {
            children.entry(parent.as_u32()).or_default().push(pid.as_u32());
        }
    }
    let mut queue = VecDeque::from([root]);
    let mut seen = HashSet::from([root]);
    while let Some(pid) = queue.pop_front() {
        if let Some(proc) = system.process(sysinfo::Pid::from_u32(pid)) {
            let _ = proc.kill();
        }
        if let Some(kids) = children.get(&pid) {
            for &kid in kids {
                if seen.insert(kid) {
                    queue.push_back(kid);
                }
            }
        }
    }
}

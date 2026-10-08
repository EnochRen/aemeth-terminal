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
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use parking_lot::{Condvar, Mutex};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::shells::{resolve_shell, ShellKind};

pub const EVENT_OUTPUT: &str = "pty://output";
pub const EVENT_EXIT: &str = "pty://exit";
pub const EVENT_PORTS: &str = "pty://ports";

const PORTS_POLL_MS: u64 = 2000;
const CLOSE_TIMEOUT: Duration = Duration::from_secs(10);

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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub healthy: Option<bool>,
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
    /// Serializes tree cleanup with duplicate stops and the exit notification.
    close_lock: Mutex<()>,
    /// Keep failed descendants addressable even after their shell has exited.
    pending_tree: Mutex<Vec<(sysinfo::Pid, u64)>>,
    cleanup_changed: Condvar,
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
    admission: Mutex<Admission>,
    startup_changed: Condvar,
    sessions_changed: Condvar,
    /// Whole-app shutdown is single-flight, independent of individual stops.
    shutdown_lock: Mutex<()>,
}

#[derive(Default)]
struct Admission {
    closing: bool,
    starting: usize,
}

/// Startup may finish after shutdown was requested. The lease makes shutdown
/// wait for that session to be registered before taking its cleanup snapshot.
struct StartLease<'a>(&'a ManagerInner);

impl Drop for StartLease<'_> {
    fn drop(&mut self) {
        self.0.admission.lock().starting -= 1;
        self.0.startup_changed.notify_all();
    }
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
        let _startup = self.begin_start()?;
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
            healthy: None,
        };

        let handle = Arc::new(SessionHandle {
            close_lock: Mutex::new(()),
            pending_tree: Mutex::new(Vec::new()),
            cleanup_changed: Condvar::new(),
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
                    // The shell can die before its descendants. Publish exit
                    // only after a concurrent tree cleanup releases this gate.
                    let mut closing = handle.close_lock.lock();
                    while !handle.pending_tree.lock().is_empty() {
                        handle.cleanup_changed.wait(&mut closing);
                    }
                    let killed = handle.killed.load(Ordering::SeqCst);
                    tracing::info!(
                        %session_id,
                        exit_code = ?exit_code,
                        killed,
                        "session reaper: process exited",
                    );
                    // A force-killed process exits with garbage (0xFFFFFFFF
                    // on Windows). User-initiated kills are reported as a
                    // clean 0, Electron-style — no scary exit codes in the UI.
                    let exit_code = if killed { Some(0) } else { exit_code };
                    handle.alive.store(false, Ordering::SeqCst);
                    manager.inner.sessions.lock().remove(&session_id);
                    manager.inner.sessions_changed.notify_all();
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
                            healthy: None,
                        },
                    );
                })?;
        }

        self.ensure_ports_ticker(app);
        self.ensure_health_ticker(app);

        // Kick off an immediate health check for this session in the background.
        if let Some(ref url) = spec.health_check_url {
            let app_handle = app.clone();
            let sid = session_id.clone();
            let aid = spec.app_id.clone();
            let url = url.clone();
            let manager = self.clone();
            std::thread::Builder::new()
                .name(format!("health-init-{sid}"))
                .spawn(move || {
                    let client = match reqwest::blocking::Client::builder()
                        .timeout(Duration::from_secs(5))
                        .danger_accept_invalid_certs(true)
                        .build()
                    {
                        Ok(client) => client,
                        Err(error) => {
                            tracing::error!(
                                %sid,
                                %aid,
                                %error,
                                "failed to create initial health check client"
                            );
                            return;
                        }
                    };
                    let ok = match client.get(&url).send() {
                        Ok(response) => {
                            let status = response.status();
                            if !status.is_success() {
                                tracing::warn!(
                                    %sid,
                                    %aid,
                                    %status,
                                    "initial health check returned an unhealthy status"
                                );
                            }
                            status.is_success()
                        }
                        Err(error) => {
                            tracing::warn!(
                                %sid,
                                %aid,
                                %error,
                                "initial health check request failed"
                            );
                            false
                        }
                    };
                    manager.inner.health_last.lock().insert(sid.clone(), ok);
                    let _ = app_handle.emit(
                        crate::health::EVENT_HEALTH,
                        crate::health::HealthEvent {
                            session_id: sid,
                            app_id: aid,
                            healthy: ok,
                        },
                    );
                })?;
        }

        // Preset command scheduler: types the configured lines into the shell.
        if !spec.commands.is_empty() {
            tracing::info!(
                session_id = %session_id,
                count = spec.commands.len(),
                "scheduling preset commands",
            );
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
                        if !handle.alive.load(Ordering::SeqCst)
                            || handle.killed.load(Ordering::SeqCst)
                        {
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
                        if let Err(error) = handle.writer.lock().write_all(line.as_bytes()) {
                            tracing::error!(
                                %session_id,
                                command_index = idx,
                                %error,
                                "failed to write preset command to pty"
                            );
                            break;
                        }
                        sleep_ms(preset.delay_ms);
                    }
                })?;
        }

        Ok(status)
    }

    /// Forward user input (base64 bytes) to the pty.
    pub fn write(&self, session_id: &str, data_b64: &str) -> anyhow::Result<()> {
        let data = BASE64.decode(data_b64).map_err(|error| {
            tracing::warn!(%session_id, %error, "received invalid base64 pty input");
            error
        })?;
        let session = self.session(session_id)?;
        session.writer.lock().write_all(&data)?;
        Ok(())
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> anyhow::Result<()> {
        if cols == 0 || rows == 0 {
            tracing::debug!(%session_id, cols, rows, "ignored zero-sized pty resize");
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

    /// Wait for tree cleanup and the reaper. Only call from a blocking worker.
    /// Map locks are never held across OS calls or waits.
    pub fn close(&self, session_id: &str) -> Result<(), String> {
        self.close_until(session_id, Instant::now() + CLOSE_TIMEOUT)
    }

    fn close_until(&self, session_id: &str, deadline: Instant) -> Result<(), String> {
        let session = self.inner.sessions.lock().get(session_id).cloned();
        if let Some(session) = session {
            {
                let _closing = session.close_lock.try_lock_until(deadline).ok_or_else(|| {
                    format!("timed out waiting for session '{session_id}' to stop")
                })?;
                if session.alive.load(Ordering::SeqCst)
                    && !session.killed.swap(true, Ordering::SeqCst)
                {
                    // Snapshot descendants before killing the parent; otherwise
                    // reparented children can disappear from the tree.
                    let result = if let Some(pid) = session.pid {
                        kill_tree(pid, &mut session.pending_tree.lock(), deadline, || {
                            session.killer.lock().kill()
                        })
                    } else {
                        session
                            .killer
                            .lock()
                            .kill()
                            .map_err(|error| error.to_string())
                    };
                    if let Err(error) = result {
                        session.killed.store(false, Ordering::SeqCst);
                        return Err(error);
                    }
                    session.cleanup_changed.notify_all();
                }
            }
            let mut sessions = self.inner.sessions.lock();
            while sessions.contains_key(session_id) {
                if self
                    .inner
                    .sessions_changed
                    .wait_until(&mut sessions, deadline)
                    .timed_out()
                    && sessions.contains_key(session_id)
                {
                    return Err(format!(
                        "timed out waiting for session '{session_id}' to exit"
                    ));
                }
            }
        }
        Ok(())
    }

    fn begin_start(&self) -> anyhow::Result<StartLease<'_>> {
        let mut admission = self.inner.admission.lock();
        anyhow::ensure!(!admission.closing, "application is shutting down");
        admission.starting += 1;
        Ok(StartLease(&self.inner))
    }

    /// Atomically seal admission when there is nothing left to clean up.
    /// Safe in native GUI callbacks: only short, in-memory locks are taken.
    pub fn prepare_window_close(&self) -> bool {
        let mut admission = self.inner.admission.lock();
        if admission.starting > 0 || !self.inner.sessions.lock().is_empty() {
            return false;
        }
        admission.closing = true;
        true
    }

    pub fn cancel_shutdown(&self) {
        self.inner.admission.lock().closing = false;
        self.inner.force_close.store(false, Ordering::SeqCst);
    }

    /// Number of currently running sessions.
    pub fn running_count(&self) -> usize {
        self.inner.admission.lock().starting + self.inner.sessions.lock().len()
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
                healthy: None,
            })
            .collect()
    }

    /// Terminate everything — used on application exit.
    pub fn close_all(&self) -> Result<(), String> {
        let _shutdown = self.inner.shutdown_lock.lock();
        let result = (|| {
            let deadline = Instant::now() + CLOSE_TIMEOUT;
            let mut admission = self.inner.admission.lock();
            admission.closing = true;
            while admission.starting > 0 {
                if self
                    .inner
                    .startup_changed
                    .wait_until(&mut admission, deadline)
                    .timed_out()
                    && admission.starting > 0
                {
                    return Err("timed out waiting for session startup".to_string());
                }
            }
            drop(admission);

            let ids: Vec<String> = self.inner.sessions.lock().keys().cloned().collect();
            tracing::info!(count = ids.len(), "closing all sessions");
            // Independent sessions shut down together. Each close joins an
            // existing stop through its per-session gate.
            std::thread::scope(|scope| {
                let workers: Vec<_> = ids
                    .iter()
                    .map(|id| scope.spawn(|| self.close(id)))
                    .collect();
                let errors: Vec<_> = workers
                    .into_iter()
                    .filter_map(|worker| {
                        worker
                            .join()
                            .unwrap_or_else(|_| Err("session cleanup panicked".into()))
                            .err()
                    })
                    .collect();
                if errors.is_empty() {
                    Ok(())
                } else {
                    Err(errors.join("; "))
                }
            })
        })();
        if result.is_err() {
            self.cancel_shutdown();
        }
        result
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
                let client = match reqwest::blocking::Client::builder()
                    .timeout(Duration::from_secs(5))
                    .danger_accept_invalid_certs(true)
                    .build()
                {
                    Ok(client) => client,
                    Err(error) => {
                        tracing::error!(%error, "failed to create health check client");
                        return;
                    }
                };
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
fn kill_tree(
    root: u32,
    targets: &mut Vec<(sysinfo::Pid, u64)>,
    deadline: Instant,
    fallback: impl FnOnce() -> std::io::Result<()>,
) -> Result<(), String> {
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System};
    // Killing needs only process identity and parentage, not CPU, memory,
    // environment, disks, or command lines for every process on the machine.
    let mut system =
        System::new_with_specifics(RefreshKind::new().with_processes(ProcessRefreshKind::new()));
    if targets.is_empty() {
        let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
        for (pid, proc) in system.processes() {
            if let Some(parent) = proc.parent() {
                children
                    .entry(parent.as_u32())
                    .or_default()
                    .push(pid.as_u32());
            }
        }
        let mut queue = VecDeque::from([root]);
        let mut seen = HashSet::from([root]);
        while let Some(pid) = queue.pop_front() {
            if let Some(proc) = system.process(Pid::from_u32(pid)) {
                targets.push((proc.pid(), proc.start_time()));
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
    // Retries use retained identities: children may have been reparented.
    // Never terminate a new process that reused one of their PIDs.
    let terminate = |system: &System, targets: &[(Pid, u64)]| {
        for (pid, started) in targets {
            if let Some(process) = system.process(*pid).filter(|p| p.start_time() == *started) {
                if !process.kill() {
                    tracing::warn!(root, pid = %pid, name = ?process.name(), "process termination request failed");
                }
            }
        }
    };
    terminate(&system, targets);
    // The detached child handle is authoritative even if the snapshot missed it.
    let _ = fallback();
    let pids: Vec<Pid> = targets.iter().map(|(pid, _)| *pid).collect();
    let mut retry_at = Instant::now() + Duration::from_millis(250);
    while !targets.is_empty() {
        system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&pids),
            true,
            ProcessRefreshKind::new(),
        );
        targets.retain(|(pid, started)| {
            system.process(*pid).is_some_and(|process| {
                process.start_time() == *started
                    && process.status() != sysinfo::ProcessStatus::Zombie
                    && process.status() != sysinfo::ProcessStatus::Dead
            })
        });
        if targets.is_empty() {
            break;
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "timed out stopping process tree {root}; remaining PIDs: {}",
                targets
                    .iter()
                    .map(|(pid, _)| pid.to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
        // OS termination can fail transiently during process startup. Retry
        // only still-live identities, with a bounded interval and deadline.
        if Instant::now() >= retry_at {
            terminate(&system, targets);
            retry_at = Instant::now() + Duration::from_millis(250);
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{atomic::AtomicUsize, mpsc};

    struct TestMaster;
    impl MasterPty for TestMaster {
        fn resize(&self, _: PtySize) -> anyhow::Result<()> {
            Ok(())
        }
        fn get_size(&self) -> anyhow::Result<PtySize> {
            Ok(PtySize::default())
        }
        fn try_clone_reader(&self) -> anyhow::Result<Box<dyn Read + Send>> {
            Ok(Box::new(std::io::empty()))
        }
        fn take_writer(&self) -> anyhow::Result<Box<dyn Write + Send>> {
            Ok(Box::new(std::io::sink()))
        }
        #[cfg(unix)]
        fn process_group_leader(&self) -> Option<i32> {
            None
        }
        #[cfg(unix)]
        fn as_raw_fd(&self) -> Option<i32> {
            None
        }
        #[cfg(unix)]
        fn tty_name(&self) -> Option<std::path::PathBuf> {
            None
        }
    }

    #[derive(Clone, Debug)]
    struct TestKiller {
        entered: mpsc::Sender<()>,
        release: Arc<Mutex<mpsc::Receiver<bool>>>,
        calls: Arc<AtomicUsize>,
    }
    impl ChildKiller for TestKiller {
        fn kill(&mut self) -> std::io::Result<()> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.entered.send(()).unwrap();
            if self
                .release
                .lock()
                .recv_timeout(Duration::from_secs(5))
                .unwrap()
            {
                Ok(())
            } else {
                Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "denied",
                ))
            }
        }
        fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
            Box::new(self.clone())
        }
    }

    fn insert_session(
        manager: &PtyManager,
        id: &str,
    ) -> (
        Arc<SessionHandle>,
        mpsc::Receiver<()>,
        mpsc::Sender<bool>,
        Arc<AtomicUsize>,
    ) {
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let calls = Arc::new(AtomicUsize::new(0));
        let session = Arc::new(SessionHandle {
            close_lock: Mutex::new(()),
            pending_tree: Mutex::new(Vec::new()),
            cleanup_changed: Condvar::new(),
            writer: Mutex::new(Box::new(std::io::sink())),
            master: Mutex::new(Box::new(TestMaster)),
            killer: Mutex::new(Box::new(TestKiller {
                entered: entered_tx,
                release: Arc::new(Mutex::new(release_rx)),
                calls: calls.clone(),
            })),
            app_id: id.into(),
            name: id.into(),
            shell: ShellKind::Cmd,
            pid: None,
            started_at: 0,
            alive: AtomicBool::new(true),
            killed: AtomicBool::new(false),
            health_check_url: None,
        });
        manager
            .inner
            .sessions
            .lock()
            .insert(id.into(), session.clone());
        (session, entered_rx, release_tx, calls)
    }

    fn reap(manager: &PtyManager, id: &str, session: &SessionHandle) {
        let _closing = session.close_lock.lock();
        session.alive.store(false, Ordering::SeqCst);
        manager.inner.sessions.lock().remove(id);
        manager.inner.sessions_changed.notify_all();
    }

    #[test]
    fn duplicate_stops_share_cleanup_without_blocking_status_queries() {
        let manager = PtyManager::new();
        let (session, entered, release, calls) = insert_session(&manager, "one");
        std::thread::scope(|scope| {
            let first = scope.spawn(|| manager.close("one"));
            entered.recv_timeout(Duration::from_secs(2)).unwrap();
            let second = scope.spawn(|| manager.close("one"));
            assert_eq!(manager.list().len(), 1);
            assert!(!manager.prepare_window_close());
            release.send(true).unwrap();
            reap(&manager, "one", &session);
            first.join().unwrap().unwrap();
            second.join().unwrap().unwrap();
        });
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(manager.close("one").is_ok());
    }

    #[test]
    fn failed_cleanup_is_retryable() {
        let manager = PtyManager::new();
        let (session, entered, release, calls) = insert_session(&manager, "one");
        std::thread::scope(|scope| {
            let first = scope.spawn(|| manager.close_all());
            entered.recv_timeout(Duration::from_secs(2)).unwrap();
            release.send(false).unwrap();
            assert!(first.join().unwrap().is_err());
            assert!(!session.killed.load(Ordering::SeqCst));
            assert!(manager.begin_start().is_ok());
            let retry = scope.spawn(|| manager.close("one"));
            entered.recv_timeout(Duration::from_secs(2)).unwrap();
            release.send(true).unwrap();
            reap(&manager, "one", &session);
            retry.join().unwrap().unwrap();
        });
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn a_reaper_timeout_is_reported_without_forgetting_the_session() {
        let manager = PtyManager::new();
        let (session, _entered, release, _) = insert_session(&manager, "one");
        release.send(true).unwrap();
        let error = manager.close_until("one", Instant::now()).unwrap_err();
        assert!(error.contains("timed out"));
        assert_eq!(manager.running_count(), 1);
        reap(&manager, "one", &session);
        manager.close("one").unwrap();
    }

    #[test]
    fn shutdown_cleans_independent_sessions_concurrently() {
        let manager = PtyManager::new();
        let (one, entered_one, release_one, _) = insert_session(&manager, "one");
        let (two, entered_two, release_two, _) = insert_session(&manager, "two");
        std::thread::scope(|scope| {
            let shutdown = scope.spawn(|| manager.close_all());
            entered_one.recv_timeout(Duration::from_secs(2)).unwrap();
            entered_two.recv_timeout(Duration::from_secs(2)).unwrap();
            assert!(manager.begin_start().is_err());
            release_one.send(true).unwrap();
            release_two.send(true).unwrap();
            reap(&manager, "one", &one);
            reap(&manager, "two", &two);
            shutdown.join().unwrap().unwrap();
        });
        assert_eq!(manager.running_count(), 0);
        assert!(manager.begin_start().is_err());
    }

    #[test]
    fn closing_an_idle_window_seals_startup_admission() {
        let manager = PtyManager::new();
        let startup = manager.begin_start().unwrap();
        assert!(!manager.prepare_window_close());
        drop(startup);
        assert!(manager.prepare_window_close());
        assert!(manager.begin_start().is_err());
        manager.cancel_shutdown();
        assert!(manager.begin_start().is_ok());
    }

    #[test]
    fn shutdown_waits_for_an_inflight_start() {
        let manager = PtyManager::new();
        let startup = manager.begin_start().unwrap();
        let (finished_tx, finished_rx) = mpsc::channel();
        std::thread::scope(|scope| {
            let shutdown = scope.spawn(|| {
                let result = manager.close_all();
                finished_tx.send(()).unwrap();
                result
            });
            let deadline = Instant::now() + Duration::from_secs(2);
            while !manager.inner.admission.lock().closing {
                assert!(Instant::now() < deadline);
                std::thread::yield_now();
            }
            assert!(finished_rx.try_recv().is_err());
            assert!(manager.begin_start().is_err());
            drop(startup);
            shutdown.join().unwrap().unwrap();
        });
    }

    #[cfg(windows)]
    #[test]
    fn kills_a_real_windows_process_tree_and_waits_for_descendants() {
        check_windows_tree_cleanup(false);
    }

    #[cfg(windows)]
    #[test]
    fn retry_cleans_remembered_children_after_the_root_has_exited() {
        check_windows_tree_cleanup(true);
    }

    #[cfg(windows)]
    fn check_windows_tree_cleanup(root_already_exited: bool) {
        use std::os::windows::process::CommandExt;
        use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
        let mut root = std::process::Command::new("cmd.exe")
            .args(["/D", "/C", "ping -n 30 127.0.0.1 > NUL"])
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .spawn()
            .unwrap();
        let root_pid = Pid::from_u32(root.id());
        let mut system = System::new();
        let deadline = Instant::now() + Duration::from_secs(5);
        let child_pid = loop {
            system.refresh_processes_specifics(
                ProcessesToUpdate::All,
                true,
                ProcessRefreshKind::new(),
            );
            if let Some(child) = system
                .processes()
                .values()
                .find(|p| p.parent() == Some(root_pid))
            {
                break Some(child.pid());
            }
            if Instant::now() >= deadline {
                break None;
            }
            std::thread::sleep(Duration::from_millis(10));
        };
        let mut targets = Vec::new();
        if root_already_exited {
            if let Some(child) = child_pid.and_then(|pid| system.process(pid)) {
                targets.push((child.pid(), child.start_time()));
            }
            root.kill().unwrap();
            root.wait().unwrap();
        }
        let result = kill_tree(
            root.id(),
            &mut targets,
            Instant::now() + CLOSE_TIMEOUT,
            || root.kill(),
        );
        system.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::new());
        let root_exited = system.process(root_pid).is_none();
        let child_exited = child_pid.is_some_and(|pid| system.process(pid).is_none());
        // Cleanup remains best effort even when an assertion below fails.
        if let Some(child) = child_pid.and_then(|pid| system.process(pid)) {
            let _ = child.kill();
        }
        let _ = root.kill();
        root.wait().unwrap();
        assert!(child_pid.is_some(), "test child did not start");
        result.unwrap();
        assert!(root_exited);
        assert!(child_exited);
    }
}

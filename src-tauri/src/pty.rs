//! PTY session management.
//!
//! Each app session is a pseudo-terminal spawned via `portable-pty` (ConPTY on
//! Windows). Output is streamed to the webview as base64-encoded `pty://output`
//! events; the frontend (xterm.js) renders them and pipes input back through
//! `pty_write`. The reaper thread observes process exit and emits `pty://exit`.

use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use parking_lot::Mutex;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::shells::{resolve_shell, ShellKind};

pub const EVENT_OUTPUT: &str = "pty://output";
pub const EVENT_EXIT: &str = "pty://exit";

const INITIAL_COLS: u16 = 110;
const INITIAL_ROWS: u16 = 28;
const READ_BUF_SIZE: usize = 16 * 1024;

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
    pub started_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OutputEvent {
    session_id: String,
    /// Base64-encoded raw terminal bytes.
    data: String,
}

struct SessionHandle {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    app_id: String,
    name: String,
    shell: ShellKind,
    pid: Option<u32>,
    started_at: u64,
    alive: AtomicBool,
}

#[derive(Default)]
struct ManagerInner {
    sessions: Mutex<HashMap<String, Arc<SessionHandle>>>,
}

/// Cheaply cloneable handle to the process-wide session table.
#[derive(Clone, Default)]
pub struct PtyManager {
    inner: Arc<ManagerInner>,
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

        let child = pair.slave.spawn_command(cmd)?;
        let pid = child.process_id();
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
            started_at,
        };

        let handle = Arc::new(SessionHandle {
            writer: Mutex::new(writer),
            master: Mutex::new(pair.master),
            child: Mutex::new(child),
            app_id: spec.app_id.clone(),
            name: spec.name.clone(),
            shell: spec.shell,
            pid,
            started_at,
            alive: AtomicBool::new(true),
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
                    let mut buf = [0u8; READ_BUF_SIZE];
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
                    let exit_code = {
                        let mut child = handle.child.lock();
                        child.wait().ok().map(|st| st.exit_code())
                    };
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
                            started_at: handle.started_at,
                        },
                    );
                })?;
        }

        // Preset command scheduler: types the configured lines into the shell.
        if !spec.commands.is_empty() {
            let handle = scheduler_handle;
            let startup_delay = spec.startup_delay_ms;
            let commands = spec.commands.clone();
            let session_id = session_id.clone();
            std::thread::Builder::new()
                .name(format!("pty-cmds-{session_id}"))
                .spawn(move || {
                    sleep_ms(startup_delay);
                    for preset in commands {
                        if !handle.alive.load(Ordering::SeqCst) {
                            break;
                        }
                        let mut line = preset.command;
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
    pub fn close(&self, session_id: &str) {
        if let Some(session) = self.inner.sessions.lock().get(session_id).cloned() {
            let _ = session.child.lock().kill();
        }
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
}

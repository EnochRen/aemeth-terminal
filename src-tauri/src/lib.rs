mod health;
mod logger;
mod ports;
mod procs;
mod pty;
mod shells;
mod update;

use pty::{AppSpec, PtyManager, SessionStatus};
use shells::ShellInfo;
use tauri::{Emitter, Manager};

/// Emitted to the frontend when a close request is blocked because sessions
/// are still running. The frontend decides the UX (confirm dialog and/or
/// shutdown overlay) and answers with `shutdown_sessions` + `close_force`.
const EVENT_CLOSE_BLOCKED: &str = "aemeth://close-blocked";

#[tauri::command]
fn pty_start(
    manager: tauri::State<PtyManager>,
    app: tauri::AppHandle,
    spec: AppSpec,
) -> Result<SessionStatus, String> {
    tracing::info!(app_id = %spec.app_id, name = %spec.name, "starting pty session");
    let status = manager.start(&app, spec).map_err(|e| {
        tracing::error!(error = %e, "failed to start pty session");
        e.to_string()
    })?;
    tracing::info!(session_id = %status.session_id, pid = ?status.pid, "pty session started");
    Ok(status)
}

#[tauri::command]
fn pty_write(
    manager: tauri::State<PtyManager>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    manager.write(&session_id, &data).map_err(|e| {
        tracing::error!(%session_id, error = %e, "failed to write to pty session");
        e.to_string()
    })
}

#[tauri::command]
fn pty_resize(
    manager: tauri::State<PtyManager>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    manager.resize(&session_id, cols, rows).map_err(|e| {
        tracing::error!(%session_id, cols, rows, error = %e, "failed to resize pty session");
        e.to_string()
    })
}

#[tauri::command]
fn pty_close(manager: tauri::State<PtyManager>, session_id: String) -> Result<(), String> {
    tracing::info!(%session_id, "closing pty session");
    manager.close(&session_id);
    Ok(())
}

#[tauri::command]
fn pty_list(manager: tauri::State<PtyManager>) -> Vec<SessionStatus> {
    manager.list()
}

#[tauri::command]
fn shells_detect() -> Vec<ShellInfo> {
    shells::detect_shells()
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    let bytes = content.len();
    std::fs::write(&path, content).map_err(|e| {
        tracing::error!(%path, bytes, error = %e, "failed to write text file");
        e.to_string()
    })?;
    tracing::debug!(%path, bytes, "text file written");
    Ok(())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    let result = std::fs::read_to_string(&path).map_err(|e| {
        tracing::error!(%path, error = %e, "failed to read text file");
        e.to_string()
    })?;
    tracing::debug!(%path, bytes = result.len(), "text file read");
    Ok(result)
}

#[tauri::command]
fn process_list() -> Vec<procs::ProcessInfo> {
    procs::snapshot()
}

#[tauri::command]
fn process_kill(pid: u32) -> Result<usize, String> {
    tracing::info!(%pid, "killing process tree");
    procs::kill_tree(pid).map_err(|e| {
        tracing::error!(%pid, error = %e, "failed to kill process tree");
        e
    })
}

#[tauri::command]
fn process_detail(pid: u32) -> Result<procs::ProcessDetail, String> {
    procs::detail(pid).ok_or_else(|| {
        tracing::warn!(%pid, "process detail requested for missing process");
        "process not found".into()
    })
}

/// User confirmed the close-guard dialog: destroy the window natively.
/// Deliberately bypasses the webview event queue so the close is instant
/// even while sessions are streaming output.
#[tauri::command]
fn close_force(window: tauri::Window, manager: tauri::State<PtyManager>) {
    manager.mark_force_close();
    let _ = window.destroy();
}

/// Graceful shutdown step: kill every session tree (parents first, exit code
/// normalized to 0) and wait for the reapers to finish, so nothing survives
/// the window. Called by the frontend's shutdown overlay before `close_force`.
#[tauri::command]
async fn shutdown_sessions(manager: tauri::State<'_, PtyManager>) -> Result<(), String> {
    tracing::info!("shutting down all sessions");
    let manager = manager.inner().clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        manager.close_all();
        manager.wait_idle(std::time::Duration::from_secs(5));
    })
    .await;
    tracing::info!("all sessions shut down");
    Ok(())
}

/// Open a URL in the default system browser.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    tracing::info!(%url, "opening URL in default browser");
    open::that(&url).map_err(|e| {
        tracing::error!(%url, error = %e, "failed to open URL");
        e.to_string()
    })
}

#[tauri::command]
fn open_data_dir(app: tauri::AppHandle) -> Result<(), String> {
    let path = app.path().app_data_dir().map_err(|e| {
        tracing::error!(error = %e, "failed to resolve application data directory");
        e.to_string()
    })?;
    std::fs::create_dir_all(&path).map_err(|e| {
        tracing::error!(path = %path.display(), error = %e, "failed to create application data directory");
        e.to_string()
    })?;
    tracing::info!(path = %path.display(), "opening application data directory");
    open::that(&path).map_err(|e| {
        tracing::error!(path = %path.display(), error = %e, "failed to open application data directory");
        e.to_string()
    })
}

#[tauri::command]
fn open_logs_dir() -> Result<(), String> {
    let path = logger::logs_dir();
    std::fs::create_dir_all(&path).map_err(|e| {
        tracing::error!(path = %path.display(), error = %e, "failed to create logs directory");
        e.to_string()
    })?;
    tracing::info!(path = %path.display(), "opening logs directory");
    open::that(&path).map_err(|e| {
        tracing::error!(path = %path.display(), error = %e, "failed to open logs directory");
        e.to_string()
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logger::init();

    let manager = PtyManager::new();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(update::UpdateState::default())
        .manage(manager.clone())
        .invoke_handler(tauri::generate_handler![
            pty_start,
            pty_write,
            pty_resize,
            pty_close,
            pty_list,
            shells_detect,
            write_text_file,
            read_text_file,
            process_list,
            process_kill,
            process_detail,
            close_force,
            shutdown_sessions,
            open_url,
            open_data_dir,
            open_logs_dir,
            update::check_update,
            update::get_app_version,
            update::get_update_target,
            update::update_cancel,
            update::update_download,
            update::update_extract,
            update::update_apply,
            update::update_relaunch
        ])
        // Native close guard. If a JS `onCloseRequested` listener were
        // registered instead, Tauri would unconditionally veto the native
        // close and defer the decision to the webview's event queue — which
        // stalls the close while sessions flood it with output events.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let manager = window.state::<PtyManager>();
                if manager.is_force_close() {
                    return;
                }
                let running = manager.running_count();
                if running == 0 {
                    return;
                }
                // Sessions are live: block the native close and hand the
                // decision to the frontend (confirm dialog / shutdown
                // overlay, depending on settings).
                api.prevent_close();
                let _ = window.emit(EVENT_CLOSE_BLOCKED, running);
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(move |_handle, event| {
        // Make sure no stray shells keep running after the window closes.
        if let tauri::RunEvent::ExitRequested { .. } = event {
            tracing::info!("app exit requested, closing all sessions");
            manager.close_all();
        }
    });
}

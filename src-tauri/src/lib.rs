mod ports;
mod procs;
mod pty;
mod shells;

use pty::{AppSpec, PtyManager, SessionStatus};
use shells::ShellInfo;
use tauri::{Emitter, Manager};
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "aemeth.json";
/// Emitted to the frontend when a close request is blocked pending
/// confirmation. The frontend answers with `close_force` (or cancels).
const EVENT_CLOSE_BLOCKED: &str = "aemeth://close-blocked";

#[tauri::command]
fn pty_start(
    manager: tauri::State<PtyManager>,
    app: tauri::AppHandle,
    spec: AppSpec,
) -> Result<SessionStatus, String> {
    manager.start(&app, spec).map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_write(
    manager: tauri::State<PtyManager>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    manager.write(&session_id, &data).map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_resize(
    manager: tauri::State<PtyManager>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    manager
        .resize(&session_id, cols, rows)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_close(manager: tauri::State<PtyManager>, session_id: String) -> Result<(), String> {
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
    std::fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn process_list() -> Vec<procs::ProcessInfo> {
    procs::snapshot()
}

#[tauri::command]
fn process_kill(pid: u32) -> Result<usize, String> {
    procs::kill_tree(pid)
}

/// User confirmed the close-guard dialog: destroy the window natively.
/// Deliberately bypasses the webview event queue so the close is instant
/// even while sessions are streaming output.
#[tauri::command]
fn close_force(window: tauri::Window, manager: tauri::State<PtyManager>) {
    manager.mark_force_close();
    let _ = window.destroy();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let manager = PtyManager::new();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(manager.clone())
        .invoke_handler(tauri::generate_handler![
            pty_start,
            pty_write,
            pty_resize,
            pty_close,
            pty_list,
            shells_detect,
            write_text_file,
            process_list,
            process_kill,
            close_force
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
                // `settings.confirmClose` from the shared plugin store
                // (defaults to true when the store isn't loaded yet).
                let confirm = window
                    .get_store(STORE_FILE)
                    .and_then(|store| {
                        store
                            .get("settings")
                            .and_then(|settings| settings.get("confirmClose").and_then(|v| v.as_bool()))
                    })
                    .unwrap_or(true);
                if confirm {
                    api.prevent_close();
                    let _ = window.emit(EVENT_CLOSE_BLOCKED, running);
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(move |_handle, event| {
        // Make sure no stray shells keep running after the window closes.
        if let tauri::RunEvent::ExitRequested { .. } = event {
            manager.close_all();
        }
    });
}

mod pty;
mod shells;

use pty::{AppSpec, PtyManager, SessionStatus};
use shells::ShellInfo;

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
            shells_detect
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(move |_handle, event| {
        // Make sure no stray shells keep running after the window closes.
        if let tauri::RunEvent::ExitRequested { .. } = event {
            manager.close_all();
        }
    });
}

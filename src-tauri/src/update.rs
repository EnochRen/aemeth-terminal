//! Portable zip-based self-updater (MXU-style).
//!
//! Flow: frontend queries GitHub Releases for the latest tag, picks the asset
//! matching `get_update_target()`, downloads it (progress streamed back as
//! events), extracts it, then `update_apply` swaps the running executable and
//! `update_relaunch` spawns the new binary and exits the old process.

use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::{AppHandle, Emitter};

pub const EVENT_PROGRESS: &str = "aemeth://update-progress";

#[derive(Clone, serde::Serialize)]
struct ProgressEvent {
    downloaded: u64,
    total: u64,
}

/// Shared cancel flag for an in-flight download.
#[derive(Default, Clone)]
pub struct UpdateState {
    cancel: Arc<AtomicBool>,
}

#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Target triple fragment used to pick the right release asset,
/// e.g. `win-x86_64`, `macos-aarch64`, `linux-x86_64`.
#[tauri::command]
pub fn get_update_target() -> String {
    let os = if cfg!(target_os = "windows") {
        "win"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    };
    let arch = if cfg!(target_arch = "x86_64") {
        "x86_64"
    } else if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else {
        "unknown"
    };
    format!("{os}-{arch}")
}

#[tauri::command]
pub fn update_cancel(state: tauri::State<UpdateState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

/// Download `url` to a temp file, streaming progress events. Returns the path.
#[tauri::command]
pub fn update_download(
    app: AppHandle,
    state: tauri::State<UpdateState>,
    url: String,
) -> Result<String, String> {
    state.cancel.store(false, Ordering::SeqCst);

    let client = reqwest::blocking::Client::builder()
        .user_agent("aemeth-terminal-updater")
        .build()
        .map_err(|e| e.to_string())?;

    let mut resp = client.get(&url).send().map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("download failed: HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);

    let file_name = url
        .rsplit('/')
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or("update.zip")
        .to_string();
    let dest = std::env::temp_dir().join(format!("aemeth-update-{file_name}"));

    let mut file = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;
    let mut buf = vec![0u8; 64 * 1024];

    loop {
        if state.cancel.load(Ordering::SeqCst) {
            let _ = std::fs::remove_file(&dest);
            return Err("cancelled".to_string());
        }
        let n = resp.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        downloaded += n as u64;
        let _ = app.emit(EVENT_PROGRESS, ProgressEvent { downloaded, total });
    }

    Ok(dest.to_string_lossy().into_owned())
}

/// Extract a `.zip` / `.tar.gz` / `.tgz` archive into a temp dir. Returns the dir.
#[tauri::command]
pub fn update_extract(archive: String) -> Result<String, String> {
    let dest = std::env::temp_dir().join("aemeth-update-extract");
    // Start from a clean slate.
    let _ = std::fs::remove_dir_all(&dest);
    std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    let lower = archive.to_lowercase();
    if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        extract_tar_gz(&archive, &dest.to_str().unwrap_or(""))?;
    } else {
        extract_zip(&archive, &dest.to_str().unwrap_or(""))?;
    }
    Ok(dest.to_string_lossy().into_owned())
}

fn extract_zip(zip_path: &str, dest: &str) -> Result<(), String> {
    let file = std::fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(rel) = entry.enclosed_name().map(|p| p.to_path_buf()) else {
            continue;
        };
        let out = Path::new(dest).join(rel);
        if entry.name().ends_with('/') {
            std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = out.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut outfile = std::fs::File::create(&out).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut outfile).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn extract_tar_gz(tar_path: &str, dest: &str) -> Result<(), String> {
    use flate2::read::GzDecoder;
    use tar::Archive;
    let file = std::fs::File::open(tar_path).map_err(|e| e.to_string())?;
    let mut archive = Archive::new(GzDecoder::new(file));
    archive.unpack(dest).map_err(|e| e.to_string())?;
    Ok(())
}

/// Swap the running executable with the extracted one.
///
/// The current exe is moved aside (renaming a running exe is allowed on
/// Windows), then the new files are copied over the app directory. Returns the
/// path of the new executable to relaunch.
#[tauri::command]
pub fn update_apply(extract_dir: String) -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_dir = exe.parent().ok_or("cannot resolve exe dir")?;
    let extract = Path::new(&extract_dir);

    // Move the running exe aside so the new one can take its place.
    let old_dir = exe_dir.join("cache").join("old");
    std::fs::create_dir_all(&old_dir).map_err(|e| e.to_string())?;
    if let Some(name) = exe.file_name() {
        let backup = old_dir.join(format!("{}.old", name.to_string_lossy()));
        let _ = std::fs::remove_file(&backup);
        std::fs::rename(&exe, &backup).map_err(|e| e.to_string())?;
    }

    // Copy new files over the app directory.
    copy_dir_contents(extract, exe_dir)?;

    // Prefer the original exe path; fall back to any executable in the dir.
    if exe.exists() {
        return Ok(exe.to_string_lossy().into_owned());
    }
    find_executable(exe_dir).ok_or_else(|| "new executable not found after update".to_string())
}

fn find_executable(dir: &Path) -> Option<String> {
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        let is_exe = if cfg!(target_os = "windows") {
            path.extension().map(|e| e == "exe").unwrap_or(false)
        } else {
            path.is_file()
        };
        if is_exe {
            return Some(path.to_string_lossy().into_owned());
        }
    }
    None
}

fn copy_dir_contents(src: &Path, dst: &Path) -> Result<(), String> {
    for entry in std::fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        // Never clobber user data or the backup dir.
        if name == "cache" {
            continue;
        }
        let from = entry.path();
        let to = dst.join(&name);
        if from.is_dir() {
            std::fs::create_dir_all(&to).map_err(|e| e.to_string())?;
            copy_dir_contents(&from, &to)?;
        } else {
            std::fs::copy(&from, &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Spawn the new executable detached, then exit the current process.
#[tauri::command]
pub fn update_relaunch(manager: tauri::State<crate::pty::PtyManager>, exe_path: String) {
    // Make sure no stray shells survive the swap.
    manager.close_all();
    manager.wait_idle(std::time::Duration::from_secs(3));

    let spawn = || -> std::io::Result<std::process::Child> {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const DETACHED_PROCESS: u32 = 0x00000008;
            const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
            std::process::Command::new(&exe_path)
                .creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)
                .spawn()
        }
        #[cfg(not(target_os = "windows"))]
        {
            std::process::Command::new(&exe_path).spawn()
        }
    };

    if spawn().is_ok() {
        std::process::exit(0);
    }
}

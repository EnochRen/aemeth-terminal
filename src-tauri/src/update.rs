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

pub const EVENT_PROGRESS: &str = "download-progress";
const UPDATE_ENDPOINT: &str =
    "https://api.github.com/repos/EnochRen/aemeth-terminal/releases/latest";

#[derive(Clone, serde::Serialize)]
struct ProgressEvent {
    session_id: u64,
    downloaded_size: u64,
    total_size: u64,
    speed: u64,
    progress: f64,
}

#[derive(Clone, serde::Serialize)]
pub struct CheckResult {
    has_update: bool,
    version: String,
    body: String,
    download_url: Option<String>,
    file_size: Option<u64>,
    filename: Option<String>,
}

static DOWNLOAD_SESSION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

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
    get_update_target_raw()
}

/// Check GitHub Releases for a newer version. Returns None if up-to-date.
#[tauri::command]
pub fn check_update() -> Result<Option<CheckResult>, String> {
    let current = env!("CARGO_PKG_VERSION");
    let target = get_update_target_raw();
    tracing::info!(
        current_version = current,
        update_target = %target,
        endpoint = UPDATE_ENDPOINT,
        "starting update check"
    );

    let client = reqwest::blocking::Client::builder()
        .user_agent("aemeth-terminal-updater")
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| {
            tracing::error!(error = %e, "failed to create update HTTP client");
            format!("failed to create HTTP client: {e}")
        })?;

    let resp = client
        .get(UPDATE_ENDPOINT)
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .map_err(|e| {
            tracing::error!(error = %e, endpoint = UPDATE_ENDPOINT, "update check request failed");
            format!("request failed: {e}")
        })?;

    let status = resp.status();
    tracing::info!(%status, "received update check response");
    if !status.is_success() {
        tracing::error!(%status, endpoint = UPDATE_ENDPOINT, "GitHub API returned an error");
        return Err(format!("GitHub API returned {status}"));
    }

    let release: serde_json::Value = resp.json().map_err(|e| {
        tracing::error!(error = %e, "failed to decode GitHub release response");
        format!("failed to decode GitHub release response: {e}")
    })?;
    let latest = release["tag_name"]
        .as_str()
        .unwrap_or("")
        .trim_start_matches('v');
    let asset_count = release["assets"].as_array().map_or(0, Vec::len);
    tracing::info!(
        latest_version = latest,
        asset_count,
        "parsed latest GitHub release"
    );

    if latest.is_empty() {
        tracing::error!("GitHub release response did not contain tag_name");
        return Err("GitHub release response did not contain tag_name".to_string());
    }

    if !is_newer_semver(latest, current) {
        tracing::info!(
            current_version = current,
            latest_version = latest,
            "application is already up to date"
        );
        return Ok(None);
    }

    let is_win = target.starts_with("win");
    let ext = if is_win { ".zip" } else { ".tar.gz" };

    let assets = release["assets"]
        .as_array()
        .ok_or_else(|| {
            tracing::error!("GitHub release response did not contain an assets array");
            "missing assets in release JSON".to_string()
        })?;

    for asset in assets {
        let name = asset["name"].as_str().unwrap_or("");
        tracing::debug!(asset = name, "inspecting release asset");
        if name.contains(&target) && name.ends_with(ext) {
            let download_url = asset["browser_download_url"]
                .as_str()
                .map(|s| s.to_string());
            let file_size = asset["size"].as_u64();
            if download_url.is_none() {
                tracing::error!(asset = name, "compatible update asset has no download URL");
            }
            tracing::info!(
                asset = name,
                has_download_url = download_url.is_some(),
                file_size = ?file_size,
                "found compatible update asset"
            );
            return Ok(Some(CheckResult {
                has_update: true,
                version: format!("v{latest}"),
                body: release["body"].as_str().unwrap_or("").to_string(),
                download_url,
                file_size,
                filename: Some(name.to_string()),
            }));
        }
    }

    tracing::warn!(
        update_target = %target,
        expected_extension = ext,
        asset_count = assets.len(),
        available_assets = ?assets
            .iter()
            .filter_map(|asset| asset["name"].as_str())
            .collect::<Vec<_>>(),
        "new version exists but no compatible update asset was found"
    );
    Ok(None)
}

fn get_update_target_raw() -> String {
    let os = if cfg!(target_os = "windows") { "win" } else if cfg!(target_os = "macos") { "macos" } else { "linux" };
    let arch = if cfg!(target_arch = "x86_64") { "x86_64" } else if cfg!(target_arch = "aarch64") { "aarch64" } else { "unknown" };
    format!("{os}-{arch}")
}

fn is_newer_semver(latest: &str, current: &str) -> bool {
    let a: Vec<u32> = latest.split('.').filter_map(|s| s.parse().ok()).collect();
    let b: Vec<u32> = current.split('.').filter_map(|s| s.parse().ok()).collect();
    for i in 0..3 {
        let va = a.get(i).copied().unwrap_or(0);
        let vb = b.get(i).copied().unwrap_or(0);
        if va > vb { return true; }
        if va < vb { return false; }
    }
    false
}

#[tauri::command]
pub fn update_cancel(state: tauri::State<UpdateState>) {
    tracing::info!("cancelling update download");
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
    tracing::info!(%url, "starting update download");
    let session_id = DOWNLOAD_SESSION.fetch_add(1, Ordering::SeqCst) + 1;

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
            tracing::info!("update download cancelled by user");
            let _ = std::fs::remove_file(&dest);
            return Err("cancelled".to_string());
        }
        let n = resp.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        downloaded += n as u64;
        let progress = if total > 0 { (downloaded as f64 / total as f64) * 100.0 } else { 0.0 };
        let _ = app.emit(
            EVENT_PROGRESS,
            ProgressEvent {
                session_id,
                downloaded_size: downloaded,
                total_size: total,
                speed: 0,
                progress,
            },
        );
    }

    tracing::info!(downloaded, path = %dest.display(), "update download complete");
    Ok(dest.to_string_lossy().into_owned())
}

/// Extract a `.zip` / `.tar.gz` / `.tgz` archive into a temp dir. Returns the dir.
#[tauri::command]
pub fn update_extract(archive: String) -> Result<String, String> {
    tracing::info!(%archive, "starting update extraction");
    let dest = std::env::temp_dir().join("aemeth-update-extract");
    // Start from a clean slate.
    if let Err(e) = std::fs::remove_dir_all(&dest) {
        if e.kind() != std::io::ErrorKind::NotFound {
            tracing::warn!(error = %e, path = %dest.display(), "failed to remove old extraction directory");
        }
    }
    std::fs::create_dir_all(&dest).map_err(|e| {
        tracing::error!(error = %e, path = %dest.display(), "failed to create extraction directory");
        format!("failed to create extraction directory: {e}")
    })?;
    let lower = archive.to_lowercase();
    if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        extract_tar_gz(&archive, &dest.to_str().unwrap_or("")).map_err(|e| {
            tracing::error!(error = %e, archive = %archive, "failed to extract tar archive");
            e
        })?;
    } else {
        extract_zip(&archive, &dest.to_str().unwrap_or("")).map_err(|e| {
            tracing::error!(error = %e, archive = %archive, "failed to extract zip archive");
            e
        })?;
    }
    tracing::info!(path = %dest.display(), "update extraction complete");
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
    tracing::info!(%extract_dir, "starting update apply");
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_dir = exe.parent().ok_or("cannot resolve exe dir")?;
    let extract = Path::new(&extract_dir);
    tracing::info!(
        current_executable = %exe.display(),
        application_directory = %exe_dir.display(),
        "resolved update paths"
    );

    // Move the running exe aside so the new one can take its place.
    let old_dir = exe_dir.join("cache").join("old");
    std::fs::create_dir_all(&old_dir).map_err(|e| {
        tracing::error!(error = %e, path = %old_dir.display(), "failed to create update backup directory");
        e.to_string()
    })?;
    if let Some(name) = exe.file_name() {
        let backup = old_dir.join(format!("{}.old", name.to_string_lossy()));
        let _ = std::fs::remove_file(&backup);
        std::fs::rename(&exe, &backup).map_err(|e| {
            tracing::error!(
                error = %e,
                source = %exe.display(),
                backup = %backup.display(),
                "failed to move current executable to backup"
            );
            e.to_string()
        })?;
    }

    // Copy new files over the app directory.
    copy_dir_contents(extract, exe_dir).map_err(|e| {
        tracing::error!(error = %e, source = %extract.display(), destination = %exe_dir.display(), "failed to copy update files");
        e
    })?;

    // Prefer the original exe path; fall back to any executable in the dir.
    if exe.exists() {
        tracing::info!(executable = %exe.display(), "update apply complete");
        return Ok(exe.to_string_lossy().into_owned());
    }
    let fallback = find_executable(exe_dir).ok_or_else(|| {
        tracing::error!(directory = %exe_dir.display(), "new executable not found after update");
        "new executable not found after update".to_string()
    })?;
    tracing::info!(executable = %fallback, "update apply complete using fallback executable");
    Ok(fallback)
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
    tracing::info!(%exe_path, "relaunching with new executable");
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

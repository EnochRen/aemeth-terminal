/**
 * Portable zip-based auto-updater (MXU-style).
 *
 * Mirrors MistEO/MXU's approach: update check happens in Rust (reqwest,
 * bypassing webview fetch limitations), download streams progress via an
 * event, then the extracted zip swaps the executable and relaunches.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { DownloadProgress, DownloadStatus, UpdateInfo } from "@/types";

const log = {
  info: (...args: unknown[]) => console.log("[updater]", ...args),
  warn: (...args: unknown[]) => console.warn("[updater]", ...args),
  error: (...args: unknown[]) => console.error("[updater]", ...args),
};

interface CheckResult {
  has_update: boolean;
  version: string;
  body: string;
  download_url?: string;
  file_size?: number;
  filename?: string;
}

/** The update we last resolved, used by download/install. */
let pendingUpdate: UpdateInfo | null = null;
/** Path of the freshly applied executable, used by restartApp. */
let newExePath: string | null = null;
let isDownloading = false;
let progressUnlisten: UnlistenFn | null = null;
let devSimulationAborted = false;

/** Check GitHub Releases for a newer version, return structured info. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (import.meta.env.DEV) {
    log.info("Dev mode: simulating an available update for UI testing");
    const info: UpdateInfo = {
      hasUpdate: true,
      versionName: "v0.2.0-mock",
      releaseNote:
        "### 🚀 Features\n- Mock update for dev testing\n- **Bold text** and `inline code`\n\n### 🐛 Fixes\n- This is a simulated update",
    };
    pendingUpdate = info;
    return info;
  }

  try {
    const result = await invoke<CheckResult | null>("check_update");
    if (!result || !result.has_update) {
      const current = await invoke<string>("get_app_version");
      return { hasUpdate: false, versionName: current, releaseNote: "" };
    }

    const info: UpdateInfo = {
      hasUpdate: true,
      versionName: result.version,
      releaseNote: result.body ?? "",
      downloadUrl: result.download_url,
      fileSize: result.file_size,
      filename: result.filename,
    };
    pendingUpdate = info;
    return info;
  } catch (err) {
    log.warn("Update check failed:", err);
    return null;
  }
}

/**
 * Download, extract and apply the update.
 * Returns true on success (caller should prompt a restart).
 */
export async function downloadAndInstallUpdate(
  onProgress?: (progress: DownloadProgress) => void,
  onStatus?: (status: DownloadStatus) => void,
): Promise<boolean> {
  if (import.meta.env.DEV) {
    isDownloading = true;
    onStatus?.("downloading");
    devSimulationAborted = false;
    const total = 15 * 1024 * 1024;
    for (let i = 0; i <= 10; i++) {
      if (devSimulationAborted) {
        isDownloading = false;
        return false;
      }
      await new Promise((r) => setTimeout(r, 400));
      onProgress?.({
        downloadedSize: total * (i / 10),
        totalSize: total,
        speed: 3_000_000,
        progress: i * 10,
      });
    }
    onStatus?.("completed");
    isDownloading = false;
    return true;
  }

  if (!pendingUpdate?.downloadUrl || isDownloading) return false;

  isDownloading = true;
  onStatus?.("downloading");

  progressUnlisten?.();
  progressUnlisten = await listen<{
    session_id: number;
    downloaded_size: number;
    total_size: number;
    speed: number;
    progress: number;
  }>("download-progress", (e) => {
    onProgress?.({
      downloadedSize: e.payload.downloaded_size,
      totalSize: e.payload.total_size,
      speed: e.payload.speed,
      progress: e.payload.progress,
    });
  });

  try {
    const archive = await invoke<string>("update_download", {
      url: pendingUpdate.downloadUrl,
    });
    const extractDir = await invoke<string>("update_extract", { archive });
    newExePath = await invoke<string>("update_apply", { extractDir });
    onStatus?.("completed");
    return true;
  } catch (err) {
    log.error("Download/install failed:", err);
    onStatus?.("failed");
    return false;
  } finally {
    progressUnlisten?.();
    progressUnlisten = null;
    isDownloading = false;
  }
}

/** Relaunch into the newly applied executable. */
export async function restartApp(): Promise<void> {
  if (import.meta.env.DEV) return;
  if (!newExePath) {
    log.warn("No new executable to relaunch into");
    return;
  }
  await invoke("update_relaunch", { exePath: newExePath });
}

/** Cancel an active download. */
export async function cancelDownload(): Promise<void> {
  if (import.meta.env.DEV) {
    devSimulationAborted = true;
    isDownloading = false;
    return;
  }
  await invoke("update_cancel").catch(() => {});
  isDownloading = false;
}

/** Format bytes to human-readable string. */
export function formatSize(bytes: number): string {
  if (bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

/** Format bytes/sec to human-readable string. */
export function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond <= 0) return "";
  if (bytesPerSecond < 1024) return `${bytesPerSecond} B/s`;
  if (bytesPerSecond < 1048576) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSecond / 1048576).toFixed(1)} MB/s`;
}
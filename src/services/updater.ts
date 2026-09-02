/**
 * GitHub-based auto-updater service for Tauri v2.
 *
 * Uses `tauri-plugin-updater` which talks directly to the GitHub Releases API.
 * No MirrorChyan or dedicated server required for public repos.
 *
 * Reference: https://v2.tauri.app/plugin/updater/
 */
import { check as tauriCheck, type Update, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type { DownloadProgress, DownloadStatus, UpdateInfo } from "@/types";

const log = {
  info: (...args: unknown[]) => console.log("[updater]", ...args),
  warn: (...args: unknown[]) => console.warn("[updater]", ...args),
  error: (...args: unknown[]) => console.error("[updater]", ...args),
};

let currentUpdate: Update | null = null;
let isDownloading = false;
let accumulatedBytes = 0;
let totalBytes = 0;
let devSimulationAborted = false;

/** Check GitHub Releases for a newer version, return structured info. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const update = await tauriCheck();
    if (!update) {
      // In dev mode the plugin returns null — fall back to mock for UI testing
      if (import.meta.env.DEV) {
        log.info("Dev mode: simulating an available update for UI testing");
        return {
          hasUpdate: true,
          versionName: "v0.2.0-mock",
          releaseNote:
            "### 🚀 Features\n- Mock update for dev testing\n- **Bold text** and `inline code`\n\n### 🐛 Fixes\n- This is a simulated update",
        };
      }
      return { hasUpdate: false, versionName: "", releaseNote: "" };
    }

    currentUpdate = update;
    return {
      hasUpdate: true,
      versionName: update.version,
      releaseNote: update.body ?? "",
    };
  } catch (err) {
    log.warn("Update check failed:", err);
    return null; // null = network error, distinct from "no update"
  }
}

/** Get the raw Tauri Update object for download. */
export function getCurrentUpdate(): Update | null {
  return currentUpdate;
}

/**
 * Download the update with progress reporting.
 * Tauri's updater handles download + install natively.
 * On Windows the app exits after launching the installer.
 * On macOS/Linux we trigger a relaunch ourselves.
 */
export async function downloadAndInstallUpdate(
  onProgress?: (progress: DownloadProgress) => void,
  onStatus?: (status: DownloadStatus) => void,
): Promise<boolean> {
  // Dev mode: simulate a download with fake progress
  if (import.meta.env.DEV) {
    isDownloading = true;
    onStatus?.("downloading");
    const total = 15 * 1024 * 1024; // 15 MB fake
    devSimulationAborted = false;
    for (let i = 0; i <= 10; i++) {
      if (devSimulationAborted) {
        isDownloading = false;
        return false;
      }
      await new Promise((r) => setTimeout(r, 400));
      if (devSimulationAborted) {
        isDownloading = false;
        return false;
      }
      const done = total * (i / 10);
      onProgress?.({ downloadedSize: done, totalSize: total, speed: 3_000_000, progress: i * 10 });
    }
    onStatus?.("completed");
    isDownloading = false;
    return true;
  }

  if (!currentUpdate || isDownloading) return false;

  isDownloading = true;
  onStatus?.("downloading");
  accumulatedBytes = 0;
  totalBytes = 0;

  try {
    await currentUpdate.downloadAndInstall((event: DownloadEvent) => {
      switch (event.event) {
        case "Started":
          totalBytes = event.data.contentLength ?? 0;
          accumulatedBytes = 0;
          // Skip rendering 0/0 when content-length is unknown
          if (totalBytes === 0) {
            onProgress?.({ downloadedSize: 0, totalSize: 0, speed: 0, progress: 0 });
            break;
          }
          onProgress?.({
            downloadedSize: 0,
            totalSize: totalBytes,
            speed: 0,
            progress: 0,
          });
          break;
        case "Progress":
          accumulatedBytes += event.data.chunkLength;
          if (totalBytes > 0) {
            onProgress?.({
              downloadedSize: accumulatedBytes,
              totalSize: totalBytes,
              speed: 0,
              progress: (accumulatedBytes / totalBytes) * 100,
            });
          } else {
            // Unknown total — just report downloaded so far
            onProgress?.({
              downloadedSize: accumulatedBytes,
              totalSize: 0,
              speed: 0,
              progress: 0,
            });
          }
          break;
        case "Finished":
          onStatus?.("completed");
          break;
      }
    });

    onStatus?.("completed");
    return true;
  } catch (err) {
    log.error("Download/install failed:", err);
    onStatus?.("failed");
    return false;
  } finally {
    isDownloading = false;
  }
}

/** Relaunch the app (macOS/Linux after update install). */
export async function restartApp(): Promise<void> {
  try {
    await relaunch();
  } catch (err) {
    log.error("Restart failed:", err);
    throw err;
  }
}

/** Cancel active download. In dev mode aborts the simulation. */
export async function cancelDownload(): Promise<void> {
  if (import.meta.env.DEV) {
    devSimulationAborted = true;
    isDownloading = false;
    return;
  }
  if (currentUpdate) {
    try {
      await currentUpdate.close();
    } catch {
      /* ignore */
    }
  }
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
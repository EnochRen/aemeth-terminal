/**
 * Portable zip-based auto-updater (MXU-style).
 *
 * Queries the GitHub Releases API for the latest tag, picks the asset that
 * matches the current platform (`get_update_target`), downloads it with
 * streamed progress, extracts it, swaps the executable and relaunches.
 *
 * This replaces `tauri-plugin-updater`, which only understands signed
 * installer bundles and therefore could never work with our zip-only releases.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { DownloadProgress, DownloadStatus, UpdateInfo } from "@/types";

const GITHUB_OWNER = "EnochRen";
const GITHUB_REPO = "aemeth-terminal";
const RELEASES_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

const log = {
  info: (...args: unknown[]) => console.log("[updater]", ...args),
  warn: (...args: unknown[]) => console.warn("[updater]", ...args),
  error: (...args: unknown[]) => console.error("[updater]", ...args),
};

interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}
interface GitHubRelease {
  tag_name: string;
  body: string | null;
  assets: GitHubAsset[];
}

/** The update we last resolved, used by download/install. */
let pendingUpdate: UpdateInfo | null = null;
/** Path of the freshly applied executable, used by restartApp. */
let newExePath: string | null = null;
let isDownloading = false;
let progressUnlisten: UnlistenFn | null = null;
let devSimulationAborted = false;

function isNewer(latest: string, current: string): boolean {
  const a = latest.split(".").map((n) => parseInt(n, 10) || 0);
  const b = current.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false;
  }
  return false;
}

/** Check GitHub Releases for a newer version, return structured info. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  // In dev mode there is no real release pipeline — simulate for UI testing.
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
    const [current, target] = await Promise.all([
      invoke<string>("get_app_version"),
      invoke<string>("get_update_target"),
    ]);

    const res = await fetch(RELEASES_API, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) {
      log.warn("Release API responded", res.status);
      return null;
    }
    const release = (await res.json()) as GitHubRelease;
    const latest = release.tag_name.replace(/^v/, "");

    if (!isNewer(latest, current)) {
      return { hasUpdate: false, versionName: current, releaseNote: "" };
    }

    const isWindows = target.startsWith("win");
    const ext = isWindows ? ".zip" : ".tar.gz";
    const asset = release.assets.find(
      (a) => a.name.includes(target) && a.name.endsWith(ext),
    );
    if (!asset) {
      log.warn("No matching asset for target", target);
      return { hasUpdate: false, versionName: current, releaseNote: "" };
    }

    const info: UpdateInfo = {
      hasUpdate: true,
      versionName: release.tag_name,
      releaseNote: release.body ?? "",
      downloadUrl: asset.browser_download_url,
      fileSize: asset.size,
      filename: asset.name,
    };
    pendingUpdate = info;
    return info;
  } catch (err) {
    log.warn("Update check failed:", err);
    return null; // null = network error, distinct from "no update"
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
  // Dev mode: simulate a download with fake progress.
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

  // Stream download progress from the backend.
  progressUnlisten?.();
  progressUnlisten = await listen<{ downloaded: number; total: number }>(
    "aemeth://update-progress",
    (e) => {
      const { downloaded, total } = e.payload;
      onProgress?.({
        downloadedSize: downloaded,
        totalSize: total,
        speed: 0,
        progress: total > 0 ? (downloaded / total) * 100 : 0,
      });
    },
  );

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
  // Does not return on success — the process exits after spawning the new exe.
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

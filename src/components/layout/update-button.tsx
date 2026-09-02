import { useEffect, useState, useCallback, useRef } from "react";
import {
  Download,
  X,
  PackageCheck,
  RefreshCw,
  AlertCircle,
  ArrowBigUp,
  Loader2,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useT } from "@/i18n/use-t";
import { useAppStore } from "@/store/use-app-store";
import type { DownloadProgress, DownloadStatus, UpdateInfo } from "@/types";
import {
  checkForUpdate,
  downloadAndInstallUpdate,
  restartApp,
  cancelDownload,
  formatSize,
} from "@/services/updater";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { dictionaries } from "@/i18n/locales";

/**
 * Bottom-left sidebar icon that opens a popover.
 * User clicks "Check for updates" → popover shows result.
 * If an update is available: version info, release notes, download progress.
 *
 * Design reference: MaaEnd / MXU approach, simplified for GitHub-only.
 */
export function UpdateButton() {
  const t = useT();
  const settings = useAppStore((s) => s.settings);
  const locale = useAppStore((s) => s.locale);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>("idle");
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [checking, setChecking] = useState(false);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const d = dictionaries[locale];

  // ─── Background check on mount (for auto-update) ───
  useEffect(() => {
    void (async () => {
      const info = await checkForUpdate();
      if (!info) return;

      if (info.hasUpdate && settings.autoUpdate) {
        setUpdateInfo(info);
        const ok = await downloadAndInstallUpdate(
          (p) => setDownloadProgress(p),
          (s) => setDownloadStatus(s),
        );
        if (ok) {
          toast.success(d.update.restartToApply, {
            action: {
              label: d.update.restart,
              onClick: () => void restartApp(),
            },
            duration: 0,
          });
        }
      } else if (info.hasUpdate) {
        // Just flag the icon, don't auto-download
        setUpdateInfo(info);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Click-outside & ESC handling ───
  useEffect(() => {
    if (!panelOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setPanelOpen(false);
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanelOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [panelOpen]);

  // ─── User-initiated check ───
  const handleCheck = useCallback(async () => {
    setChecking(true);
    const info = await checkForUpdate();
    setChecking(false);

    if (!info) {
      toast.error(t.update.checkFailed);
      return;
    }

    if (info.hasUpdate) {
      setUpdateInfo(info);
    } else {
      setUpdateInfo(info); // hasUpdate: false, show "up to date" in panel
    }
  }, [t.update.checkFailed]);

  // ─── Manual download ───
  const handleStartDownload = useCallback(async () => {
    setDownloadStatus("downloading");
    const ok = await downloadAndInstallUpdate(
      (p) => setDownloadProgress(p),
      (s) => setDownloadStatus(s),
    );
    if (ok) {
      toast.success(d.update.restartToApply, {
        action: {
          label: d.update.restart,
          onClick: () => void restartApp(),
        },
        duration: 0,
      });
    } else {
      toast.error(d.update.downloadFailed);
    }
  }, [d]);

  // ─── Cancel download ───
  const handleCancelDownload = useCallback(async () => {
    await cancelDownload();
    setDownloadStatus("idle");
    setDownloadProgress(null);
  }, []);

  // ─── Simple markdown → HTML (###, **, `, -, numbers) ───
  const renderMarkdown = (md: string): string => {
    return md
      .replace(/### (.+)/gm,
        "<h4 class='text-[12px] font-semibold text-foreground mt-3 mb-1'>$1</h4>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
      .replace(/`([^`\n]+)`/g,
        "<code class='text-accent bg-[#1a1a1a] px-1 py-0.5 rounded text-[11px]'>$1</code>")
      .replace(/^- (.+)/gm, "• $1")
      .replace(/^(\d+)\. (.+)/gm, "$1. $2")
      .replace(/\n\n/g, "<br/><br/>");
  };

  // ─── Render ───
  const hasUpdate = updateInfo?.hasUpdate;
  const showBadge = hasUpdate && downloadStatus === "idle";

  return (
    <>
      {/* Button — always shows refresh icon, badge when update available */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={buttonRef}
            type="button"
            onClick={() => setPanelOpen((v) => !v)}
            className={cn(
              "relative flex size-9 items-center justify-center rounded-md text-[#a1a1a1] transition-colors duration-100",
              "hover:bg-accent hover:text-foreground",
              panelOpen && "bg-accent text-foreground",
            )}
            aria-label={t.update.badgeLabel}
          >
            <RefreshCw className="size-4" strokeWidth={1.75} />
            {/* Badge dot when update is available but not downloaded yet */}
            {showBadge && (
              <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-state-running ring-1 ring-[#000]" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="font-mono text-xs">
          {downloadStatus === "downloading"
            ? `${t.update.downloading} ${downloadProgress ? Math.round(downloadProgress.progress) : 0}%`
            : hasUpdate
              ? t.update.badgeLabel
              : t.sidebar.settings}
        </TooltipContent>
      </Tooltip>

      {/* Popover */}
      {panelOpen && (
        <div
          ref={panelRef}
          className="fixed z-50 w-80 bg-[#0e0e0e] rounded-xl shadow-xl border border-border overflow-hidden animate-in slide-in-from-left"
          style={{
            left: "4rem",
            bottom: "4rem",
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-[#141414] border-b border-border">
            <div className="flex items-center gap-2">
              {hasUpdate ? (
                <ArrowBigUp className="size-4 text-state-running" />
              ) : (
                <RefreshCw className="size-4 text-accent" />
              )}
              <span className="text-[13px] font-medium text-foreground">
                {hasUpdate ? t.update.newVersion : "Updates"}
              </span>
              {hasUpdate && (
                <span className="font-mono text-[13px] text-accent font-semibold">
                  {updateInfo!.versionName}
                </span>
              )}
            </div>
            <button
              onClick={() => setPanelOpen(false)}
              className="p-1 rounded-md hover:bg-border/50 transition-colors"
            >
              <X className="size-3.5 text-[#666]" />
            </button>
          </div>

          {/* Content */}
          <div className="p-4 space-y-4">
            {/* No result yet → show check button */}
            {!updateInfo && (
              <button
                onClick={handleCheck}
                disabled={checking}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-medium bg-accent text-white hover:brightness-110 transition-colors disabled:opacity-50"
              >
                {checking ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Checking...
                  </>
                ) : (
                  <>
                    <RefreshCw className="size-3.5" />
                    Check for updates
                  </>
                )}
              </button>
            )}

            {/* Up to date */}
            {updateInfo && !hasUpdate && (
              <div className="space-y-3">
                <p className="text-xs text-[#a1a1a1] text-center">
                  {t.update.upToDate.replace("{version}", updateInfo.versionName || `v${settings.autoUpdate ? "?" : ""}`)}
                </p>
                <button
                  onClick={handleCheck}
                  disabled={checking}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-medium text-[#a1a1a1] bg-[#141414] border border-border hover:bg-[#1a1a1a] transition-colors disabled:opacity-50"
                >
                  {checking ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3.5" />
                  )}
                  Check again
                </button>
              </div>
            )}

            {/* Update available */}
            {updateInfo?.hasUpdate && (
              <>
                {/* Release notes */}
                {updateInfo.releaseNote && (
                  <div className="space-y-2">
                    <p className="text-[11px] font-medium text-[#888] uppercase tracking-wider">
                      {t.update.releaseNotes}
                    </p>
                    <div className="max-h-32 overflow-y-auto rounded-lg bg-[#141414] border border-border p-3">
                      <div
                        className="text-xs text-[#a1a1a1] leading-relaxed whitespace-pre-wrap break-words"
                        dangerouslySetInnerHTML={{
                          __html: renderMarkdown(updateInfo.releaseNote),
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Download controls */}
                <div className="space-y-2 border-t border-border pt-3">
                  {/* Progress bar */}
                  {(downloadStatus === "downloading" || downloadStatus === "completed") &&
                    downloadProgress && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] text-[#666]">
                          <span>
                            {downloadStatus === "downloading"
                              ? t.update.downloading
                              : t.update.downloadComplete}
                          </span>
                          {downloadProgress.totalSize > 0 && (
                            <span>{downloadProgress.progress.toFixed(1)}%</span>
                          )}
                        </div>
                        <div className="h-1.5 rounded-full bg-[#1a1a1a] overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all duration-150",
                              downloadStatus === "completed" ? "bg-state-running" : "bg-accent",
                            )}
                            style={{
                              width: `${downloadProgress.totalSize > 0 ? downloadProgress.progress : downloadProgress.downloadedSize > 0 ? 5 : 0}%`,
                            }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-[#555]">
                          <span>
                            {formatSize(downloadProgress.downloadedSize)}
                            {downloadProgress.totalSize > 0 &&
                              ` / ${formatSize(downloadProgress.totalSize)}`}
                          </span>
                          {downloadStatus === "downloading" && (
                            <button
                              onClick={handleCancelDownload}
                              className="text-[#666] hover:text-foreground transition-colors"
                            >
                              <X className="size-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                  {/* Failed state */}
                  {downloadStatus === "failed" && (
                    <div className="flex items-center gap-2 text-[11px] text-[#e5484d]">
                      <AlertCircle className="size-3.5 shrink-0" />
                      <span>{t.update.downloadFailed}</span>
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex gap-2">
                    {downloadStatus === "completed" ? (
                      <button
                        onClick={() => void restartApp()}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-state-running text-white hover:brightness-110 transition-colors"
                      >
                        <PackageCheck className="size-3.5" />
                        {t.update.restart}
                      </button>
                    ) : downloadStatus === "idle" ? (
                      <button
                        onClick={handleStartDownload}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-accent text-white hover:brightness-110 transition-colors"
                      >
                        <Download className="size-3.5" />
                        {t.update.installNow}
                      </button>
                    ) : downloadStatus === "failed" ? (
                      <button
                        onClick={handleStartDownload}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-accent text-white hover:brightness-110 transition-colors"
                      >
                        <RefreshCw className="size-3.5" />
                        {t.update.retry}
                      </button>
                    ) : null}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
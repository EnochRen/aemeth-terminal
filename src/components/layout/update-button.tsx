import { useEffect, useState, useCallback, useRef } from "react";
import {
  Download,
  X,
  PackageCheck,
  RefreshCw,
  AlertCircle,
  ArrowBigUp,
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
 * Renders as a bottom-left badge icon in the sidebar rail.
 * When an update is available, shows a popover with version info
 * and download controls.
 *
 * Design reference: MaaEnd / MXU UpdatePanel approach but simplified
 * for GitHub-only public repo updates.
 */
export function UpdateButton() {
  const t = useT();
  const settings = useAppStore((s) => s.settings);
  const locale = useAppStore((s) => s.locale);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>("idle");
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const hasCheckedRef = useRef(false);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const d = dictionaries[locale];

  // ─── Check for update on mount (once) ───
  useEffect(() => {
    if (hasCheckedRef.current) return;
    hasCheckedRef.current = true;

    void (async () => {
      const info = await checkForUpdate();
      if (!info) return; // network error, silently ignore

      if (info.hasUpdate) {
        setUpdateInfo(info);
        // Auto-download if autoUpdate is enabled
        if (settings.autoUpdate) {
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
        }
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

  // ─── Simple markdown → HTML (covers ###, **, `, -) ───
  const renderMarkdown = (md: string): string => {
    return md
      .replace(/### (.+)/gm, "<h4 class='text-[12px] font-semibold text-foreground mt-3 mb-1'>$1</h4>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
      .replace(/`([^`\n]+)`/g, "<code class='text-accent bg-[#1a1a1a] px-1 py-0.5 rounded text-[11px]'>$1</code>")
      .replace(/^- (.+)/gm, "• $1")
      .replace(/^(\d+)\. (.+)/gm, "$1. $2")
      .replace(/\n\n/g, "<br/><br/>");
  };

  // ─── Render ───
  const hasUpdate = updateInfo?.hasUpdate;
  const showBadge = hasUpdate && downloadStatus === "idle";

  return (
    <>
      {/* Button (bottom-left icon) */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={buttonRef}
            type="button"
            onClick={() => {
              if (downloadStatus === "downloading") {
                setPanelOpen((v) => !v);
              } else if (hasUpdate) {
                setPanelOpen((v) => !v);
              }
              // If no update, button does nothing
            }}
            className={cn(
              "relative flex size-9 items-center justify-center rounded-md text-[#a1a1a1] transition-colors duration-100",
              "hover:bg-accent hover:text-foreground",
              panelOpen && "bg-accent text-foreground",
            )}
            aria-label={t.update.badgeLabel}
          >
            {downloadStatus === "downloading" ? (
              <Download className="size-4 animate-pulse" strokeWidth={1.75} />
            ) : downloadStatus === "completed" ? (
              <PackageCheck className="size-4 text-state-running" strokeWidth={1.75} />
            ) : hasUpdate ? (
              <ArrowBigUp className="size-4 text-state-running" strokeWidth={1.75} />
            ) : (
              <Download className="size-4" strokeWidth={1.75} />
            )}
            {/* Badge dot */}
            {showBadge && (
              <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-state-running ring-1 ring-[#000]" />
            )}
            {/* Mini progress bar */}
            {downloadStatus === "downloading" && downloadProgress && downloadProgress.totalSize > 0 && (
              <span
                className="absolute bottom-0.5 left-1 right-1 h-0.5 rounded-full bg-[#1a1a1a]"
                aria-hidden
              >
                <span
                  className="block h-full rounded-full bg-accent transition-all"
                  style={{ width: `${Math.min(downloadProgress.progress, 100)}%` }}
                />
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="font-mono text-xs">
          {downloadStatus === "downloading"
            ? `${t.update.downloading} ${downloadProgress ? Math.round(downloadProgress.progress) : 0}%`
            : downloadStatus === "completed"
              ? t.update.restartToApply
              : hasUpdate
                ? t.update.badgeLabel
                : t.update.upToDate.replace("{version}", updateInfo?.versionName || "—")}
        </TooltipContent>
      </Tooltip>

      {/* Flyout panel */}
      {panelOpen && updateInfo?.hasUpdate && (
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
            <div className="flex items-center gap-2 min-w-0">
              <Download className="size-4 shrink-0 text-accent" />
              <span className="text-[13px] font-medium text-foreground truncate">
                {t.update.newVersion}
              </span>
              <span className="font-mono text-[13px] text-accent font-semibold shrink-0">
                {updateInfo.versionName}
              </span>
            </div>
            <button
              onClick={() => setPanelOpen(false)}
              className="p-1 rounded-md hover:bg-border/50 transition-colors shrink-0 ml-2"
            >
              <X className="size-3.5 text-[#666]" />
            </button>
          </div>

          {/* Content */}
          <div className="p-4 space-y-4">
            {/* Release notes */}
            {updateInfo.releaseNote && (
              <div className="space-y-2">
                <p className="text-[11px] font-medium text-[#888] uppercase tracking-wider">
                  {t.update.releaseNotes}
                </p>
                <div className="max-h-40 overflow-y-auto rounded-lg bg-[#141414] border border-border p-3">
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
                          width: `${downloadProgress.totalSize > 0 ? downloadProgress.progress : 100}%`,
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
          </div>
        </div>
      )}
    </>
  );
}
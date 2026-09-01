import { useMemo, useState } from "react";
import { LayoutGrid, List, Play, Square, Loader2 } from "lucide-react";

import { AppActionButtons } from "@/components/apps/app-action-buttons";
import { AppActionsMenu } from "@/components/apps/app-actions-menu";
import { AppCard } from "@/components/apps/app-card";
import { ShellBadge } from "@/components/shared/shell-badge";
import { StatusPill, StatusDot } from "@/components/shared/status-pill";
import { Button } from "@/components/ui/button";
import { openUrl } from "@/lib/pty";
import { fmt } from "@/i18n/locales";
import { useT } from "@/i18n/use-t";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/use-app-store";
import type { AppConfig, SessionStatus } from "@/types";

type ViewMode = "card" | "table";

export function AppsView() {
  const t = useT();
  const apps = useAppStore((s) => s.apps);
  const sessions = useAppStore((s) => s.sessions);
  const batchStartApps = useAppStore((s) => s.batchStartApps);
  const batchStopApps = useAppStore((s) => s.batchStopApps);
  const batchState = useAppStore((s) => s.batchState);

  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const mode = settings.appsViewMode;
  const setMode = (v: ViewMode) => setSettings({ appsViewMode: v });
  const [activeTag, setActiveTag] = useState<string | null>(null);

  // Unique tags across all apps.
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const a of apps) {
      for (const tag of a.tags ?? []) set.add(tag);
    }
    return [...set].sort();
  }, [apps]);

  // Apps matching the active tag filter (or all when no tag selected).
  const filtered = activeTag
    ? apps.filter((a) => (a.tags ?? []).includes(activeTag))
    : apps;

  const running = Object.values(sessions).filter((s) => s.state === "running").length;
  const filteredRunning = filtered.filter(
    (a) => sessions[a.id]?.state === "running",
  ).length;

  return (
    <div className="flex h-full flex-col">
      {/* Header toolbar */}
      <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border px-5">
        <h1 className="text-[13.5px] font-semibold tracking-tight">{t.apps.title}</h1>
        <span className="font-mono text-[11px] text-[#666]">
          {fmt(t.apps.count, { apps: apps.length, running })}
        </span>

        <div className="ml-auto flex items-center gap-1">
          {/* View mode toggle */}
          <div className="flex items-center rounded-md border border-border p-px mr-1">
            <button
              type="button"
              onClick={() => setMode("card")}
              className={cn(
                "flex h-6 w-7 items-center justify-center rounded-sm transition-colors",
                mode === "card"
                  ? "bg-accent text-foreground"
                  : "text-[#666] hover:text-foreground",
              )}
              title={t.apps.cardMode}
            >
              <LayoutGrid className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setMode("table")}
              className={cn(
                "flex h-6 w-7 items-center justify-center rounded-sm transition-colors",
                mode === "table"
                  ? "bg-accent text-foreground"
                  : "text-[#666] hover:text-foreground",
              )}
              title={t.apps.tableMode}
            >
              <List className="size-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Tag filter bar + batch actions */}
      {allTags.length > 0 && (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 px-5">
          <button
            type="button"
            onClick={() => setActiveTag(null)}
            className={cn(
              "shrink-0 rounded-md px-2.5 py-0.5 font-mono text-[11px] transition-colors",
              activeTag === null
                ? "bg-accent text-foreground"
                : "text-[#666] hover:text-foreground",
            )}
          >
            {t.apps.allTags}
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setActiveTag(tag)}
              className={cn(
                "shrink-0 rounded-md px-2.5 py-0.5 font-mono text-[11px] transition-colors",
                activeTag === tag
                  ? "bg-accent text-foreground"
                  : "text-[#666] hover:text-foreground",
              )}
            >
              {tag}
            </button>
          ))}

          <div className="ml-auto flex items-center gap-1.5">
            <span className="mr-1 font-mono text-[10px] text-[#525252]">
              {fmt(t.apps.count, { apps: filtered.length, running: filteredRunning })}
            </span>
            <Button
              size="sm"
              className="h-6 gap-1 px-2 text-[10px]"
              disabled={batchState !== null}
              onClick={() => void batchStartApps(filtered.map((a) => a.id))}
            >
              {batchState === "starting" ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Play className="size-3" />
              )}
              {t.apps.startAll}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 gap-1 px-2 text-[10px] text-[#a1a1a1]"
              disabled={batchState !== null}
              onClick={() => void batchStopApps(filtered.map((a) => a.id))}
            >
              {batchState === "stopping" ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Square className="size-3" />
              )}
              {t.apps.stopAll}
            </Button>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {apps.length === 0 ? (
          <EmptyState />
        ) : mode === "card" ? (
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(340px,1fr))]">
            {filtered.map((app) => (
              <AppCard key={app.id} app={app} />
            ))}
          </div>
        ) : (
          <AppTable apps={filtered} sessions={sessions} />
        )}
      </div>
    </div>
  );
}

function AppTable({
  apps,
  sessions,
}: {
  apps: AppConfig[];
  sessions: Record<string, SessionStatus>;
}) {
  const t = useT();

  return (
    <div className="min-w-0 overflow-auto p-px">
      <table className="w-full border-collapse font-mono text-[11.5px]">
        <thead className="sticky top-0 z-10 bg-background">
          <tr className="border-b border-border text-left text-[10.5px] text-[#666]">
            <th className="py-2 pl-5 pr-2 font-medium">{t.apps.colName}</th>
            <th className="px-2 py-2 font-medium">{t.apps.colStatus}</th>
            <th className="hidden px-2 py-2 font-medium lg:table-cell">{t.apps.colShell}</th>
            <th className="hidden px-2 py-2 font-medium xl:table-cell">{t.apps.colPorts}</th>
            <th className="hidden px-2 py-2 font-medium xl:table-cell">{t.apps.colTags}</th>
            <th className="px-2 py-2 pr-5 text-right font-medium">{t.apps.colActions}</th>
          </tr>
        </thead>
        <tbody>
          {apps.map((app) => {
            const session = sessions[app.id];
            const running = session?.state === "running";
            const exited = session?.state === "exited";
            const isScript = app.kind === "script";

            return (
              <tr
                key={app.id}
                className="border-b border-border/50 transition-colors hover:bg-accent/40"
              >
                {/* Name */}
                <td className="py-1.5 pl-5 pr-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: app.color }}
                    />
                    <span className="truncate font-medium text-foreground">{app.name}</span>
                  </div>
                </td>

                {/* Status */}
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <StatusDot session={session} />
                    <StatusPill session={session} />
                    {running && session?.healthy !== undefined && (
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          session!.healthy ? "bg-state-running" : "bg-state-error",
                        )}
                        title={session!.healthy ? t.status.healthy : t.status.unhealthy}
                      />
                    )}
                    {exited && isScript && session && (
                      <span className="text-[10.5px] text-[#666]">
                        code {session.exitCode ?? 0}
                        {session.durationMs !== undefined && (
                          <> · {fmt(t.card.duration, { t: (session.durationMs / 1000).toFixed(1) })}</>
                        )}
                      </span>
                    )}
                  </div>
                </td>

                {/* Shell */}
                <td className="hidden px-2 py-1.5 lg:table-cell">
                  <ShellBadge kind={app.shell} />
                </td>

{/* Ports */}
                <td className="hidden px-2 py-1.5 xl:table-cell">
                  {running && (session?.ports?.length ?? 0) > 0 ? (
                    <span className="text-state-running">
                      {session!.ports!.map((p, i) => (
                        <span key={p}>
                          {i > 0 && " "}
                          <button
                            type="button"
                            onClick={() => void openUrl(`http://localhost:${p}`)}
                            className="inline-flex items-center gap-0.5 rounded px-0.5 hover:bg-accent transition-colors"
                            title={`Open http://localhost:${p}`}
                          >
                            :{p}
                          </button>
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-[#3f3f3f]">—</span>
                  )}
                </td>

                {/* Tags */}
                <td className="hidden px-2 py-1.5 xl:table-cell">
                  <span className="text-[#525252]">
                    {app.tags?.join(", ") || "—"}
                  </span>
                </td>

                {/* Actions */}
                <td className="px-2 py-1.5 pr-5">
                  <div className="flex items-center justify-end gap-1">
                    <AppActionButtons app={app} size="sm" />
                    <AppActionsMenu app={app} className="opacity-100" />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState() {
  const t = useT();
  const openEditor = useAppStore((s) => s.openEditor);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
      <div className="flex size-9 items-center justify-center rounded-md border border-[#333] font-mono text-sm text-foreground">
        Æ
      </div>
      <div className="space-y-1.5">
        <p className="label-micro">{t.apps.emptyLabel}</p>
        <p className="mx-auto max-w-sm text-[12.5px] leading-relaxed text-[#a1a1a1]">
          {t.apps.emptyDesc}
        </p>
      </div>
      <button
        type="button"
        onClick={() => openEditor(null)}
        className="font-mono text-[11px] text-[#a1a1a1] underline decoration-[#333] underline-offset-4 transition-colors hover:text-foreground"
      >
        {t.apps.createFirst} →
      </button>
    </div>
  );
}

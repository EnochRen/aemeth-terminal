import { useMemo, useState, useCallback } from "react";
import { LayoutGrid, List, Play, Square, Loader2, ArrowUpDown, GripHorizontal } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { AppActionButtons } from "@/components/apps/app-action-buttons";
import { AppActionsMenu } from "@/components/apps/app-actions-menu";
import { AppCard } from "@/components/apps/app-card";
import { BrandMark } from "@/components/shared/brand-mark";
import { ShellBadge } from "@/components/shared/shell-badge";
import { StatusPill } from "@/components/shared/status-pill";
import { Button } from "@/components/ui/button";
import { openUrl } from "@/lib/pty";
import { fmt } from "@/i18n/locales";
import { useT } from "@/i18n/use-t";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/use-app-store";
import type { AppConfig, AppsSortMode, SessionStatus } from "@/types";

type ViewMode = "card" | "table";

// ─── Sort helpers ───

const SORT_MODE_LABELS: Record<AppsSortMode, "sortRecent" | "sortName"> = {
  recent: "sortRecent",
  name: "sortName",
};

/** Default direction for each mode (the "natural" first-click order). */
const SORT_MODE_DEFAULT_ASC: Record<AppsSortMode, boolean> = {
  recent: false, // highest sortOrder first = descending
  name: true, // A→Z = ascending
};

function sortApps(apps: AppConfig[], mode: AppsSortMode, asc: boolean): AppConfig[] {
  const sorted = [...apps];
  if (mode === "name") {
    // Natural order: A→Z (ascending).
    sorted.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  } else {
    // Natural order: highest sortOrder first (descending by sortOrder).
    sorted.sort((a, b) => b.sortOrder - a.sortOrder);
  }
  // The natural order above is the "asc = default" direction.
  // When `asc` doesn't match the default, reverse.
  if (asc !== SORT_MODE_DEFAULT_ASC[mode]) sorted.reverse();
  return sorted;
}

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

  // Sort controls
  const sortMode = settings.appsSortMode;
  const sortAsc = settings.appsSortAsc;

  const handleSortChange = useCallback(
    (next: AppsSortMode) => {
      if (next === sortMode) {
        // Same mode → toggle direction.
        setSettings({ appsSortAsc: !sortAsc });
      } else {
        // New mode → apply its default direction.
        setSettings({ appsSortMode: next, appsSortAsc: SORT_MODE_DEFAULT_ASC[next] });
      }
    },
    [sortMode, sortAsc, setSettings],
  );

  // Unique tags across all apps, respecting user-defined order.
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const a of apps) {
      for (const tag of a.tags ?? []) set.add(tag);
    }
    const discovered = [...set];
    // Stable sort: user-ordered tags first, then discovered-only tags alphabetically.
    const orderMap = new Map(settings.tagOrder.map((t, i) => [t, i]));
    return discovered.sort((a, b) => {
      const ai = orderMap.get(a);
      const bi = orderMap.get(b);
      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (ai !== undefined) return -1;
      if (bi !== undefined) return 1;
      return a.localeCompare(b);
    });
  }, [apps, settings.tagOrder]);

  // Apps matching the active tag filter (or all when no tag selected).
  const filtered = useMemo(() => {
    const base = activeTag
      ? apps.filter((a) => (a.tags ?? []).includes(activeTag))
      : apps;
    return sortApps(base, sortMode, sortAsc);
  }, [apps, activeTag, sortMode, sortAsc]);

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
          {/* Sort toggle */}
          <div className="flex items-center rounded-md border border-border p-px mr-1">
            {(Object.keys(SORT_MODE_LABELS) as AppsSortMode[]).map((sm) => {
              const isActive = sm === sortMode;
              return (
                <button
                  key={sm}
                  type="button"
                  onClick={() => handleSortChange(sm)}
                  className={cn(
                    "flex h-6 items-center gap-1 rounded-sm px-2 text-[10.5px] font-medium transition-colors",
                    isActive
                      ? "bg-accent text-foreground"
                      : "text-[#666] hover:text-foreground",
                  )}
                  title={
                    isActive
                      ? sortAsc
                        ? t.apps.sortAsc
                        : t.apps.sortDesc
                      : t.apps[SORT_MODE_LABELS[sm]]
                  }
                >
                  {t.apps[SORT_MODE_LABELS[sm]]}
                  {isActive && (
                    <ArrowUpDown
                      className={cn(
                        "size-3 transition-transform",
                        sortAsc && "rotate-180",
                      )}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* View mode toggle */}
          <div className="flex items-center rounded-md border border-border p-px">
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
        <SortableTagBar
          allTags={allTags}
          activeTag={activeTag}
          onTagClick={setActiveTag}
          filtered={filtered}
          filteredRunning={filteredRunning}
          batchState={batchState}
          batchStartApps={batchStartApps}
          batchStopApps={batchStopApps}
        />
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

// ─── Sortable tag bar ───

interface SortableTagBarProps {
  allTags: string[];
  activeTag: string | null;
  onTagClick: (tag: string | null) => void;
  filtered: AppConfig[];
  filteredRunning: number;
  batchState: "starting" | "stopping" | null;
  batchStartApps: (appIds: string[]) => Promise<void>;
  batchStopApps: (appIds: string[]) => Promise<void>;
}

function SortableTagBar({
  allTags,
  activeTag,
  onTagClick,
  filtered,
  filteredRunning,
  batchState,
  batchStartApps,
  batchStopApps,
}: SortableTagBarProps) {
  const t = useT();
  const tagOrder = useAppStore((s) => s.settings.tagOrder);
  const setSettings = useAppStore((s) => s.setSettings);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      // Ensure the working list includes every currently visible tag,
      // so newly discovered tags can be reordered on first drag.
      let working = [...tagOrder];
      for (const t of allTags) {
        if (!working.includes(t)) working.push(t);
      }

      const oldIndex = working.indexOf(String(active.id));
      const newIndex = working.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1) return;

      const newOrder = arrayMove(working, oldIndex, newIndex);
      setSettings({ tagOrder: newOrder });
    },
    [tagOrder, allTags, setSettings],
  );

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 px-5">
      {/* "All" chip — fixed, not draggable */}
      <button
        type="button"
        onClick={() => onTagClick(null)}
        className={cn(
          "shrink-0 cursor-pointer rounded-md px-2.5 py-0.5 font-mono text-[11px] transition-colors select-none",
          activeTag === null
            ? "bg-accent text-foreground"
            : "text-[#666] hover:text-foreground",
        )}
      >
        {t.apps.allTags}
      </button>

      {/* Draggable sortable tags */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={allTags} strategy={horizontalListSortingStrategy}>
          <div className="flex items-center gap-2">
            {allTags.map((tag) => (
              <SortableTag
                key={tag}
                tag={tag}
                active={activeTag === tag}
                onClick={() => onTagClick(tag)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* Batch actions (right-aligned) */}
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
  );
}

function SortableTag({
  tag,
  active,
  onClick,
}: {
  tag: string;
  active: boolean;
  onClick: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tag });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group flex shrink-0 items-center gap-0.5 rounded-md font-mono text-[11px] transition-colors select-none",
        isDragging ? "z-50 opacity-80 shadow-lg" : "",
        active
          ? "bg-accent text-foreground"
          : "text-[#666] hover:text-foreground",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "cursor-pointer rounded-md px-2.5 py-0.5",
          active && "rounded-r-sm pr-1",
        )}
      >
        {tag}
      </button>
      {/* Drag handle — a subtle grip icon */}
      <span
        {...attributes}
        {...listeners}
        className={cn(
          "flex h-full cursor-grab items-center rounded-r-md pr-1.5 pl-px text-[#3f3f3f] transition-opacity active:cursor-grabbing",
          active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
      >
        <GripHorizontal className="size-3" />
      </span>
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
                    <StatusPill session={session} />
                    {running && session?.healthy !== undefined && (
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-sm px-1.5 py-px font-mono text-[10px]",
                          session!.healthy
                            ? "bg-state-running/10 text-state-running"
                            : "bg-state-error/10 text-state-error",
                        )}
                      >
                        <span
                          className={cn(
                            "size-1.5 rounded-full",
                            session!.healthy ? "bg-state-running" : "bg-state-error",
                          )}
                        />
                        {session!.healthy ? t.status.healthy : t.status.unhealthy}
                      </span>
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
      <BrandMark className="size-9 rounded-md" />
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

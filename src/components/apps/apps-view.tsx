import { useMemo, useState } from "react";
import { Play, Square } from "lucide-react";

import { AppCard } from "@/components/apps/app-card";
import { Button } from "@/components/ui/button";
import { fmt } from "@/i18n/locales";
import { useT } from "@/i18n/use-t";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/use-app-store";

export function AppsView() {
  const t = useT();
  const apps = useAppStore((s) => s.apps);
  const sessions = useAppStore((s) => s.sessions);
  const startApp = useAppStore((s) => s.startApp);
  const stopApp = useAppStore((s) => s.stopApp);

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
              onClick={() => filtered.forEach((a) => void startApp(a.id))}
            >
              <Play className="size-3" /> {t.apps.startAll}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 gap-1 px-2 text-[10px] text-[#a1a1a1]"
              onClick={() => filtered.forEach((a) => void stopApp(a.id))}
            >
              <Square className="size-3" /> {t.apps.stopAll}
            </Button>
          </div>
        </div>
      )}

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-5">
        {apps.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(340px,1fr))]">
            {filtered.map((app) => (
              <AppCard key={app.id} app={app} />
            ))}
          </div>
        )}
      </div>
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

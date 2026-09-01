import { useMemo } from "react";
import { Plus, Search, TerminalSquare } from "lucide-react";

import { AppCard } from "@/components/apps/app-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/store/use-app-store";

export function AppsView() {
  const apps = useAppStore((s) => s.apps);
  const sessions = useAppStore((s) => s.sessions);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const openEditor = useAppStore((s) => s.openEditor);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return apps;
    return apps.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.cwd ?? "").toLowerCase().includes(q) ||
        a.commands.some((c) => c.command.toLowerCase().includes(q)),
    );
  }, [apps, searchQuery]);

  const running = Object.values(sessions).filter((s) => s.state === "running").length;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex items-center gap-4 border-b border-border/60 px-6 py-4">
        <div>
          <h1 className="text-base font-semibold">应用列表</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {apps.length} 个应用 · {running} 个运行中
          </p>
        </div>
        <div className="relative ml-auto w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索名称 / 路径 / 指令…"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <Button size="sm" onClick={() => openEditor(null)}>
          <Plus className="size-4" /> 新建应用
        </Button>
      </header>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {apps.length === 0 ? (
          <EmptyState onCreate={() => openEditor(null)} />
        ) : filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            没有匹配「{searchQuery}」的应用
          </div>
        ) : (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
            {filtered.map((app) => (
              <AppCard key={app.id} app={app} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl border border-border/60 bg-card">
        <TerminalSquare className="size-7 text-[#7c6cf0]" />
      </div>
      <div>
        <h2 className="text-sm font-semibold">还没有任何应用</h2>
        <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-muted-foreground">
          创建一个应用，为它指定 Shell（PowerShell / CMD / Bash）、工作目录和预设指令。
          <br />
          例如：<span className="font-mono">cd qa-egg</span> 然后{" "}
          <span className="font-mono">yarn dev</span>，一键启动。
        </p>
      </div>
      <Button size="sm" onClick={onCreate}>
        <Plus className="size-4" /> 创建第一个应用
      </Button>
    </div>
  );
}

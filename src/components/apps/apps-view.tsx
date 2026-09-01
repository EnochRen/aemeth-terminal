import { useMemo } from "react";
import { Plus, Search } from "lucide-react";

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
      {/* Header — vercel-style toolbar */}
      <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border px-5">
        <h1 className="text-[13.5px] font-semibold tracking-tight">Applications</h1>
        <span className="font-mono text-[11px] text-[#666]">
          {apps.length} app{apps.length === 1 ? "" : "s"} · {running} running
        </span>

        <div className="relative ml-auto w-60">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[#666]" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索…"
            className="h-7 rounded-md bg-transparent pl-8 font-mono text-xs"
          />
        </div>
        <Button size="sm" className="h-7 gap-1.5 px-3 text-xs" onClick={() => openEditor(null)}>
          <Plus className="size-3.5" /> New
        </Button>
      </header>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-5">
        {apps.length === 0 ? (
          <EmptyState onCreate={() => openEditor(null)} />
        ) : filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center font-mono text-xs text-[#666]">
            no match for “{searchQuery}”
          </div>
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

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
      <div className="flex size-9 items-center justify-center rounded-md border border-[#333] font-mono text-sm text-foreground">
        Æ
      </div>
      <div className="space-y-1.5">
        <p className="label-micro">no applications</p>
        <p className="mx-auto max-w-sm text-[12.5px] leading-relaxed text-[#a1a1a1]">
          为每个服务建立一张卡片：指定 Shell、工作目录与预设指令，
          <br />
          例如 <span className="font-mono text-[11.5px] text-foreground">cd qa-egg</span>{" "}
          → <span className="font-mono text-[11.5px] text-foreground">yarn dev</span>，一键启动。
        </p>
      </div>
      <Button size="sm" className="h-7 gap-1.5 px-3 text-xs" onClick={onCreate}>
        <Plus className="size-3.5" /> 创建第一个应用
      </Button>
    </div>
  );
}

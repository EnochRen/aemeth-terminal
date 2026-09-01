import { Plus, SquareTerminal, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusDot } from "@/components/shared/status-pill";
import { ShellBadge } from "@/components/shared/shell-badge";
import { TerminalPane } from "@/components/terminals/terminal-pane";
import { cn } from "@/lib/utils";
import { sessionRegistry } from "@/lib/session-registry";
import { useAppStore } from "@/store/use-app-store";
import type { AppConfig } from "@/types";

export function TerminalsView() {
  const openTabs = useAppStore((s) => s.openTabs);
  const activeAppId = useAppStore((s) => s.activeAppId);
  const apps = useAppStore((s) => s.apps);
  const sessions = useAppStore((s) => s.sessions);

  const appOf = (id: string) => apps.find((a) => a.id === id);
  const launchable = apps.filter((a) => !openTabs.includes(a.id));
  const activeSession = activeAppId ? sessions[activeAppId] : undefined;

  if (openTabs.length === 0) {
    return <EmptyTerminal apps={apps} />;
  }

  return (
    <div className="flex h-full flex-col">
      {/* Win11-style tab strip */}
      <div className="flex items-end gap-0.5 border-b border-border/40 bg-[#0e1219] px-2 pt-1.5">
        <div className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto scrollbar-none">
          {openTabs.map((appId) => {
            const app = appOf(appId);
            if (!app) return null;
            const active = appId === activeAppId;
            const session = sessions[appId];
            return (
              <Tab
                key={appId}
                app={app}
                active={active}
                running={session?.state === "running"}
                onActivate={() => useAppStore.getState().setActiveTab(appId)}
                onClose={(e) => {
                  e.stopPropagation();
                  useAppStore.getState().closeTab(appId);
                }}
              />
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-1 pb-1 pl-1">
          {/* Active session meta */}
          {activeSession && (
            <div className="mr-1 hidden items-center gap-1.5 lg:flex">
              <ShellBadge kind={activeSession.shell} />
              {activeSession.pid && (
                <span className="font-mono text-[10px] text-muted-foreground">
                  PID {activeSession.pid}
                </span>
              )}
            </div>
          )}

          {/* New tab */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-7 text-muted-foreground">
                    <Plus className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                新建终端标签 (启动应用)
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-56">
              {launchable.length === 0 ? (
                <DropdownMenuItem disabled>所有应用都已打开</DropdownMenuItem>
              ) : (
                <>
                  <DropdownMenuLabel className="text-[11px] text-muted-foreground">
                    启动并打开
                  </DropdownMenuLabel>
                  {launchable.map((a) => (
                    <DropdownMenuItem
                      key={a.id}
                      onClick={() => void useAppStore.getState().openTerminal(a.id)}
                    >
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: a.color }}
                      />
                      <span className="truncate">{a.name}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {sessions[a.id]?.state === "running" ? "聚焦" : "启动"}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </>
              )}
              {apps.length === 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      useAppStore.getState().setView("apps");
                      useAppStore.getState().openEditor(null);
                    }}
                  >
                    先去创建一个应用…
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Terminal canvas */}
      <div className="relative min-h-0 flex-1 bg-[#0b0e14]">
        {openTabs.map((appId) => (
          <TerminalPane key={appId} appId={appId} active={appId === activeAppId} />
        ))}
      </div>
    </div>
  );
}

function Tab({
  app,
  active,
  running,
  onActivate,
  onClose,
}: {
  app: AppConfig;
  active: boolean;
  running: boolean;
  onActivate: () => void;
  onClose: (e: React.MouseEvent) => void;
}) {
  const session = useAppStore((s) => s.sessions[app.id]);
  return (
    <div
      role="tab"
      aria-selected={active}
      onClick={onActivate}
      onAuxClick={(e) => {
        // Middle click closes, like Win11 Terminal / browsers.
        if (e.button === 1) {
          e.preventDefault();
          useAppStore.getState().closeTab(app.id);
        }
      }}
      className={cn(
        "group flex h-8.5 max-w-52 min-w-32 shrink-0 cursor-pointer select-none items-center gap-2 rounded-t-lg border-x border-t px-3 text-xs transition-colors",
        active
          ? "border-border/60 bg-[#0b0e14] text-foreground"
          : "border-transparent text-muted-foreground hover:bg-white/[0.04] hover:text-foreground/80",
      )}
    >
      <StatusDot session={session} className="shrink-0" />
      <span className="truncate font-medium">{app.name}</span>
      {running && <span className="sr-only">运行中</span>}
      <button
        type="button"
        onClick={onClose}
        className={cn(
          "ml-auto flex size-4.5 shrink-0 items-center justify-center rounded-md text-muted-foreground",
          "hover:bg-white/10 hover:text-foreground",
          !active && "opacity-0 group-hover:opacity-100",
        )}
        aria-label={`关闭 ${app.name}`}
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

function EmptyTerminal({ apps }: { apps: AppConfig[] }) {
  const startApp = useAppStore((s) => s.startApp);
  const setView = useAppStore((s) => s.setView);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 bg-[#0b0e14]">
      <div className="flex size-14 items-center justify-center rounded-2xl border border-border/60 bg-card/50">
        <SquareTerminal className="size-6 text-[#7c6cf0]" />
      </div>
      <div className="text-center">
        <h2 className="text-sm font-semibold text-foreground">没有打开的终端</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          从下方快速启动一个服务，或前往应用列表
        </p>
      </div>

      {apps.length > 0 && (
        <div className="flex max-w-md flex-wrap items-center justify-center gap-2">
          {apps.slice(0, 8).map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => void startApp(a.id)}
              className="flex items-center gap-2 rounded-lg border border-border/70 bg-card px-3 py-2 text-xs transition-colors hover:border-[#7c6cf0]/50 hover:bg-accent"
            >
              <span className="size-2 rounded-full" style={{ backgroundColor: a.color }} />
              {a.name}
            </button>
          ))}
        </div>
      )}

      <Button variant="secondary" size="sm" onClick={() => setView("apps")}>
        前往应用列表
      </Button>
      <span className="text-[10px] text-muted-foreground/70">
        提示：{sessionRegistry.runningCount} 个会话正在后台运行
      </span>
    </div>
  );
}

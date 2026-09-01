import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import React from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusDot } from "@/components/shared/status-pill";
import { TerminalPane } from "@/components/terminals/terminal-pane";
import { fmt } from "@/i18n/locales";
import { useT } from "@/i18n/use-t";
import { cn } from "@/lib/utils";
import { sessionRegistry } from "@/lib/session-registry";
import { useAppStore } from "@/store/use-app-store";
import type { AppConfig } from "@/types";
import { openUrl } from "@/lib/pty";

export function TerminalsView() {
  const t = useT();
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
      {/* Tab strip — underline tabs, geist style */}
      <div className="flex h-10 shrink-0 items-stretch border-b border-border bg-background px-3">
        <div className="flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto scrollbar-none">
          {openTabs.map((appId) => {
            const app = appOf(appId);
            if (!app) return null;
            return (
              <Tab
                key={appId}
                app={app}
                active={appId === activeAppId}
                onActivate={() => useAppStore.getState().setActiveTab(appId)}
                onClose={() => useAppStore.getState().closeTab(appId)}
              />
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-3 pl-3">
          {activeSession && (
            <span className="hidden font-mono text-[10.5px] text-[#525252] md:inline">
              {activeSession.shell}
              {activeSession.pid ? ` · pid ${activeSession.pid}` : ""}
              {(activeSession.ports?.length ?? 0) > 0
                ? activeSession.ports!.map((p, i) => (
                    <React.Fragment key={p}>
                      {i > 0 && " · "}
                      <button
                        type="button"
                        onClick={() => void openUrl(`http://localhost:${p}`)}
                        className="inline-flex items-center gap-0.5 rounded px-0.5 hover:bg-accent transition-colors"
                        title={`Open http://localhost:${p}`}
                      >
                        :{p}
                      </button>
                    </React.Fragment>
                  ))
                : null}
            </span>
          )}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-[#a1a1a1] hover:text-foreground"
                  >
                    <Plus className="size-4" strokeWidth={1.75} />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="font-mono text-xs">
                {t.terminals.newTab}
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-56">
              {launchable.length === 0 ? (
                <DropdownMenuItem disabled>{t.terminals.allOpen}</DropdownMenuItem>
              ) : (
                <>
                  <DropdownMenuLabel className="label-micro font-mono">{t.terminals.launch}</DropdownMenuLabel>
                  {launchable.map((a) => (
                    <DropdownMenuItem
                      key={a.id}
                      onClick={() => void useAppStore.getState().openTerminal(a.id)}
                    >
                      <span
                        className="size-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: a.color }}
                      />
                      <span className="truncate text-xs">{a.name}</span>
                      <span className="ml-auto font-mono text-[10px] text-[#666]">
                        {sessions[a.id]?.state === "running" ? t.terminals.focus : t.terminals.start}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Terminal canvas */}
      <div className="relative min-h-0 flex-1 bg-black">
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
  onActivate,
  onClose,
}: {
  app: AppConfig;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
}) {
  const session = useAppStore((s) => s.sessions[app.id]);
  return (
    <div
      role="tab"
      aria-selected={active}
      onClick={onActivate}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          useAppStore.getState().closeTab(app.id);
        }
      }}
      className={cn(
        "group relative flex shrink-0 cursor-pointer select-none items-center gap-2 px-3 text-xs transition-colors duration-100",
        active ? "text-foreground" : "text-[#a1a1a1] hover:text-foreground",
      )}
    >
      {/* underline indicator */}
      <span
        className={cn(
          "absolute inset-x-2 bottom-0 h-px transition-colors",
          active ? "bg-foreground" : "bg-transparent group-hover:bg-[#333]",
        )}
      />
      <StatusDot session={session} />
      <span className="max-w-40 truncate font-medium">{app.name}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className={cn(
          "flex size-4 items-center justify-center rounded-sm text-[#666] hover:bg-[#262626] hover:text-foreground",
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
  const t = useT();
  const startApp = useAppStore((s) => s.startApp);
  const setView = useAppStore((s) => s.setView);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 bg-black">
      <pre className="select-none font-mono text-[11px] leading-relaxed text-[#333]">
{`aemeth terminal
─────────────────`}
      </pre>
      <div className="text-center">
        <p className="label-micro">{t.terminals.emptyLabel}</p>
        <p className="mt-1.5 text-[12.5px] text-[#a1a1a1]">{t.terminals.emptyHint}</p>
      </div>

      {apps.length > 0 && (
        <div className="flex max-w-md flex-wrap items-center justify-center gap-1.5">
          {apps.slice(0, 8).map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => void startApp(a.id)}
              className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 font-mono text-[11px] text-[#a1a1a1] transition-colors duration-100 hover:border-[#3f3f3f] hover:text-foreground"
            >
              <span className="size-1.5 rounded-full" style={{ backgroundColor: a.color }} />
              {a.name}
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => setView("apps")}
        className="font-mono text-[11px] text-[#525252] underline decoration-[#333] underline-offset-4 transition-colors hover:text-foreground"
      >
        {t.terminals.goApps}
      </button>
      {sessionRegistry.runningCount > 0 && (
        <span className="font-mono text-[10.5px] text-[#333]">
          {fmt(t.terminals.bgSessions, { n: sessionRegistry.runningCount })}
        </span>
      )}
    </div>
  );
}

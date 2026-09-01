import { useEffect, useRef } from "react";
import { RotateCcw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { sessionRegistry } from "@/lib/session-registry";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/use-app-store";

interface TerminalPaneProps {
  appId: string;
  active: boolean;
}

/**
 * Mounts one xterm.js instance. All panes stay in the DOM (stacked); the
 * inactive ones are only `invisible`, so their layout — and therefore xterm's
 * fit calculations — keep working.
 */
export function TerminalPane({ appId, active }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const client = sessionRegistry.getByApp(appId);
  const session = useAppStore((s) => s.sessions[appId]);
  const restartApp = useAppStore((s) => s.restartApp);
  const closeTab = useAppStore((s) => s.closeTab);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !client) return;
    client.attach(el);
    const observer = new ResizeObserver(() => client.fitNow());
    observer.observe(el);
    return () => observer.disconnect();
  }, [client]);

  useEffect(() => {
    if (active && client) {
      client.fitNow();
      client.focus();
    }
  }, [active, client]);

  // Right click: copy if there is a selection, otherwise paste — classic
  // Windows console behaviour.
  const onContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!client) return;
    const selection = client.term.getSelection();
    try {
      if (selection) {
        await navigator.clipboard.writeText(selection);
      } else {
        const text = await navigator.clipboard.readText();
        if (text) client.term.paste(text);
      }
    } catch {
      /* clipboard unavailable */
    }
  };

  if (!client) return null;

  return (
    <div className={cn("absolute inset-0", active ? "visible z-10" : "invisible z-0")}>
      <div
        ref={containerRef}
        onContextMenu={(e) => void onContextMenu(e)}
        className="h-full w-full cursor-text px-2 pb-2 pt-1.5"
      />

      {/* Exited overlay */}
      {session?.state === "exited" && active && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-border/80 bg-popover/95 px-3 py-1.5 text-xs shadow-lg backdrop-blur">
            <span
              className={cn(
                "size-1.5 rounded-full",
                session.exitCode ? "bg-[#f26d6d]" : "bg-muted-foreground/60",
              )}
            />
            <span className="text-muted-foreground">
              进程已退出{session.exitCode !== undefined ? ` · 代码 ${session.exitCode}` : ""}
            </span>
            <Button
              size="sm"
              variant="secondary"
              className="h-6 px-2 text-[11px]"
              onClick={() => void restartApp(appId)}
            >
              <RotateCcw className="size-3" /> 重启
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[11px] text-muted-foreground"
              onClick={() => closeTab(appId)}
            >
              <X className="size-3" /> 关闭
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

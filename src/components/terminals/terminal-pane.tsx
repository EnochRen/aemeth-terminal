import { useEffect, useRef } from "react";

import { fmt } from "@/i18n/locales";
import { useT } from "@/i18n/use-t";
import { readText as clipReadText, writeText as clipWriteText } from "@tauri-apps/plugin-clipboard-manager";

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
  const t = useT();
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
        await clipWriteText(selection);
      } else {
        const text = await clipReadText();
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
          <div className="pointer-events-auto flex items-center gap-3 rounded-md border border-border bg-[#0a0a0a] px-3 py-1.5">
            <span className="font-mono text-[11px] text-[#a1a1a1]">
              {t.pane.exited}
              {session.exitCode !== undefined ? ` · ${fmt(t.pane.code, { code: session.exitCode })}` : ""}
            </span>
            <span className="h-3 w-px bg-border" />
            <button
              type="button"
              onClick={() => void restartApp(appId)}
              className="font-mono text-[11px] text-foreground underline decoration-[#333] underline-offset-4 hover:decoration-foreground"
            >
              {t.pane.restart}
            </button>
            <button
              type="button"
              onClick={() => closeTab(appId)}
              className="font-mono text-[11px] text-[#666] underline decoration-[#333] underline-offset-4 hover:text-foreground"
            >
              {t.pane.close}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

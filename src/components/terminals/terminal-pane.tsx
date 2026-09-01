import { useEffect, useRef, useState } from "react";
import {
  ClipboardList,
  ClipboardPaste,
  Copy,
  Eraser,
  FileDown,
  Search,
  SquareCheckBig,
} from "lucide-react";
import { toast } from "sonner";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { TerminalSearch } from "@/components/terminals/terminal-search";
import { fmt } from "@/i18n/locales";
import { useT } from "@/i18n/use-t";
import { saveTextFile } from "@/lib/save-file";
import { sessionRegistry } from "@/lib/session-registry";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/use-app-store";

interface TerminalPaneProps {
  appId: string;
  active: boolean;
}

export function TerminalPane({ appId, active }: TerminalPaneProps) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const client = sessionRegistry.getByApp(appId);
  const session = useAppStore((s) => s.sessions[appId]);
  const app = useAppStore((s) => s.apps.find((a) => a.id === appId));
  const restartApp = useAppStore((s) => s.restartApp);
  const closeTab = useAppStore((s) => s.closeTab);

  const [searchOpen, setSearchOpen] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);

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

  useEffect(() => {
    if (!client) return;
    const offSearch = client.onSearchRequest(() => setSearchOpen(true));
    const disp = client.term.onSelectionChange(() =>
      setHasSelection(client.term.hasSelection()),
    );
    return () => {
      offSearch();
      disp.dispose();
    };
  }, [client]);

  const closeSearch = () => {
    setSearchOpen(false);
    client?.focus();
  };

  const handleSaveLog = async () => {
    if (!client) return;
    try {
      const path = await saveTextFile(client.getBufferText(), `${client.app.name}-log.txt`);
      if (path) toast.success(t.toasts.logSaved);
    } catch {
      toast.error(t.toasts.logFailed);
    }
  };

  if (!client) return null;

  return (
    <div className={cn("absolute inset-0", active ? "visible z-10" : "invisible z-0")}>
      <ContextMenu
        onOpenChange={(open) => {
          if (!open) client.focus();
          setHasSelection(client.term.hasSelection());
        }}
      >
        <ContextMenuTrigger asChild>
          <div
            ref={containerRef}
            className="h-full w-full cursor-text px-2 pb-2 pt-1.5"
          />
        </ContextMenuTrigger>
        <ContextMenuContent className="w-72">
          <ContextMenuItem disabled={!hasSelection} onClick={() => client.copySelection()}>
            <Copy /> {t.menu.copy}
            <ContextMenuShortcut className="font-mono">Ctrl+C, Ctrl+Shift+C</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onClick={() => void client.pasteClipboard()}>
            <ClipboardPaste /> {t.menu.paste}
            <ContextMenuShortcut className="font-mono">Ctrl+V, Ctrl+Shift+V</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem disabled={!hasSelection} onClick={() => client.pasteSelection()}>
            <ClipboardList /> {t.menu.pasteSelection}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => client.selectAll()}>
            <SquareCheckBig /> {t.menu.selectAll}
            <ContextMenuShortcut className="font-mono">Ctrl+Shift+A</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => client.clearScreen()}>
            <Eraser /> {t.menu.clear}
            <ContextMenuShortcut className="font-mono">Ctrl+L, Ctrl+Shift+L</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onClick={() => setSearchOpen(true)}>
            <Search /> {t.menu.search}
            <ContextMenuShortcut className="font-mono">Ctrl+F</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onClick={() => void handleSaveLog()}>
            <FileDown /> {t.menu.saveLog}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {searchOpen && <TerminalSearch client={client} onClose={closeSearch} />}

      {/* Exited overlay */}
      {session?.state === "exited" && active && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-3 rounded-md border border-border bg-[#0a0a0a] px-3 py-1.5">
            <span className="font-mono text-[11px] text-[#a1a1a1]">
              {app?.kind === "script" ? t.pane.done : t.pane.exited}
              {session.exitCode !== undefined
                ? ` · ${fmt(t.pane.code, { code: session.exitCode })}`
                : ""}
              {session.durationMs !== undefined
                ? ` · ${fmt(t.pane.duration, { t: (session.durationMs / 1000).toFixed(1) })}`
                : ""}
            </span>
            <span className="h-3 w-px bg-border" />
            <button
              type="button"
              onClick={() => void restartApp(appId)}
              className="font-mono text-[11px] text-foreground underline decoration-[#333] underline-offset-4 hover:decoration-foreground"
            >
              {app?.kind === "script" ? t.pane.rerun : t.pane.restart}
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

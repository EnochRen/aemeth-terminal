import {
  MoreHorizontal,
  Pencil,
  Play,
  RotateCcw,
  Square,
  SquareTerminal,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ShellBadge } from "@/components/shared/shell-badge";
import { StatusPill } from "@/components/shared/status-pill";
import { fmt } from "@/i18n/locales";
import { useT } from "@/i18n/use-t";
import { useAppStore } from "@/store/use-app-store";
import type { AppConfig } from "@/types";
import { cn } from "@/lib/utils";

/**
 * Deployment-row style card: hairline border, mono data, color only in the
 * identity dot and the status dot. Actions surface on hover.
 */
export function AppCard({ app }: { app: AppConfig }) {
  const t = useT();
  const session = useAppStore((s) => s.sessions[app.id]);
  const startApp = useAppStore((s) => s.startApp);
  const stopApp = useAppStore((s) => s.stopApp);
  const restartApp = useAppStore((s) => s.restartApp);
  const openTerminal = useAppStore((s) => s.openTerminal);
  const openEditor = useAppStore((s) => s.openEditor);
  const requestDelete = useAppStore((s) => s.requestDelete);

  const running = session?.state === "running";
  const exited = session?.state === "exited";

  return (
    <div
      className={cn(
        "group flex flex-col rounded-lg border bg-card transition-colors duration-100",
        running
          ? "border-state-running/60 hover:border-state-running"
          : "border-border hover:border-[#3f3f3f]",
      )}
    >
      {/* Row 1 — identity */}
      <div className="flex items-center gap-2.5 px-4 pt-3.5">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: app.color }}
          aria-hidden
        />
        <h3 className="min-w-0 flex-1 truncate text-[13.5px] font-semibold tracking-tight">
          {app.name}
        </h3>
        <ShellBadge kind={app.shell} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-[#666] opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            {running && (
              <>
                <DropdownMenuItem onClick={() => void stopApp(app.id)}>
                  <Square className="size-3.5" /> {t.card.stop}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void restartApp(app.id)}>
                  <RotateCcw className="size-3.5" /> {t.card.restart}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={() => openEditor(app)}>
              <Pencil className="size-3.5" /> {t.card.edit}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => requestDelete(app)}>
              <Trash2 className="size-3.5" /> {t.card.delete}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Row 2 — status line */}
      <div className="flex items-center justify-between px-4 pb-3 pt-1.5">
        <StatusPill session={session} />
        {running && (session?.pid !== undefined || (session.ports?.length ?? 0) > 0) && (
          <span className="flex items-center gap-2 font-mono text-[10.5px] text-[#666]">
            {(session.ports?.length ?? 0) > 0 && (
              <span className="text-state-running" title={session.ports!.map((p) => `:${p}`).join(", ")}>
                {session.ports!.map((p) => `:${p}`).join(" ")}
              </span>
            )}
            {session.pid !== undefined && <span>{fmt(t.card.pid, { pid: session.pid })}</span>}
          </span>
        )}
      </div>

      {/* Row 3 — data */}
      <div className="border-t border-border px-4 py-2.5">
        <div className="truncate font-mono text-[11.5px] leading-relaxed text-[#a1a1a1]">
          <span className="text-[#525252]">cd </span>
          {app.cwd ?? "~"}
        </div>
        {app.commands.length > 0 ? (
          app.commands.slice(0, 2).map((c, i) => (
            <div
              key={i}
              className="truncate font-mono text-[11.5px] leading-relaxed text-[#a1a1a1]"
            >
              <span className="text-[#525252]">$ </span>
              {c.command}
            </div>
          ))
        ) : (
          <div className="font-mono text-[11.5px] text-[#525252]">{t.card.interactive}</div>
        )}
        {app.commands.length > 2 && (
          <div className="pt-0.5 font-mono text-[10.5px] text-[#525252]">
            {fmt(t.card.more, { n: app.commands.length - 2 })}
          </div>
        )}
      </div>

      {/* Row 4 — actions */}
      <div className="flex items-center gap-2 border-t border-border px-4 py-2.5">
        {running ? (
          <>
            <Button size="sm" className="h-7 gap-1.5 px-2.5 text-xs" onClick={() => void openTerminal(app.id)}>
              <SquareTerminal className="size-3.5" /> {t.card.openTerminal}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2.5 text-xs text-[#a1a1a1]"
              onClick={() => void stopApp(app.id)}
            >
              {t.card.stop}
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" className="h-7 gap-1.5 px-2.5 text-xs" onClick={() => void startApp(app.id)}>
              <Play className="size-3" /> {exited ? t.card.restart : t.card.start}
            </Button>
            {exited && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 px-2.5 text-xs text-[#a1a1a1]"
                onClick={() => void openTerminal(app.id)}
              >
                {t.card.viewOutput}
              </Button>
            )}
          </>
        )}
        {app.autoStart && (
          <span className="ml-auto font-mono text-[10.5px] text-[#525252]">{t.card.auto}</span>
        )}
      </div>
    </div>
  );
}

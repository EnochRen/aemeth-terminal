import {
  MoreHorizontal,
  Pencil,
  Play,
  RotateCcw,
  Copy,
  Square,
  SquareTerminal,
  Trash2,
  ExternalLink,
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
import { openUrl } from "@/lib/pty";
import { useAppStore } from "@/store/use-app-store";
import type { AppConfig } from "@/types";
import { cn } from "@/lib/utils";

export function AppCard({ app }: { app: AppConfig }) {
  const t = useT();
  const session = useAppStore((s) => s.sessions[app.id]);
  const startApp = useAppStore((s) => s.startApp);
  const stopApp = useAppStore((s) => s.stopApp);
  const restartApp = useAppStore((s) => s.restartApp);
  const openTerminal = useAppStore((s) => s.openTerminal);
  const openEditor = useAppStore((s) => s.openEditor);
  const cloneApp = useAppStore((s) => s.cloneApp);
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
                <DropdownMenuItem onClick={() => cloneApp(app)}>
              <Copy className="size-3.5" /> {t.card.clone}
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
        <div className="flex items-center gap-1.5">
          <StatusPill session={session} />
          {running && session?.healthy !== undefined && (
            <span
              className={cn(
                "size-1.5 rounded-full",
                session!.healthy ? "bg-state-running" : "bg-state-error",
              )}
              title={session!.healthy ? t.status.healthy : t.status.unhealthy}
            />
          )}
        </div>
        {running && (session?.pid !== undefined || (session.ports?.length ?? 0) > 0) && (
          <span className="flex items-center gap-2 font-mono text-[10.5px] text-[#666]">
            {(session.ports?.length ?? 0) > 0 && (
              <span className="text-state-running" title={session.ports!.map((p) => `:${p}`).join(", ")}>
                {session.ports!.map((p, i) => (
                  <span key={p}>
                    {i > 0 && " "}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void openUrl(`http://localhost:${p}`);
                      }}
                      className="inline-flex items-center gap-0.5 rounded px-0.5 hover:bg-accent hover:text-state-running transition-colors"
                      title={`Open http://localhost:${p}`}
                    >
                      :{p} <ExternalLink className="size-2.5" />
                    </button>
                  </span>
                ))}
              </span>
            )}
            {session.pid !== undefined && <span>{fmt(t.card.pid, { pid: session.pid })}</span>}
          </span>
        )}
        {exited && app.kind === "script" && session && (
          <span className="font-mono text-[10.5px] text-[#666]">
            code {session.exitCode ?? 0}
            {session.durationMs !== undefined && (
              <> · {fmt(t.card.duration, { t: (session.durationMs / 1000).toFixed(1) })}</>
            )}
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
          <div className="font-mono text-[11.5px] text-[#525252]">{app.kind === "script" ? t.card.script : t.card.interactive}</div>
        )}
        {app.commands.length > 2 && (
          <div className="pt-0.5 font-mono text-[10.5px] text-[#525252]">
            {fmt(t.card.more, { n: app.commands.length - 2 })}
          </div>
        )}
      </div>

      {/* Row 4 — actions */}
      <div className="flex items-center gap-2 border-t border-border px-4 py-2.5">
        {app.kind === "script" ? (
          running ? (
            <>
              <Button
                size="sm"
                className="h-7 gap-1.5 px-2.5 text-xs"
                onClick={() => void openTerminal(app.id)}
              >
                <SquareTerminal className="size-3.5" /> {t.card.viewOutput}
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
                <Play className="size-3" /> {exited ? t.card.rerun : t.card.run}
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
          )
        ) : running ? (
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

import { ExternalLink } from "lucide-react";

import { AppActionButtons } from "@/components/apps/app-action-buttons";
import { AppActionsMenu } from "@/components/apps/app-actions-menu";
import { ShellBadge } from "@/components/shared/shell-badge";
import { StatusPill } from "@/components/shared/status-pill";
import { fmt } from "@/i18n/locales";
import { useT } from "@/i18n/use-t";
import { openUrl } from "@/lib/pty";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/use-app-store";
import type { AppConfig } from "@/types";

export function AppCard({ app }: { app: AppConfig }) {
  const t = useT();
  const session = useAppStore((s) => s.sessions[app.id]);

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
        <AppActionsMenu app={app} />
      </div>

      {/* Row 2 — status line */}
      <div className="flex items-center justify-between px-4 pb-3 pt-1.5">
        <div className="flex items-center gap-1.5">
          <StatusPill session={session} />
          {running && session?.healthy !== undefined && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-sm px-1.5 py-px font-mono text-[10px]",
                session!.healthy
                  ? "bg-state-running/10 text-state-running"
                  : "bg-state-error/10 text-state-error",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  session!.healthy ? "bg-state-running" : "bg-state-error",
                )}
              />
              {session!.healthy ? t.status.healthy : t.status.unhealthy}
            </span>
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
        <AppActionButtons app={app} />
        {app.autoStart && (
          <span className="ml-auto font-mono text-[10.5px] text-[#525252]">{t.card.auto}</span>
        )}
      </div>
    </div>
  );
}
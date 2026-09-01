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
import { useAppStore } from "@/store/use-app-store";
import type { AppConfig } from "@/types";

/**
 * Deployment-row style card: hairline border, mono data, color only in the
 * identity dot and the status dot. Actions surface on hover.
 */
export function AppCard({ app }: { app: AppConfig }) {
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
    <div className="group flex flex-col rounded-lg border border-border bg-card transition-colors duration-100 hover:border-[#3f3f3f]">
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
                  <Square className="size-3.5" /> 停止
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void restartApp(app.id)}>
                  <RotateCcw className="size-3.5" /> 重启
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={() => openEditor(app)}>
              <Pencil className="size-3.5" /> 编辑
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => requestDelete(app)}>
              <Trash2 className="size-3.5" /> 删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Row 2 — status line */}
      <div className="flex items-center justify-between px-4 pb-3 pt-1.5">
        <StatusPill session={session} />
        {session?.pid !== undefined && session.state === "running" && (
          <span className="font-mono text-[10.5px] text-[#666]">pid {session.pid}</span>
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
          <div className="font-mono text-[11.5px] text-[#525252]">interactive shell</div>
        )}
        {app.commands.length > 2 && (
          <div className="pt-0.5 font-mono text-[10.5px] text-[#525252]">
            +{app.commands.length - 2} more
          </div>
        )}
      </div>

      {/* Row 4 — actions */}
      <div className="flex items-center gap-2 border-t border-border px-4 py-2.5">
        {running ? (
          <>
            <Button size="sm" className="h-7 gap-1.5 px-2.5 text-xs" onClick={() => void openTerminal(app.id)}>
              <SquareTerminal className="size-3.5" /> 打开终端
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2.5 text-xs text-[#a1a1a1]"
              onClick={() => void stopApp(app.id)}
            >
              停止
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" className="h-7 gap-1.5 px-2.5 text-xs" onClick={() => void startApp(app.id)}>
              <Play className="size-3" /> {exited ? "重新启动" : "启动"}
            </Button>
            {exited && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 px-2.5 text-xs text-[#a1a1a1]"
                onClick={() => void openTerminal(app.id)}
              >
                查看输出
              </Button>
            )}
          </>
        )}
        {app.autoStart && (
          <span className="ml-auto font-mono text-[10.5px] text-[#525252]">auto</span>
        )}
      </div>
    </div>
  );
}

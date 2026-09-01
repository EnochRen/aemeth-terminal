import {
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Play,
  RotateCcw,
  Square,
  SquareTerminal,
  Terminal,
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
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/use-app-store";
import type { AppConfig } from "@/types";

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
    <div
      className={cn(
        "group relative flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-4 transition-all",
        "hover:border-border hover:shadow-[0_4px_24px_rgba(0,0,0,0.35)]",
        running && "border-[#3dd68c]/20",
      )}
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <div
          className="flex size-10 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${app.color}1f`, color: app.color }}
        >
          <Terminal className="size-5" strokeWidth={2.2} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{app.name}</h3>
            <ShellBadge kind={app.shell} />
          </div>
          <StatusPill session={session} className="mt-1" />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8 text-muted-foreground">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            {running && (
              <>
                <DropdownMenuItem onClick={() => void stopApp(app.id)}>
                  <Square className="size-4" /> 停止
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void restartApp(app.id)}>
                  <RotateCcw className="size-4" /> 重启
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={() => openEditor(app)}>
              <Pencil className="size-4" /> 编辑
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={() => requestDelete(app)}
            >
              <Trash2 className="size-4" /> 删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Working dir + commands */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <FolderOpen className="size-3.5 shrink-0" />
          <span className="truncate font-mono" title={app.cwd ?? undefined}>
            {app.cwd || "默认目录"}
          </span>
        </div>
        {app.commands.length > 0 ? (
          <div className="rounded-lg border border-border/60 bg-background/60 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-foreground/80">
            {app.commands.slice(0, 2).map((c, i) => (
              <div key={i} className="truncate">
                <span className="select-none text-[#7c6cf0]">$ </span>
                {c.command}
              </div>
            ))}
            {app.commands.length > 2 && (
              <div className="text-muted-foreground">… 共 {app.commands.length} 条指令</div>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border/60 px-2.5 py-2 text-center text-[11px] text-muted-foreground">
            未配置预设指令 · 打开交互式 Shell
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="mt-auto flex items-center gap-2 pt-1">
        {running ? (
          <>
            <Button size="sm" className="flex-1" onClick={() => void openTerminal(app.id)}>
              <SquareTerminal className="size-4" /> 打开终端
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void stopApp(app.id)}>
              <Square className="size-3.5" /> 停止
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" className="flex-1" onClick={() => void startApp(app.id)}>
              <Play className="size-4" /> {exited ? "重新启动" : "启动"}
            </Button>
            {exited && (
              <Button size="sm" variant="secondary" onClick={() => void openTerminal(app.id)}>
                <SquareTerminal className="size-4" /> 终端
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

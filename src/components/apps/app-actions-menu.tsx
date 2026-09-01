import { Copy, MoreHorizontal, Pencil, RotateCcw, Square, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/i18n/use-t";
import { useAppStore } from "@/store/use-app-store";
import type { AppConfig } from "@/types";
import { cn } from "@/lib/utils";

/**
 * Shared "more" dropdown used by both card and table row layouts.
 */
export function AppActionsMenu({
  app,
  className,
}: {
  app: AppConfig;
  className?: string;
}) {
  const t = useT();
  const session = useAppStore((s) => s.sessions[app.id]);
  const stopApp = useAppStore((s) => s.stopApp);
  const restartApp = useAppStore((s) => s.restartApp);
  const openEditor = useAppStore((s) => s.openEditor);
  const cloneApp = useAppStore((s) => s.cloneApp);
  const requestDelete = useAppStore((s) => s.requestDelete);

  const running = session?.state === "running";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-6 text-[#666] opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100", className)}
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
        <DropdownMenuItem onClick={() => cloneApp(app)}>
          <Copy className="size-3.5" /> {t.card.clone}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => requestDelete(app)}>
          <Trash2 className="size-3.5" /> {t.card.delete}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
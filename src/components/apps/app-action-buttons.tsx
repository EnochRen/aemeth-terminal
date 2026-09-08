import { Loader2, Play, SquareTerminal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/use-t";
import { useAppStore } from "@/store/use-app-store";
import type { AppConfig } from "@/types";

const PRIMARY_W = "w-[96px]";
const SECONDARY_W = "w-[108px]";

/** Start / stop / view-output buttons shared by card and table rows. */
export function AppActionButtons({
  app,
  size = "default",
}: {
  app: AppConfig;
  size?: "default" | "sm";
}) {
  const t = useT();
  const session = useAppStore((s) => s.sessions[app.id]);
  const startApp = useAppStore((s) => s.startApp);
  const stopApp = useAppStore((s) => s.stopApp);
  const openTerminal = useAppStore((s) => s.openTerminal);

  const running = session?.state === "running";
  const exited = session?.state === "exited";
  const transitioning = session?.state === "starting" || session?.state === "stopping";
  const starting = session?.state === "starting";
  const isScript = app.kind === "script";

  const h = size === "sm" ? "h-6" : "h-7";
  const text = size === "sm" ? "text-[10px]" : "text-xs";
  const primaryClass = `${h} gap-1.5 px-2 ${text} ${PRIMARY_W} justify-center`;
  const stopClass = `${primaryClass} border-transparent bg-state-error text-white hover:bg-state-error/90`;
  const viewOutputClass = `${h} gap-1.5 px-2 ${text} ${SECONDARY_W} justify-center text-[#a1a1a1]`;

  if (transitioning) {
    return (
      <Button size="sm" disabled className={primaryClass}>
        <Loader2 className="size-3 animate-spin" />
        {starting ? t.card.starting : t.card.stopping}
      </Button>
    );
  }

  const viewOutputBtn = (
    <Button
      size="sm"
      variant="ghost"
      className={viewOutputClass}
      onClick={() => void openTerminal(app.id)}
    >
      <SquareTerminal className="size-3.5" /> {t.card.viewOutput}
    </Button>
  );

  if (running) {
    return (
      <div className="flex items-center justify-end gap-1">
        {viewOutputBtn}
        <Button size="sm" className={stopClass} onClick={() => void stopApp(app.id)}>
          {t.card.stop}
        </Button>
      </div>
    );
  }

  if (exited) {
    return (
      <div className="flex items-center justify-end gap-1">
        {viewOutputBtn}
        <Button
          size="sm"
          className={primaryClass}
          onClick={() => void startApp(app.id)}
        >
          <Play className="size-3" />
          {isScript ? t.card.rerun : t.card.restart}
        </Button>
      </div>
    );
  }

  return (
    <Button
      size="sm"
      className={primaryClass}
      onClick={() => void startApp(app.id)}
    >
      <Play className="size-3" />
      {isScript ? t.card.run : t.card.start}
    </Button>
  );
}

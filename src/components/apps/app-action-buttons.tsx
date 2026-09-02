import { Loader2, Play, SquareTerminal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/use-t";
import { useAppStore } from "@/store/use-app-store";
import type { AppConfig } from "@/types";

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

  // A transition is in flight — both app kinds render the same disabled spinner.
  if (transitioning) {
    return (
      <Button size="sm" disabled className={`${h} gap-1.5 px-2.5 ${text}`}>
        <Loader2 className="size-3 animate-spin" />
        {starting ? t.card.starting : t.card.stopping}
      </Button>
    );
  }

  if (isScript) {
    if (running) {
      return (
        <>
          <Button
            size="sm"
            className={`${h} gap-1.5 px-2.5 ${text}`}
            onClick={() => void openTerminal(app.id)}
          >
            <SquareTerminal className="size-3.5" /> {t.card.viewOutput}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className={`${h} px-2.5 ${text} text-[#a1a1a1]`}
            onClick={() => void stopApp(app.id)}
          >
            {t.card.stop}
          </Button>
        </>
      );
    }
    return (
      <>
        <Button
          size="sm"
          className={`${h} gap-1.5 px-2.5 ${text}`}
          onClick={() => void startApp(app.id)}
        >
          <Play className="size-3" /> {exited ? t.card.rerun : t.card.run}
        </Button>
        {exited && (
          <Button
            size="sm"
            variant="ghost"
            className={`${h} gap-1.5 px-2.5 ${text} text-[#a1a1a1]`}
            onClick={() => void openTerminal(app.id)}
          >
            {t.card.viewOutput}
          </Button>
        )}
      </>
    );
  }

  // service-type app
  if (running) {
    return (
      <>
        <Button
          size="sm"
          className={`${h} gap-1.5 px-2.5 ${text}`}
          onClick={() => void openTerminal(app.id)}
        >
          <SquareTerminal className="size-3.5" /> {t.card.openTerminal}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className={`${h} px-2.5 ${text} text-[#a1a1a1]`}
          onClick={() => void stopApp(app.id)}
        >
          {t.card.stop}
        </Button>
      </>
    );
  }
  return (
    <>
      <Button
        size="sm"
        className={`${h} gap-1.5 px-2.5 ${text}`}
        onClick={() => void startApp(app.id)}
      >
        <Play className="size-3" /> {exited ? t.card.restart : t.card.start}
      </Button>
      {exited && (
        <Button
          size="sm"
          variant="ghost"
          className={`${h} gap-1.5 px-2.5 ${text} text-[#a1a1a1]`}
          onClick={() => void openTerminal(app.id)}
        >
          {t.card.viewOutput}
        </Button>
      )}
    </>
  );
}
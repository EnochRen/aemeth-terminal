import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/i18n/use-t";
import { cn } from "@/lib/utils";

/**
 * Custom title bar replacing the native frame: drag region on the left,
 * Windows-style window controls on the right.
 */
export function TitleBar() {
  const t = useT();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | null = null;
    win
      .isMaximized()
      .then(setMaximized)
      .catch(() => {});
    win
      .onResized(() => {
        win
          .isMaximized()
          .then(setMaximized)
          .catch(() => {});
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, []);

  const win = getCurrentWindow();

  return (
    <header className="flex h-10 shrink-0 select-none items-stretch border-b border-border bg-black">
      {/* Drag region + brand */}
      <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center gap-2.5 pl-3">
        <span className="flex size-5 items-center justify-center rounded-[5px] border border-[#333] font-mono text-[10px] font-medium text-foreground">
          Æ
        </span>
        <span className="truncate font-mono text-[11px] tracking-wide text-[#a1a1a1]">
          Aemeth Terminal
        </span>
      </div>

      {/* Window controls */}
      <div className="flex items-stretch">
        <ControlButton label={t.window.minimize} onClick={() => void win.minimize()}>
          <Minus className="size-3.5" strokeWidth={1.5} />
        </ControlButton>
        <ControlButton
          label={maximized ? t.window.restore : t.window.maximize}
          onClick={() => void win.toggleMaximize()}
        >
          {maximized ? (
            <Copy className="size-3" strokeWidth={1.5} />
          ) : (
            <Square className="size-3" strokeWidth={1.5} />
          )}
        </ControlButton>
        <ControlButton
          label={t.window.close}
          danger
          onClick={() => void win.close()}
        >
          <X className="size-3.5" strokeWidth={1.5} />
        </ControlButton>
      </div>
    </header>
  );
}

function ControlButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className={cn(
            "flex w-11 items-center justify-center text-[#a1a1a1] transition-colors duration-100",
            danger ? "hover:bg-state-error hover:text-white" : "hover:bg-accent hover:text-foreground",
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="font-mono text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

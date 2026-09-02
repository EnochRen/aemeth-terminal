import { useEffect, useRef, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { BrandMark } from "@/components/shared/brand-mark";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/i18n/use-t";
import { cn } from "@/lib/utils";

export function TitleBar() {
  const t = useT();
  const [maximized, setMaximized] = useState(false);
  const dragRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const win = getCurrentWindow();

    // Track maximized state
    let unlistenResize: (() => void) | null = null;
    win.isMaximized().then(setMaximized).catch(() => {});
    win
      .onResized(() => win.isMaximized().then(setMaximized).catch(() => {}))
      .then((fn) => { unlistenResize = fn; })
      .catch(() => {});

    // Manual drag implementation per Tauri docs:
    // https://v2.tauri.app/learn/window-customization/#manual-implementation-of-data-tauri-drag-region
    const el = dragRef.current;
    if (!el) return () => unlistenResize?.();

    const handleMouseDown = (e: MouseEvent) => {
      // Only respond to left mouse button
      if (e.buttons !== 1) return;
      // Don't interfere with interactive elements inside the drag region
      const target = e.target as HTMLElement;
      if (target.closest("button, a, input")) return;
      // Double-click → toggle maximize
      if (e.detail === 2) {
        void win.toggleMaximize();
        return;
      }
      // Single mousedown → start dragging
      void win.startDragging();
    };

    el.addEventListener("mousedown", handleMouseDown);
    return () => {
      el.removeEventListener("mousedown", handleMouseDown);
      unlistenResize?.();
    };
  }, []);

  const win = getCurrentWindow();

  return (
    <header className="flex h-10 shrink-0 select-none items-stretch border-b border-border bg-black">
      {/* Drag region + brand */}
      <div
        ref={dragRef}
        className="flex min-w-0 flex-1 cursor-default items-center gap-2.5 pl-3"
      >
        <BrandMark className="size-5" />
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
            danger
              ? "hover:bg-state-error hover:text-white"
              : "hover:bg-accent hover:text-foreground",
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
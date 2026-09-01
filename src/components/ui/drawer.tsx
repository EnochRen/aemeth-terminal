/**
 * Right‑side drawer panel — slides in from the right, pushes content.
 * Mirrors shadcn/ui Sheet but built inline to avoid extra dependencies.
 */
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export function Drawer({ open, onClose, children }: DrawerProps) {
  const wasOpen = useRef(false);

  useEffect(() => {
    wasOpen.current = open;
    if (open) {
      document.body.style.overflow = "hidden";
    } else if (wasOpen.current) {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 transition-opacity duration-200"
        onClick={onClose}
      />
      {/* Panel */}
      <div
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-[480px] max-w-[90vw] flex-col border-l border-border bg-[#050505] shadow-2xl",
          "animate-in slide-in-from-right duration-200",
        )}
      >
        {/* Header */}
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
          <span />
          <button
            type="button"
            onClick={onClose}
            className="flex size-7 items-center justify-center rounded-md text-[#666] transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        {/* Scrollable body */}
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </>
  );
}
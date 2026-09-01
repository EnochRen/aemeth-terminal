import { LayoutGrid, SquareTerminal, Plus } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/use-app-store";

/** VS Code-style activity rail. */
export function Sidebar() {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const openEditor = useAppStore((s) => s.openEditor);
  const running = useAppStore(
    (s) => Object.values(s.sessions).filter((x) => x.state === "running").length,
  );

  return (
    <aside className="flex w-[60px] shrink-0 flex-col items-center border-r border-border/60 bg-sidebar py-3">
      {/* Brand */}
      <div className="mb-4 flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-[#7c6cf0] to-[#4f46b8] font-bold text-white shadow-[0_0_18px_rgba(124,108,240,0.35)]">
        Æ
      </div>

      <nav className="flex flex-col items-center gap-1.5">
        <RailButton
          active={view === "apps"}
          label="应用列表"
          onClick={() => setView("apps")}
        >
          <LayoutGrid className="size-[19px]" />
        </RailButton>

        <RailButton
          active={view === "terminals"}
          label="终端"
          onClick={() => setView("terminals")}
        >
          <span className="relative">
            <SquareTerminal className="size-[19px]" />
            {running > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex size-3.5 items-center justify-center rounded-full bg-[#3dd68c] text-[8px] font-bold leading-none text-black">
                {running > 9 ? "9+" : running}
              </span>
            )}
          </span>
        </RailButton>
      </nav>

      <div className="mt-auto flex flex-col items-center gap-1.5">
        <RailButton label="新建应用" onClick={() => openEditor(null)}>
          <Plus className="size-[19px]" />
        </RailButton>
      </div>
    </aside>
  );
}

function RailButton({
  active,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className={cn(
            "relative flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors",
            "hover:bg-accent hover:text-foreground",
            active && "bg-accent text-foreground",
          )}
        >
          {active && (
            <span className="absolute -left-[13px] top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-primary" />
          )}
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

import { LayoutGrid, Plus, SquareTerminal } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/use-app-store";

/** Flat activity rail — black, hairline border, grey→white on active. */
export function Sidebar() {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const openEditor = useAppStore((s) => s.openEditor);
  const running = useAppStore(
    (s) => Object.values(s.sessions).filter((x) => x.state === "running").length,
  );

  return (
    <aside className="flex w-14 shrink-0 flex-col items-center border-r border-border bg-sidebar py-3">
      {/* Brand mark — bordered square, mono glyph */}
      <div className="mb-5 flex size-7 select-none items-center justify-center rounded-md border border-[#333] font-mono text-[13px] font-medium text-foreground">
        Æ
      </div>

      <nav className="flex flex-col items-center gap-1">
        <RailButton
          active={view === "apps"}
          label="应用列表"
          onClick={() => setView("apps")}
        >
          <LayoutGrid className="size-4" strokeWidth={1.75} />
        </RailButton>

        <RailButton
          active={view === "terminals"}
          label="终端"
          onClick={() => setView("terminals")}
        >
          <span className="relative">
            <SquareTerminal className="size-4" strokeWidth={1.75} />
            {running > 0 && (
              <span className="absolute -right-1 -top-0.5 size-1.5 rounded-full bg-state-running" />
            )}
          </span>
        </RailButton>
      </nav>

      <div className="mt-auto">
        <RailButton label="新建应用" onClick={() => openEditor(null)}>
          <Plus className="size-4" strokeWidth={1.75} />
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
            "flex size-9 items-center justify-center rounded-md text-[#a1a1a1] transition-colors duration-100",
            "hover:bg-accent hover:text-foreground",
            active && "bg-accent text-foreground",
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="font-mono text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

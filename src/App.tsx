import { useEffect } from "react";
import { Loader2 } from "lucide-react";

import { AppDialog } from "@/components/apps/app-dialog";
import { AppsView } from "@/components/apps/apps-view";
import { DeleteDialog } from "@/components/apps/delete-dialog";
import { Sidebar } from "@/components/layout/sidebar";
import { TerminalsView } from "@/components/terminals/terminals-view";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useShortcuts } from "@/hooks/use-shortcuts";
import { useAppStore } from "@/store/use-app-store";

export default function App() {
  const view = useAppStore((s) => s.view);
  const hydrated = useAppStore((s) => s.hydrated);

  useEffect(() => {
    void useAppStore.getState().hydrate();
  }, []);

  useShortcuts();

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex h-screen overflow-hidden bg-background text-foreground">
        <Sidebar />
        <main className="min-w-0 flex-1">
          {!hydrated ? (
            <BootScreen />
          ) : view === "apps" ? (
            <AppsView />
          ) : (
            <TerminalsView />
          )}
        </main>
      </div>

      <AppDialog />
      <DeleteDialog />
      <Toaster richColors position="top-center" theme="dark" />
    </TooltipProvider>
  );
}

function BootScreen() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <div className="flex size-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#7c6cf0] to-[#4f46b8] text-lg font-bold text-white shadow-[0_0_24px_rgba(124,108,240,0.4)]">
        Æ
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        正在加载…
      </div>
    </div>
  );
}

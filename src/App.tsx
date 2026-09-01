import { useEffect } from "react";

import { AppDialog } from "@/components/apps/app-dialog";
import { AppsView } from "@/components/apps/apps-view";
import { DeleteDialog } from "@/components/apps/delete-dialog";
import { Sidebar } from "@/components/layout/sidebar";
import { TitleBar } from "@/components/layout/title-bar";
import { TerminalsView } from "@/components/terminals/terminals-view";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useShortcuts } from "@/hooks/use-shortcuts";
import { useT } from "@/i18n/use-t";
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
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
        <TitleBar />
        <div className="flex min-h-0 flex-1">
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
      </div>

      <AppDialog />
      <DeleteDialog />
      <Toaster richColors position="top-center" theme="dark" />
    </TooltipProvider>
  );
}

function BootScreen() {
  const t = useT();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <div className="flex size-8 items-center justify-center rounded-md border border-[#333] font-mono text-sm text-foreground">
        Æ
      </div>
      <p className="label-micro">{t.app.loading}</p>
    </div>
  );
}

import { useEffect } from "react";

import { AppDialog } from "@/components/apps/app-dialog";
import { AppsView } from "@/components/apps/apps-view";
import { DeleteDialog } from "@/components/apps/delete-dialog";
import { Sidebar } from "@/components/layout/sidebar";
import { TitleBar } from "@/components/layout/title-bar";
import { ProcessesView } from "@/components/processes/processes-view";
import { SettingsView } from "@/components/settings/settings-view";
import { BrandMark } from "@/components/shared/brand-mark";
import { TerminalsView } from "@/components/terminals/terminals-view";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useShortcuts } from "@/hooks/use-shortcuts";
import { fmt } from "@/i18n/locales";
import { useT } from "@/i18n/use-t";
import { listenCloseBlocked } from "@/lib/pty";
import { useAppStore } from "@/store/use-app-store";

export default function App() {
  const view = useAppStore((s) => s.view);
  const hydrated = useAppStore((s) => s.hydrated);
  useEffect(() => {
    void useAppStore.getState().hydrate();
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listenCloseBlocked(() => {
      const s = useAppStore.getState();
      if (s.shuttingDown) return;
      if (s.settings.confirmClose) {
        s.setClosePrompt(true);
      } else {
        void s.shutdownAndExit();
      }
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, []);

  useShortcuts();

  return (
    <TooltipProvider delayDuration={250}>
      <div className="relative flex h-screen flex-col overflow-hidden bg-background text-foreground">
        <TitleBar />
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <main className="min-w-0 flex-1">
            {!hydrated ? (
              <BootScreen />
            ) : view === "apps" ? (
              <AppsView />
            ) : view === "terminals" ? (
              <TerminalsView />
            ) : view === "processes" ? (
              <ProcessesView />
            ) : (
              <SettingsView />
            )}
          </main>
        </div>
      </div>

      <AppDialog />
      <DeleteDialog />
      <CloseConfirmDialog />
      <ShutdownOverlay />
      <Toaster richColors position="top-center" theme="dark" />
    </TooltipProvider>
  );
}

function CloseConfirmDialog() {
  const t = useT();
  const open = useAppStore((s) => s.closePromptOpen);
  const setClosePrompt = useAppStore((s) => s.setClosePrompt);
  const shutdownAndExit = useAppStore((s) => s.shutdownAndExit);
  const running = useAppStore(
    (s) => Object.values(s.sessions).filter((x) => x.state === "running").length,
  );

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && setClosePrompt(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{fmt(t.settings.closeTitle, { n: running })}</AlertDialogTitle>
          <AlertDialogDescription>{t.settings.closeDesc}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t.settings.closeCancel}</AlertDialogCancel>
          <AlertDialogAction onClick={() => void shutdownAndExit()}>
            {t.settings.closeOk}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ShutdownOverlay() {
  const t = useT();
  const shuttingDown = useAppStore((s) => s.shuttingDown);
  if (!shuttingDown) return null;
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background">
      <div className="size-5 animate-spin rounded-full border-2 border-border border-t-foreground" />
      <p className="font-mono text-xs text-muted-foreground">{t.app.shuttingDown}</p>
    </div>
  );
}

function BootScreen() {
  const t = useT();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <BrandMark className="size-8 rounded-md" />
      <p className="label-micro">{t.app.loading}</p>
    </div>
  );
}

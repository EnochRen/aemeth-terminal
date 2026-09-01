import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { AppDialog } from "@/components/apps/app-dialog";
import { AppsView } from "@/components/apps/apps-view";
import { DeleteDialog } from "@/components/apps/delete-dialog";
import { Sidebar } from "@/components/layout/sidebar";
import { TitleBar } from "@/components/layout/title-bar";
import { SettingsView } from "@/components/settings/settings-view";
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
import { forceCloseWindow, isCloseForced } from "@/lib/window-close";
import { useAppStore } from "@/store/use-app-store";

export default function App() {
  const view = useAppStore((s) => s.view);
  const hydrated = useAppStore((s) => s.hydrated);

  useEffect(() => {
    void useAppStore.getState().hydrate();
  }, []);

  // Intercept window close while sessions are running.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    getCurrentWindow()
      .onCloseRequested((event) => {
        const s = useAppStore.getState();
        const running = Object.values(s.sessions).filter((x) => x.state === "running").length;
        if (!isCloseForced() && s.settings.confirmClose && running > 0) {
          event.preventDefault();
          s.setClosePrompt(true);
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
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
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
            ) : (
              <SettingsView />
            )}
          </main>
        </div>
      </div>

      <AppDialog />
      <DeleteDialog />
      <CloseConfirmDialog />
      <Toaster richColors position="top-center" theme="dark" />
    </TooltipProvider>
  );
}

function CloseConfirmDialog() {
  const t = useT();
  const open = useAppStore((s) => s.closePromptOpen);
  const setClosePrompt = useAppStore((s) => s.setClosePrompt);
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
          <AlertDialogAction onClick={() => void forceCloseWindow()}>
            {t.settings.closeOk}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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

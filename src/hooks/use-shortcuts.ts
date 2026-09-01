import { useEffect } from "react";
import { useAppStore } from "@/store/use-app-store";

/**
 * Global keyboard shortcuts (capture phase, so they win over xterm.js):
 *   Ctrl+Tab / Ctrl+Shift+Tab  — cycle terminal tabs
 *   Ctrl+1…9                   — jump to tab
 *   Ctrl+W                     — close active tab
 */
export function useShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      const s = useAppStore.getState();

      if (e.key === "Tab") {
        if (s.openTabs.length === 0 || inEditableContext()) return;
        e.preventDefault();
        e.stopPropagation();
        s.cycleTab(e.shiftKey ? -1 : 1);
        return;
      }

      if (inEditableContext()) return;

      if (s.view === "terminals") {
        if (e.key.toLowerCase() === "w" && s.activeAppId) {
          e.preventDefault();
          e.stopPropagation();
          s.closeTab(s.activeAppId);
          return;
        }
        if (/^[1-9]$/.test(e.key) && s.openTabs.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          s.jumpTab(Number(e.key) - 1);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);
}

function inEditableContext(): boolean {
  const el = document.activeElement;
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  ) {
    return true;
  }
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
}

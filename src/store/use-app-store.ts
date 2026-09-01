/**
 * Global app state: persisted app configs, live session status, tab layout.
 * Persisted via `tauri-plugin-store` (`aemeth.json` in the app data dir).
 */
import { create } from "zustand";
import { Store } from "@tauri-apps/plugin-store";
import { toast } from "sonner";

import { sessionRegistry } from "@/lib/session-registry";
import { ptyList, shellsDetect } from "@/lib/pty";
import type { AppConfig, SessionStatus, ShellInfo, ShellKind } from "@/types";

export type View = "apps" | "terminals";

const STORE_FILE = "aemeth.json";
const APPS_KEY = "apps";

let persistStore: Store | null = null;
let hydrating = false;

async function getStore(): Promise<Store> {
  if (!persistStore) {
    persistStore = await Store.load(STORE_FILE, { autoSave: 300 });
  }
  return persistStore;
}

interface AppState {
  hydrated: boolean;
  apps: AppConfig[];
  shells: ShellInfo[];
  /** Latest session status per app id. */
  sessions: Record<string, SessionStatus>;
  /** App ids with an open terminal tab, in tab order. */
  openTabs: string[];
  activeAppId: string | null;
  view: View;
  searchQuery: string;
  editorApp: AppConfig | null;
  editorOpen: boolean;
  deleteTarget: AppConfig | null;

  hydrate: () => Promise<void>;
  setView: (view: View) => void;
  setSearchQuery: (q: string) => void;

  openEditor: (app: AppConfig | null) => void;
  closeEditor: () => void;
  saveApp: (app: AppConfig) => Promise<void>;
  requestDelete: (app: AppConfig | null) => void;
  deleteApp: () => Promise<void>;

  startApp: (appId: string, focus?: boolean) => Promise<void>;
  stopApp: (appId: string) => Promise<void>;
  restartApp: (appId: string) => Promise<void>;
  openTerminal: (appId: string) => Promise<void>;
  closeTab: (appId: string) => void;
  setActiveTab: (appId: string) => void;
  cycleTab: (dir: 1 | -1) => void;
  jumpTab: (index: number) => void;

  defaultShell: () => ShellKind;
}

export const useAppStore = create<AppState>()((set, get) => ({
  hydrated: false,
  apps: [],
  shells: [],
  sessions: {},
  openTabs: [],
  activeAppId: null,
  view: "apps",
  searchQuery: "",
  editorApp: null,
  editorOpen: false,
  deleteTarget: null,

  hydrate: async () => {
    if (hydrating || get().hydrated) return;
    hydrating = true;

    await sessionRegistry.init();
    sessionRegistry.onStatus((appId, status) => {
      set((s) => ({ sessions: { ...s.sessions, [appId]: status } }));
    });

    const store = await getStore();
    const apps = ((await store.get<AppConfig[]>(APPS_KEY)) ?? []).sort(
      (a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt,
    );
    const shells = await shellsDetect().catch(() => [] as ShellInfo[]);
    set({ apps, shells, hydrated: true });

    // Reconcile sessions that survived a frontend reload.
    try {
      const live = await ptyList();
      if (live.length > 0) {
        const sessions: Record<string, SessionStatus> = { ...get().sessions };
        const openTabs = [...get().openTabs];
        for (const status of live) {
          sessions[status.appId] = status;
          if (!openTabs.includes(status.appId)) openTabs.push(status.appId);
        }
        set({ sessions, openTabs, activeAppId: get().activeAppId ?? openTabs[0] ?? null });
      }
    } catch {
      /* backend not reachable yet */
    }

    // Auto-start services flagged by the user.
    for (const app of apps) {
      if (app.autoStart) void get().startApp(app.id, false);
    }
  },

  setView: (view) => set({ view }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),

  openEditor: (app) => set({ editorApp: app, editorOpen: true }),
  closeEditor: () => set({ editorOpen: false, editorApp: null }),

  saveApp: async (app) => {
    const store = await getStore();
    const exists = get().apps.some((a) => a.id === app.id);
    const apps = exists
      ? get().apps.map((a) => (a.id === app.id ? app : a))
      : [...get().apps, app];
    set({ apps, editorOpen: false, editorApp: null });
    await store.set(APPS_KEY, apps);
    await store.save();
    toast.success(exists ? `已保存「${app.name}」` : `已创建「${app.name}」`);
  },

  requestDelete: (app) => set({ deleteTarget: app }),

  deleteApp: async () => {
    const target = get().deleteTarget;
    if (!target) return;
    set({ deleteTarget: null });

    await sessionRegistry.stop(target.id);
    sessionRegistry.remove(target.id);
    get().closeTab(target.id);

    const apps = get().apps.filter((a) => a.id !== target.id);
    const sessions = { ...get().sessions };
    delete sessions[target.id];
    set({ apps, sessions });

    const store = await getStore();
    await store.set(APPS_KEY, apps);
    await store.save();
    toast.success(`已删除「${target.name}」`);
  },

  startApp: async (appId, focus = true) => {
    const app = get().apps.find((a) => a.id === appId);
    if (!app) return;
    const current = get().sessions[appId];
    if (current?.state === "running") {
      if (focus) get().openTerminal(appId);
      return;
    }
    try {
      const client = await sessionRegistry.start(app);
      set((s) => ({
        sessions: { ...s.sessions, [appId]: client.status },
      }));
      if (focus) get().openTerminal(appId);
      else {
        set((s) => ({
          openTabs: s.openTabs.includes(appId) ? s.openTabs : [...s.openTabs, appId],
        }));
      }
    } catch (err) {
      if (err instanceof Error && err.message === "already starting") return;
      toast.error(`启动「${app.name}」失败`, {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  },

  stopApp: async (appId) => {
    await sessionRegistry.stop(appId);
  },

  restartApp: async (appId) => {
    const app = get().apps.find((a) => a.id === appId);
    if (!app) return;
    try {
      const client = await sessionRegistry.restart(app);
      set((s) => ({
        sessions: { ...s.sessions, [appId]: client.status },
        openTabs: s.openTabs.includes(appId) ? s.openTabs : [...s.openTabs, appId],
        activeAppId: appId,
        view: "terminals",
      }));
    } catch (err) {
      toast.error(`重启「${app.name}」失败`, {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  },

  openTerminal: async (appId) => {
    const session = get().sessions[appId];
    if (!session) {
      await get().startApp(appId);
      return;
    }
    set((s) => ({
      view: "terminals",
      activeAppId: appId,
      openTabs: s.openTabs.includes(appId) ? s.openTabs : [...s.openTabs, appId],
    }));
    // Focus after the pane has been attached.
    requestAnimationFrame(() => sessionRegistry.getByApp(appId)?.focus());
  },

  closeTab: (appId) => {
    set((s) => {
      const openTabs = s.openTabs.filter((id) => id !== appId);
      let activeAppId = s.activeAppId;
      if (activeAppId === appId) {
        const idx = s.openTabs.indexOf(appId);
        activeAppId = openTabs[Math.min(idx, openTabs.length - 1)] ?? null;
      }
      return { openTabs, activeAppId };
    });
    const session = get().sessions[appId];
    if (session?.state === "running") void sessionRegistry.stop(appId);
    sessionRegistry.remove(appId);
    set((s) => {
      const sessions = { ...s.sessions };
      delete sessions[appId];
      return { sessions };
    });
  },

  setActiveTab: (appId) => set({ activeAppId: appId, view: "terminals" }),

  cycleTab: (dir) => {
    const { openTabs, activeAppId } = get();
    if (openTabs.length === 0) return;
    const idx = activeAppId ? openTabs.indexOf(activeAppId) : -1;
    const next = openTabs[(idx + dir + openTabs.length) % openTabs.length];
    set({ activeAppId: next, view: "terminals" });
    requestAnimationFrame(() => sessionRegistry.getByApp(next)?.focus());
  },

  jumpTab: (index) => {
    const { openTabs } = get();
    const id = openTabs[index];
    if (id) get().setActiveTab(id);
  },

  defaultShell: () => {
    const shells = get().shells;
    const preferred: ShellKind[] = ["pwsh", "powershell", "cmd", "bash"];
    return (
      preferred.find((k) => shells.some((s) => s.kind === k && s.available)) ?? "powershell"
    );
  },
}));

/** Derive a display-friendly runtime state for an app. */
export function runtimeState(
  sessions: Record<string, SessionStatus>,
  appId: string,
): SessionStatus | null {
  return sessions[appId] ?? null;
}

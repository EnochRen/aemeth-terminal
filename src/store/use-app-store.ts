/**
 * Global app state: persisted app configs, live session status, tab layout.
 * Persisted via `tauri-plugin-store` (`aemeth.json` in the app data dir).
 */
import { create } from "zustand";
import { Store } from "@tauri-apps/plugin-store";
import { toast } from "sonner";

import { dictionaries, detectLocale, fmt, type Locale } from "@/i18n/locales";
import { sessionRegistry } from "@/lib/session-registry";
import { forceClose, ptyList, shellsDetect, shutdownSessions } from "@/lib/pty";
import { DEFAULT_SETTINGS, type AppConfig, type AppSettings, type SessionStatus, type ShellInfo, type ShellKind } from "@/types";

export type View = "apps" | "terminals" | "processes" | "settings";

const STORE_FILE = "aemeth.json";
const APPS_KEY = "apps";
const SETTINGS_KEY = "settings";

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
  editorApp: AppConfig | null;
  editorOpen: boolean;
  deleteTarget: AppConfig | null;
  locale: Locale;
  settings: AppSettings;
  closePromptOpen: boolean;
  /** Graceful shutdown in progress ("closing sessions…" overlay). */
  shuttingDown: boolean;

  hydrate: () => Promise<void>;
  setLocale: (locale: Locale) => Promise<void>;
  setSettings: (patch: Partial<AppSettings>) => Promise<void>;
  setClosePrompt: (open: boolean) => void;
  /** Graceful app exit: kill all sessions quietly, then close the window. */
  shutdownAndExit: () => Promise<void>;
  setView: (view: View) => void;

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
  editorApp: null,
  editorOpen: false,
  deleteTarget: null,
  locale: detectLocale(),
  settings: { ...DEFAULT_SETTINGS },
  closePromptOpen: false,
  shuttingDown: false,

  setClosePrompt: (open) => set({ closePromptOpen: open }),

  shutdownAndExit: async () => {
    if (get().shuttingDown) return;
    set({ shuttingDown: true, closePromptOpen: false });
    try {
      await shutdownSessions();
    } catch {
      /* best effort — force exit regardless */
    }
    await forceClose().catch(() => {});
  },

  setSettings: async (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    sessionRegistry.copyOnSelect = settings.copyOnSelect;
    sessionRegistry.applyTerminalOptions({
      fontSize: patch.terminalFontSize,
      scrollback: patch.scrollback,
    });
    const store = await getStore();
    await store.set(SETTINGS_KEY, settings);
    await store.save();
  },

  setLocale: async (locale) => {
    set({ locale });
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    const store = await getStore();
    await store.set("locale", locale);
    await store.save();
  },

  hydrate: async () => {
    if (hydrating || get().hydrated) return;
    hydrating = true;

    await sessionRegistry.init();
    sessionRegistry.onStatus((appId, status) => {
      set((s) => {
        const app = s.apps.find((a) => a.id === appId);
        if (app?.kind === "script" && status.state === "exited") {
          status = { ...status, durationMs: Date.now() - status.startedAt };
        }
        return { sessions: { ...s.sessions, [appId]: status } };
      });
    });
    sessionRegistry.onPorts((appId, ports) => {
      set((s) => {
        const current = s.sessions[appId];
        if (!current) return {};
        return { sessions: { ...s.sessions, [appId]: { ...current, ports } } };
      });
    });
    sessionRegistry.onHealth((appId, healthy) => {
      set((s) => {
        const current = s.sessions[appId];
        if (!current) return {};
        return { sessions: { ...s.sessions, [appId]: { ...current, healthy } } };
      });
    });

    const store = await getStore();
    const savedLocale = await store.get<Locale>("locale");
    const locale = savedLocale ?? get().locale;
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    const savedSettings = await store.get<Partial<AppSettings>>(SETTINGS_KEY);
    const settings = { ...DEFAULT_SETTINGS, ...savedSettings };
    sessionRegistry.copyOnSelect = settings.copyOnSelect;
    sessionRegistry.applyTerminalOptions({
      fontSize: settings.terminalFontSize,
      scrollback: settings.scrollback,
    });
    const apps = ((await store.get<AppConfig[]>(APPS_KEY)) ?? []).map((a) => ({
      ...a,
      kind: a.kind ?? "service",
    })).sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt);
    const shells = await shellsDetect().catch(() => [] as ShellInfo[]);
    set({ apps, shells, hydrated: true, locale, settings });

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
    const t = dictionaries[get().locale].toasts;
    toast.success(fmt(exists ? t.saved : t.created, { name: app.name }));
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
    const t = dictionaries[get().locale].toasts;
    toast.success(fmt(t.deleted, { name: target.name }));
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
      toast.error(fmt(dictionaries[get().locale].toasts.startFailed, { name: app.name }), {
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
      toast.error(fmt(dictionaries[get().locale].toasts.restartFailed, { name: app.name }), {
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
    const configured = get().settings.defaultShell;
    if (configured !== "auto" && shells.some((s) => s.kind === configured && s.available)) {
      return configured;
    }
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

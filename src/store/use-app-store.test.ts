import { beforeEach, expect, it, vi } from "vitest";
import type { SessionStatus } from "@/types";

const mocks = vi.hoisted(() => ({
  shutdown: vi.fn(), forceClose: vi.fn(), stop: vi.fn(), remove: vi.fn(), error: vi.fn(),
}));
vi.mock("@/lib/pty", () => ({
  shutdownSessions: mocks.shutdown, forceClose: mocks.forceClose,
  ptyList: vi.fn(), shellsDetect: vi.fn(),
}));
vi.mock("@/lib/session-registry", () => ({ sessionRegistry: { stop: mocks.stop, remove: mocks.remove } }));
vi.mock("@tauri-apps/plugin-store", () => ({ Store: {} }));
vi.mock("sonner", () => ({ toast: { error: mocks.error } }));

import { useAppStore } from "@/store/use-app-store";

beforeEach(() => {
  vi.resetAllMocks();
  useAppStore.setState({
    shuttingDown: false, closePromptOpen: true, sessions: {}, openTabs: [], activeAppId: null,
  });
});

it("keeps shutdown single-flight and destroys the window only after cleanup", async () => {
  let finish!: () => void;
  mocks.shutdown.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
  const closing = useAppStore.getState().shutdownAndExit();
  expect(useAppStore.getState().shuttingDown).toBe(true);
  expect(useAppStore.getState().closePromptOpen).toBe(false);
  await useAppStore.getState().shutdownAndExit();
  expect(mocks.shutdown).toHaveBeenCalledTimes(1);
  expect(mocks.forceClose).not.toHaveBeenCalled();
  finish();
  await closing;
  expect(mocks.forceClose).toHaveBeenCalledTimes(1);
});

it("keeps the window open and recovers the UI when cleanup fails", async () => {
  mocks.shutdown.mockRejectedValueOnce(new Error("cleanup timeout"));
  await useAppStore.getState().shutdownAndExit();
  expect(mocks.forceClose).not.toHaveBeenCalled();
  expect(useAppStore.getState().shuttingDown).toBe(false);
  expect(mocks.error).toHaveBeenCalled();
  await useAppStore.getState().shutdownAndExit();
  expect(mocks.forceClose).toHaveBeenCalledTimes(1);
});

it("recovers the overlay when native window destruction fails", async () => {
  mocks.forceClose.mockRejectedValue(new Error("window error"));
  await useAppStore.getState().shutdownAndExit();
  expect(useAppStore.getState().shuttingDown).toBe(false);
  expect(mocks.error).toHaveBeenCalled();
});

it("hides a tab immediately but keeps its session until cleanup succeeds", async () => {
  const session: SessionStatus = {
    sessionId: "session", appId: "app", name: "Test", shell: "cmd", state: "running", startedAt: 1,
  };
  useAppStore.setState({ sessions: { app: session }, openTabs: ["app"], activeAppId: "app" });
  let fail!: (error: Error) => void;
  mocks.stop.mockReturnValueOnce(new Promise<void>((_, reject) => { fail = reject; }));
  const closing = useAppStore.getState().closeTab("app");
  expect(useAppStore.getState().openTabs).toEqual([]);
  expect(mocks.remove).not.toHaveBeenCalled();
  fail(new Error("permission denied"));
  await closing;
  expect(useAppStore.getState().sessions.app).toBe(session);
  expect(mocks.remove).not.toHaveBeenCalled();
  await useAppStore.getState().closeTab("app");
  expect(mocks.remove).toHaveBeenCalledWith("app");
  expect(useAppStore.getState().sessions.app).toBeUndefined();
});

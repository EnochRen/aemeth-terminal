import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig, SessionStatus } from "@/types";

const ipc = vi.hoisted(() => ({
  start: vi.fn(), close: vi.fn(),
  exit: undefined as undefined | ((status: SessionStatus) => void),
  health: undefined as undefined | ((status: { sessionId: string; appId: string; healthy: boolean }) => void),
}));

vi.mock("@/lib/pty", () => ({
  ptyStart: ipc.start,
  ptyClose: ipc.close,
  ptyWrite: vi.fn(), ptyResize: vi.fn(), openUrl: vi.fn(),
  textEncoder: new TextEncoder(), base64ToBytes: vi.fn(),
  listenPtyOutput: vi.fn(), listenPtyPorts: vi.fn(),
  listenPtyExit: vi.fn((listener) => { ipc.exit = listener; }),
  listenHealth: vi.fn((listener) => { ipc.health = listener; }),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ readText: vi.fn(), writeText: vi.fn() }));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    unicode = { activeVersion: "" };
    loadAddon() {}
    attachCustomKeyEventHandler() {}
    onData() {}
    onBinary() {}
    onSelectionChange() {}
    dispose() {}
  },
}));

import { SessionRegistry } from "@/lib/session-registry";

const app: AppConfig = {
  id: "app", name: "Test", shell: "cmd", cwd: null, commands: [],
  startupDelayMs: 0, kind: "service", autoStart: false, color: "blue",
  sortOrder: 0, createdAt: 0, updatedAt: 0,
};
function status(sessionId = "old", state: SessionStatus["state"] = "running"): SessionStatus {
  return { sessionId, state, appId: app.id, name: app.name, shell: app.shell, startedAt: 1 };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("session lifecycle", () => {
  let registry: SessionRegistry;
  beforeEach(async () => {
    vi.clearAllMocks();
    ipc.start.mockResolvedValue(status());
    ipc.close.mockResolvedValue(undefined);
    registry = new SessionRegistry();
    await registry.init();
  });

  it("shows stopping immediately, yields to UI tasks, and shares duplicate stops", async () => {
    const client = await registry.start(app);
    const cleanup = deferred<void>();
    ipc.close.mockReturnValue(cleanup.promise);
    const first = registry.stop(app.id);
    expect(client.status.state).toBe("stopping");
    expect(registry.stop(app.id)).toBe(first);
    expect(ipc.close).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.status.state).toBe("stopping");
    cleanup.resolve();
    await first;
    expect(client.status.state).toBe("exited");
  });

  it("waits for old cleanup before starting a replacement", async () => {
    await registry.start(app);
    const cleanup = deferred<void>();
    ipc.close.mockReturnValue(cleanup.promise);
    ipc.start.mockResolvedValue(status("new"));
    const stopping = registry.stop(app.id);
    const restarting = registry.restart(app);
    await Promise.resolve();
    expect(ipc.start).toHaveBeenCalledTimes(1);
    cleanup.resolve();
    await stopping;
    expect((await restarting).sessionId).toBe("new");
    expect(ipc.start).toHaveBeenCalledTimes(2);
  });

  it("restores a failed stop so it can be retried, and does not restart on failure", async () => {
    const client = await registry.start(app);
    ipc.close.mockRejectedValueOnce(new Error("permission denied"));
    await expect(registry.restart(app)).rejects.toThrow("permission denied");
    expect(client.status.state).toBe("running");
    expect(registry.getByApp(app.id)).toBe(client);
    expect(ipc.start).toHaveBeenCalledTimes(1);
    await registry.stop(app.id);
    expect(client.status.state).toBe("exited");
  });

  it("preserves an authoritative exit when a late close response fails", async () => {
    const client = await registry.start(app);
    const cleanup = deferred<void>();
    ipc.close.mockReturnValue(cleanup.promise);
    const stopping = registry.stop(app.id);
    ipc.exit!(status("old", "exited"));
    cleanup.reject(new Error("late failure"));
    await expect(stopping).rejects.toThrow("late failure");
    expect(client.status.state).toBe("exited");
  });

  it("stops a session whose startup was still pending", async () => {
    const startup = deferred<SessionStatus>();
    ipc.start.mockReturnValue(startup.promise);
    const starting = registry.start(app);
    expect(registry.start(app)).toBe(starting);
    const stopping = registry.stop(app.id);
    expect(ipc.close).not.toHaveBeenCalled();
    startup.resolve(status());
    await stopping;
    expect(ipc.close).toHaveBeenCalledWith("old");
    expect((await starting).status.state).toBe("exited");
  });

  it("retains an exit event that arrives before startup completes", async () => {
    const startup = deferred<SessionStatus>();
    ipc.start.mockReturnValue(startup.promise);
    const starting = registry.start(app);
    ipc.exit!(status("old", "exited"));
    startup.resolve(status());
    expect((await starting).status.state).toBe("exited");
  });

  it("ignores health results from a previous session after restart", async () => {
    await registry.start(app);
    ipc.start.mockResolvedValue(status("new"));
    const current = await registry.restart(app);
    ipc.health!({ sessionId: "old", appId: app.id, healthy: false });
    expect(current.status.healthy).toBeUndefined();
    ipc.health!({ sessionId: "new", appId: app.id, healthy: true });
    expect(current.status.healthy).toBe(true);
  });
});

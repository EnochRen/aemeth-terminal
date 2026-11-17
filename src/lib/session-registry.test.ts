import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig, SessionStatus } from "@/types";

const ipc = vi.hoisted(() => ({
  start: vi.fn(), close: vi.fn(), closeFast: vi.fn(),
  output: undefined as undefined | ((payload: { sessionId: string; data: string }) => void),
  exit: undefined as undefined | ((status: SessionStatus) => void),
  health: undefined as undefined | ((status: { sessionId: string; appId: string; healthy: boolean }) => void),
  stopError: undefined as undefined | ((status: { sessionId: string; appId: string; error: string }) => void),
}));

vi.mock("@/lib/pty", () => ({
  ptyStart: ipc.start,
  ptyClose: ipc.close,
  ptyCloseFast: ipc.closeFast,
  ptyWrite: vi.fn(), ptyResize: vi.fn(), openUrl: vi.fn(),
  textEncoder: new TextEncoder(),
  base64ToBytes: (data: string) => Uint8Array.from(atob(data), (char) => char.charCodeAt(0)),
  listenPtyOutput: vi.fn((listener) => { ipc.output = listener; }), listenPtyPorts: vi.fn(),
  listenPtyExit: vi.fn((listener) => { ipc.exit = listener; }),
  listenPtyStopError: vi.fn((listener) => { ipc.stopError = listener; }),
  listenHealth: vi.fn((listener) => { ipc.health = listener; }),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ readText: vi.fn(), writeText: vi.fn() }));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    unicode = { activeVersion: "" };
    write = vi.fn();
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
    ipc.closeFast.mockResolvedValue(undefined);
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

  it("starts a replacement after force termination is requested without waiting for cleanup", async () => {
    await registry.start(app);
    const cleanup = deferred<void>();
    ipc.close.mockReturnValue(cleanup.promise);
    ipc.start.mockResolvedValue(status("new"));
    const stopping = registry.stop(app.id);
    const restarting = registry.restart(app);
    expect((await restarting).sessionId).toBe("new");
    expect(ipc.closeFast).toHaveBeenCalledWith("old");
    expect(ipc.start).toHaveBeenCalledTimes(2);
    cleanup.resolve();
    await stopping;
    expect(registry.getByApp(app.id)?.status.state).toBe("running");
  });

  it("shares concurrent restarts and reports background cleanup errors", async () => {
    await registry.start(app);
    const issued = deferred<void>();
    ipc.closeFast.mockReturnValue(issued.promise);
    ipc.start.mockResolvedValue(status("new"));
    const failed = vi.fn();
    registry.onStopError(failed);
    const restarting = registry.restart(app);
    expect(registry.restart(app)).toBe(restarting);
    expect(ipc.closeFast).toHaveBeenCalledTimes(1);
    expect(ipc.start).toHaveBeenCalledTimes(1);
    issued.resolve();
    await restarting;
    ipc.stopError!({ sessionId: "old", appId: app.id, error: "access denied" });
    expect(failed).toHaveBeenCalledWith(app.id, "old", "access denied");
  });

  it("stops the replacement when a stop is requested while restart is issuing the kill", async () => {
    await registry.start(app);
    const issued = deferred<void>();
    ipc.closeFast.mockReturnValue(issued.promise);
    ipc.start.mockResolvedValue(status("new"));
    const restarting = registry.restart(app);
    const stopping = registry.stop(app.id);
    issued.resolve();
    await restarting;
    await stopping;
    expect(ipc.close).toHaveBeenCalledWith("new");
    expect(registry.getByApp(app.id)?.status.state).toBe("exited");
  });

  it("stops the replacement when a stop is requested while it is starting", async () => {
    await registry.start(app);
    const startup = deferred<SessionStatus>();
    ipc.start.mockReturnValue(startup.promise);
    const restarting = registry.restart(app);
    await Promise.resolve();
    await Promise.resolve();
    const stopping = registry.stop(app.id);
    startup.resolve(status("new"));
    await restarting;
    await stopping;
    expect(ipc.close).toHaveBeenCalledWith("new");
    expect(registry.getByApp(app.id)?.status.state).toBe("exited");
  });

  it("retries the old session when a pending restart fails to issue termination", async () => {
    await registry.start(app);
    const issued = deferred<void>();
    ipc.closeFast.mockReturnValue(issued.promise);
    const restarting = registry.restart(app);
    const stopping = registry.stop(app.id);
    issued.reject(new Error("some termination requests failed"));
    await expect(restarting).rejects.toThrow("some termination requests failed");
    await stopping;
    expect(ipc.start).toHaveBeenCalledTimes(1);
    expect(ipc.close).toHaveBeenCalledWith("old");
    expect(registry.getByApp(app.id)?.status.state).toBe("exited");
  });

  it("restores a failed stop so it can be retried, and does not restart on failure", async () => {
    const client = await registry.start(app);
    ipc.closeFast.mockRejectedValueOnce(new Error("permission denied"));
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

  it("replays early output in order even if a short script already exited", async () => {
    const startup = deferred<SessionStatus>();
    ipc.start.mockReturnValue(startup.promise);
    const starting = registry.start(app);
    ipc.output!({ sessionId: "old", data: btoa("first\r\n") });
    ipc.output!({ sessionId: "old", data: btoa("second\r\n") });
    ipc.exit!(status("old", "exited"));
    startup.resolve(status());
    const client = await starting;
    expect(client.term.write).toHaveBeenCalledWith(new TextEncoder().encode("first\r\nsecond\r\n"));
    expect(client.status.state).toBe("exited");
    ipc.output!({ sessionId: "old", data: btoa("tail\r\n") });
    expect(client.term.write).toHaveBeenLastCalledWith(new TextEncoder().encode("tail\r\n"));
  });

  it("caps startup output and discards buffers after a failed launch", async () => {
    const startup = deferred<SessionStatus>();
    ipc.start.mockReturnValueOnce(startup.promise);
    const starting = registry.start(app);
    ipc.output!({ sessionId: "old", data: btoa("x".repeat(1024 * 1024 + 32)) });
    ipc.output!({ sessionId: "old", data: btoa("tail") });
    startup.resolve(status());
    const client = await starting;
    const replay = vi.mocked(client.term.write).mock.calls[0][0] as Uint8Array;
    expect(replay.length).toBe(1024 * 1024);
    expect(new TextDecoder().decode(replay.slice(-4))).toBe("tail");

    const failed = deferred<SessionStatus>();
    ipc.start.mockReturnValueOnce(failed.promise);
    const failedStart = registry.start({ ...app, id: "other" });
    ipc.output!({ sessionId: "failed", data: btoa("stale") });
    failed.reject(new Error("spawn failed"));
    await expect(failedStart).rejects.toThrow("spawn failed");

    const retry = deferred<SessionStatus>();
    ipc.start.mockReturnValueOnce(retry.promise);
    const retried = registry.start({ ...app, id: "other" });
    ipc.output!({ sessionId: "fresh", data: btoa("fresh") });
    retry.resolve({ ...status("fresh"), appId: "other" });
    expect((await retried).term.write).toHaveBeenCalledWith(new TextEncoder().encode("fresh"));
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

  it("ignores retired session output and exit while the replacement starts", async () => {
    await registry.start(app);
    const startup = deferred<SessionStatus>();
    ipc.start.mockReturnValueOnce(startup.promise);
    const restarting = registry.restart(app);
    await Promise.resolve();
    await Promise.resolve();
    ipc.output!({ sessionId: "old", data: btoa("old") });
    ipc.exit!(status("old", "exited"));
    ipc.output!({ sessionId: "new", data: btoa("new") });
    startup.resolve(status("new"));
    const client = await restarting;
    expect(client.status.state).toBe("running");
    expect(client.term.write).toHaveBeenCalledWith(new TextEncoder().encode("new"));
  });
});

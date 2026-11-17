import { beforeEach, describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({ icons: vi.fn() }));
vi.mock("@/lib/proc", () => ({ processIcons: ipc.icons }));

describe("process icon requests", () => {
  beforeEach(() => {
    vi.resetModules();
    ipc.icons.mockReset();
  });

  it("batches visible paths and shares duplicate requests across refreshes", async () => {
    ipc.icons.mockImplementation(async (paths: string[]) =>
      Object.fromEntries(paths.map((path) => [path, `data:${path}`])),
    );
    const { getProcessIcon } = await import("@/lib/process-icons");
    const paths = Array.from({ length: 40 }, (_, i) => `app-${i}.exe`);
    const requests = paths.map(getProcessIcon);
    requests.push(getProcessIcon(paths[0]));
    const results = await Promise.all(requests);
    expect(results[0]).toBe("data:app-0.exe");
    expect(results[40]).toBe(results[0]);
    expect(ipc.icons).toHaveBeenCalledTimes(3);
    expect(ipc.icons.mock.calls.map(([batch]) => batch.length)).toEqual([16, 16, 8]);
    expect(await getProcessIcon(paths[0])).toBe(results[0]);
    expect(ipc.icons).toHaveBeenCalledTimes(3);
  });

  it("retries IPC failures but caches a confirmed missing icon", async () => {
    ipc.icons.mockRejectedValueOnce(new Error("unavailable"));
    ipc.icons.mockResolvedValueOnce({ "missing.exe": null });
    const { getProcessIcon } = await import("@/lib/process-icons");
    await expect(getProcessIcon("missing.exe")).rejects.toThrow("unavailable");
    expect(await getProcessIcon("missing.exe")).toBeNull();
    expect(await getProcessIcon("missing.exe")).toBeNull();
    expect(ipc.icons).toHaveBeenCalledTimes(2);
  });
});

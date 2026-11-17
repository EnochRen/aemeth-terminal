import { processIcons } from "@/lib/proc";

const BATCH_SIZE = 16;
const MAX_CONCURRENT = 2;
const MAX_CACHED = 1024;
const cache = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();
const queue: {
  path: string;
  resolve: (icon: string | null) => void;
  reject: (error: unknown) => void;
}[] = [];
let active = 0;
let scheduled = false;

/** Share requests across rows and refreshes; avoid one IPC call per process. */
export function getProcessIcon(path: string): Promise<string | null> {
  if (cache.has(path)) return Promise.resolve(cache.get(path) ?? null);
  const existing = pending.get(path);
  if (existing) return existing;
  const request = new Promise<string | null>((resolve, reject) => queue.push({ path, resolve, reject }));
  pending.set(path, request);
  if (!scheduled) {
    scheduled = true;
    queueMicrotask(drain);
  }
  return request;
}

function drain(): void {
  scheduled = false;
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const batch = queue.splice(0, BATCH_SIZE);
    active++;
    void processIcons(batch.map(({ path }) => path))
      .then((icons) => {
        for (const { path, resolve } of batch) {
          const icon = icons[path] ?? null;
          if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
          cache.set(path, icon);
          pending.delete(path);
          resolve(icon);
        }
      }, (error: unknown) => {
        // IPC errors are transient; unlike a confirmed null, they must not be
        // cached. A later request can try the same path again.
        for (const { path, reject } of batch) {
          pending.delete(path);
          reject(error);
        }
      })
      .finally(() => {
        active--;
        drain();
      });
  }
}

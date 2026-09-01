/** Typed IPC for the process-manager page (`src-tauri/src/procs.rs`). */
import { invoke } from "@tauri-apps/api/core";
import type { ProcessInfo } from "@/types";

/** Snapshot of every system process. */
export function processList(): Promise<ProcessInfo[]> {
  return invoke("process_list");
}

/** Force-kill a process and its descendants. Returns the number killed. */
export function processKill(pid: number): Promise<number> {
  return invoke("process_kill", { pid });
}

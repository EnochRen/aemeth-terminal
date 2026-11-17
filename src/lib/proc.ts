import { invoke } from "@tauri-apps/api/core";
import type { ProcessDetail, ProcessInfo } from "@/types";

export function processList(): Promise<ProcessInfo[]> {
  return invoke("process_list");
}

/** PNG data URLs by executable path; inaccessible or unrecognised paths are null. */
export function processIcons(exes: string[]): Promise<Record<string, string | null>> {
  return invoke("process_icons", { exes });
}

export function processKill(pid: number, startTime: number): Promise<number> {
  return invoke("process_kill", { pid, startTime });
}

export function processDetail(pid: number): Promise<ProcessDetail> {
  return invoke("process_detail", { pid });
}

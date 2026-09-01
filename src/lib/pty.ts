/**
 * Typed IPC layer over the Tauri PTY backend (`src-tauri/src/pty.rs`).
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AppConfig, SessionStatus, ShellInfo } from "@/types";

export const PTY_OUTPUT_EVENT = "pty://output";
export const PTY_EXIT_EVENT = "pty://exit";
export const CLOSE_BLOCKED_EVENT = "aemeth://close-blocked";

export interface PtyOutputPayload {
  sessionId: string;
  /** Base64-encoded raw terminal bytes. */
  data: string;
}

/** Spec sent to the backend when launching a session. */
export interface StartSpec {
  appId: string;
  name: string;
  shell: AppConfig["shell"];
  cwd: string | null;
  startupDelayMs: number;
  commands: { command: string; delayMs: number }[];
}

export function ptyStart(spec: StartSpec): Promise<SessionStatus> {
  return invoke("pty_start", { spec });
}

export function ptyWrite(sessionId: string, bytes: Uint8Array): Promise<void> {
  return invoke("pty_write", { sessionId, data: bytesToBase64(bytes) });
}

export function ptyResize(sessionId: string, cols: number, rows: number): Promise<void> {
  return invoke("pty_resize", { sessionId, cols, rows });
}

export function ptyClose(sessionId: string): Promise<void> {
  return invoke("pty_close", { sessionId });
}

export function ptyList(): Promise<SessionStatus[]> {
  return invoke("pty_list");
}

export function shellsDetect(): Promise<ShellInfo[]> {
  return invoke("shells_detect");
}

/**
 * Confirmed close: Rust destroys the window natively, bypassing the webview
 * event queue (which may be backlogged with session output).
 */
export function forceClose(): Promise<void> {
  return invoke("close_force");
}

/** Fired by the native close guard with the number of running sessions. */
export function listenCloseBlocked(handler: (running: number) => void): Promise<UnlistenFn> {
  return listen<number>(CLOSE_BLOCKED_EVENT, (e) => handler(e.payload));
}

export function listenPtyOutput(handler: (payload: PtyOutputPayload) => void): Promise<UnlistenFn> {
  return listen<PtyOutputPayload>(PTY_OUTPUT_EVENT, (e) => handler(e.payload));
}

export function listenPtyExit(handler: (payload: SessionStatus) => void): Promise<UnlistenFn> {
  return listen<SessionStatus>(PTY_EXIT_EVENT, (e) => handler(e.payload));
}

/* ------------------------------------------------------------------ */
/* base64 helpers                                                      */
/* ------------------------------------------------------------------ */

const B64_CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + B64_CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export const textEncoder = new TextEncoder();

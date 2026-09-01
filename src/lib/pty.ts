import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AppConfig, SessionStatus, ShellInfo } from "@/types";

export const PTY_OUTPUT_EVENT = "pty://output";
export const PTY_EXIT_EVENT = "pty://exit";
export const PTY_PORTS_EVENT = "pty://ports";
export const HEALTH_EVENT = "aemeth://health";
export const CLOSE_BLOCKED_EVENT = "aemeth://close-blocked";

export interface PtyOutputPayload {
  sessionId: string;
  /** Base64-encoded raw terminal bytes. */
  data: string;
}

export interface PtyPortsPayload {
  sessionId: string;
  /** TCP ports the session's process tree listens on. */
  ports: number[];
}

export interface HealthPayload {
  sessionId: string;
  appId: string;
  healthy: boolean;
}

export interface StartSpec {
  appId: string;
  name: string;
  kind: AppConfig["kind"];
  shell: AppConfig["shell"];
  cwd: string | null;
  startupDelayMs: number;
  commands: { command: string; delayMs: number }[];
  envVars?: Record<string, string>;
  healthCheckUrl?: string;
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

export function forceClose(): Promise<void> {
  return invoke("close_force");
}

export function shutdownSessions(): Promise<void> {
  return invoke("shutdown_sessions");
}

export function openUrl(url: string): Promise<void> {
  return invoke("open_url", { url });
}

export function listenCloseBlocked(handler: (running: number) => void): Promise<UnlistenFn> {
  return listen<number>(CLOSE_BLOCKED_EVENT, (e) => handler(e.payload));
}

export function listenPtyOutput(handler: (payload: PtyOutputPayload) => void): Promise<UnlistenFn> {
  return listen<PtyOutputPayload>(PTY_OUTPUT_EVENT, (e) => handler(e.payload));
}

export function listenPtyExit(handler: (payload: SessionStatus) => void): Promise<UnlistenFn> {
  return listen<SessionStatus>(PTY_EXIT_EVENT, (e) => handler(e.payload));
}

export function listenPtyPorts(handler: (payload: PtyPortsPayload) => void): Promise<UnlistenFn> {
  return listen<PtyPortsPayload>(PTY_PORTS_EVENT, (e) => handler(e.payload));
}

export function listenHealth(handler: (payload: HealthPayload) => void): Promise<UnlistenFn> {
  return listen<HealthPayload>(HEALTH_EVENT, (e) => handler(e.payload));
}

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

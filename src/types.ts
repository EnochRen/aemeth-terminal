/** Logical shell identifiers — mirrors `src-tauri/src/shells.rs`. */
export type ShellKind = "powershell" | "pwsh" | "cmd" | "bash" | "zsh" | "sh";

export interface ShellInfo {
  kind: ShellKind;
  label: string;
  path: string | null;
  available: boolean;
  defaultArgs: string[];
}

/** One preset line typed into the shell after startup. */
export interface PresetCommand {
  command: string;
  /** Milliseconds to wait after sending this line before the next one. */
  delayMs: number;
}

/** Persisted configuration of a launchable app/service. */
export interface AppConfig {
  id: string;
  name: string;
  shell: ShellKind;
  cwd: string | null;
  commands: PresetCommand[];
  /** Milliseconds to wait for the shell prompt before sending preset commands. */
  startupDelayMs: number;
  /** Tags used to group apps together (workspace). */
  tags?: string[];
  /** Health‑check URL (any 2xx response is considered healthy). */
  healthCheckUrl?: string;
  /** Application kind — long-lived service or fire-and-forget script. */
  kind: "service" | "script";
  /** Launch automatically when Aemeth starts. */
  autoStart: boolean;
  /** Environment variables injected into the shell. */
  envVars?: Record<string, string>;
  /** Accent color used for the app avatar & status accents. */
  color: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export type SessionState = "running" | "exited";

/** Lifecycle snapshot of a pty session — mirrors `SessionStatus` in Rust. */
export interface SessionStatus {
  sessionId: string;
  appId: string;
  name: string;
  shell: ShellKind;
  state: SessionState;
  exitCode?: number;
  pid?: number;
  /** TCP ports the session's process tree listens on (live-updated). */
  ports?: number[];
  /** Whether the last health‑check passed (undefined = no check configured). */
  healthy?: boolean;
  /** Runtime duration in ms (set on exit for script-type apps). */
  durationMs?: number;
  startedAt: number;
}

export type AppRuntimeState = "stopped" | "starting" | "running" | "exited";

/** One system process — mirrors `ProcessInfo` in Rust. */
export interface ProcessInfo {
  pid: number;
  ppid: number | null;
  name: string;
  /** Full command line, arguments joined by spaces. */
  cmd: string;
  exe: string | null;
  /** Resident memory in bytes. */
  memory: number;
  cpu: number;
  /** Start time, seconds since the epoch. */
  startTime: number;
  ports: number[];
}

/** Deep detail for a single process — mirrors `ProcessDetail` in Rust. */
export interface ProcessDetail {
  pid: number;
  ppid: number | null;
  name: string;
  cmd: string;
  exe: string | null;
  memory: number;
  cpu: number;
  startTime: number;
  ports: number[];
  threads?: number;
  environ: string[];
  diskReadBytes: number;
  diskWriteBytes: number;
}

/** Global, persisted preferences. */
export interface AppSettings {
  terminalFontSize: number;
  scrollback: number;
  copyOnSelect: boolean;
  confirmClose: boolean;
  defaultShell: ShellKind | "auto";
}

export const DEFAULT_SETTINGS: AppSettings = {
  terminalFontSize: 13,
  scrollback: 10_000,
  copyOnSelect: false,
  confirmClose: true,
  defaultShell: "auto",
};

/** Muted identity dots — borrowed from the Geist scale. */
export const APP_COLORS = [
  "#ededed",
  "#0072f5",
  "#46a758",
  "#ffb224",
  "#e5484d",
  "#8e4ec6",
  "#12a594",
  "#d6409f",
] as const;

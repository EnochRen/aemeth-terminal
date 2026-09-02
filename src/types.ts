export type ShellKind = "powershell" | "pwsh" | "cmd" | "bash" | "zsh" | "sh";

export interface ShellInfo {
  kind: ShellKind;
  label: string;
  path: string | null;
  available: boolean;
  defaultArgs: string[];
}

export interface PresetCommand {
  command: string;
  /** Milliseconds to wait after sending this line before the next one. */
  delayMs: number;
}

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

export interface SessionStatus {
  sessionId: string;
  appId: string;
  name: string;
  shell: ShellKind;
  state: SessionState;
  exitCode?: number;
  pid?: number;
  /** True when killed by the user (stop/close) instead of exiting naturally. */
  killed?: boolean;
  /** TCP ports the session's process tree listens on (live-updated). */
  ports?: number[];
  /** Whether the last health‑check passed (undefined = no check configured). */
  healthy?: boolean;
  /** Runtime duration in ms (set on exit for script-type apps). */
  durationMs?: number;
  startedAt: number;
}

export type AppRuntimeState = "stopped" | "starting" | "running" | "exited";

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

export interface AppSettings {
  terminalFontSize: number;
  scrollback: number;
  copyOnSelect: boolean;
  confirmClose: boolean;
  defaultShell: ShellKind | "auto";
  /** Apps page layout preference. */
  appsViewMode: "card" | "table";
  /** Whether to automatically download and install updates. */
  autoUpdate: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  terminalFontSize: 13,
  scrollback: 10_000,
  copyOnSelect: false,
  confirmClose: true,
  defaultShell: "auto",
  appsViewMode: "card",
  autoUpdate: true,
};

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

// --------------- Updater types ---------------

export interface UpdateInfo {
  hasUpdate: boolean;
  versionName: string;
  releaseNote: string;
  downloadUrl?: string;
  fileSize?: number;
  filename?: string;
}

export interface DownloadProgress {
  downloadedSize: number;
  totalSize: number;
  speed: number;
  progress: number; // 0-100
}

export type DownloadStatus = "idle" | "downloading" | "completed" | "failed";

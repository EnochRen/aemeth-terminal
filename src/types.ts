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
  /** Launch automatically when Aemeth starts. */
  autoStart: boolean;
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
  startedAt: number;
}

export type AppRuntimeState = "stopped" | "starting" | "running" | "exited";

export const APP_COLORS = [
  "#7c6cf0",
  "#5aa7f0",
  "#43c6c0",
  "#3dd68c",
  "#f5b84c",
  "#f26d6d",
  "#f27fb2",
  "#8a93a6",
] as const;

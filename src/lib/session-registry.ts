import {
  readText as clipReadText,
  writeText as clipWriteText,
} from "@tauri-apps/plugin-clipboard-manager";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

import {
  base64ToBytes,
  listenHealth,
  listenPtyExit,
  listenPtyOutput,
  listenPtyPorts,
  openUrl,
  ptyClose,
  ptyResize,
  ptyStart,
  ptyWrite,
  textEncoder,
} from "@/lib/pty";
import type { AppConfig, SessionStatus } from "@/types";

const XTERM_THEME = {
  background: "#000000",
  foreground: "#ededed",
  cursor: "#ededed",
  cursorAccent: "#000000",
  selectionBackground: "rgba(0, 112, 243, 0.35)",
  selectionInactiveBackground: "rgba(255, 255, 255, 0.15)",
  black: "#171717",
  red: "#e5484d",
  green: "#46a758",
  yellow: "#ffb224",
  blue: "#0072f5",
  magenta: "#d6409f",
  cyan: "#12a594",
  white: "#ededed",
  brightBlack: "#666666",
  brightRed: "#ff6369",
  brightGreen: "#46a758",
  brightYellow: "#ffb224",
  brightBlue: "#0072f5",
  brightMagenta: "#e93d82",
  brightCyan: "#12a594",
  brightWhite: "#ffffff",
};

const FLUSH_INTERVAL_MS = 8;

/**
 * Placeholder sessionId for the optimistic `starting` status emitted before the
 * backend has spawned the PTY. Such a status is only ever handed to UI
 * subscribers; it is never stored in the `clients` map, so sessionId-keyed
 * event handlers cannot resolve it.
 */
const PENDING_SESSION_ID = "";

export class SessionClient {
  readonly app: AppConfig;
  status: SessionStatus;
  readonly term: Terminal;
  readonly fit = new FitAddon();
  readonly search = new SearchAddon();

  private pendingChunks: Uint8Array[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private opened = false;
  private webgl: WebglAddon | null = null;

  constructor(app: AppConfig, status: SessionStatus) {
    this.app = app;
    this.status = status;
    this.term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily:
        '"Geist Mono Variable", "Cascadia Mono", Consolas, "Noto Sans SC Variable", "Microsoft YaHei", monospace',
      fontSize: sessionRegistry.terminalFontSize,
      lineHeight: 1.35,
      letterSpacing: 0,
      scrollback: sessionRegistry.scrollback,
      allowProposedApi: true,
      macOptionIsMeta: true,
      theme: XTERM_THEME,
    });

    this.term.loadAddon(this.fit);
    this.term.loadAddon(this.search);

    const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
    const webLinks = new WebLinksAddon((event, uri) => {
      const modKey = isMac ? event.metaKey : event.ctrlKey;
      if (!modKey) return;
      void openUrl(uri);
    });
    this.term.loadAddon(webLinks);
    const unicode = new Unicode11Addon();
    this.term.loadAddon(unicode);
    this.term.unicode.activeVersion = "11";

    this.term.attachCustomKeyEventHandler((e) => this.handleKey(e));
    this.term.onData((data) => this.queueInput(textEncoder.encode(data)));
    this.term.onBinary((b64) => this.queueInput(base64ToBytes(b64)));
    this.term.onSelectionChange(() => {
      if (!sessionRegistry.copyOnSelect) return;
      const selection = this.term.getSelection();
      if (selection) void clipWriteText(selection).catch(() => {});
    });
  }

  get sessionId(): string {
    return this.status.sessionId;
  }

  private handleKey(e: KeyboardEvent): boolean {
    if (e.type !== "keydown") return true;
    if (!e.ctrlKey || e.altKey || e.metaKey) return true;
    switch (e.key.toLowerCase()) {
      case "c":
        // Copy-only: with a selection it copies, without one it is a no-op.
        // ^C is never forwarded, so Ctrl+C cannot terminate the service.
        this.copySelection();
        return false;
      case "v":
        void this.pasteClipboard();
        return false;
      case "a":
        if (e.shiftKey) {
          this.term.selectAll();
          return false;
        }
        return true;
      case "l":
        this.term.clear();
        return false;
      case "f":
        for (const cb of this.searchListeners) cb();
        return false;
      default:
        return true;
    }
  }

  copySelection(): boolean {
    if (!this.term.hasSelection()) return false;
    const selection = this.term.getSelection();
    if (!selection) return false;
    void clipWriteText(selection).catch(() => {});
    return true;
  }

  async pasteClipboard(): Promise<void> {
    try {
      const text = await clipReadText();
      if (text) this.term.paste(text);
    } catch {
      /* clipboard unavailable */
    }
  }

  pasteSelection(): boolean {
    const selection = this.term.getSelection();
    if (!selection) return false;
    this.term.paste(selection);
    return true;
  }

  clearScreen(): void {
    this.term.clear();
  }

  selectAll(): void {
    this.term.selectAll();
  }

  getBufferText(): string {
    const buffer = this.term.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buffer.length; i++) {
      lines.push(buffer.getLine(i)?.translateToString(true) ?? "");
    }
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    return lines.join("\n");
  }

  private searchListeners = new Set<() => void>();

  onSearchRequest(cb: () => void): () => void {
    this.searchListeners.add(cb);
    return () => {
      this.searchListeners.delete(cb);
    };
  }

  attach(el: HTMLElement): void {
    if (!this.opened) {
      this.term.open(el);
      this.opened = true;
      try {
        this.webgl = new WebglAddon();
        this.webgl.onContextLoss(() => this.webgl?.dispose());
        this.term.loadAddon(this.webgl);
      } catch {
        /* fall back to the canvas renderer */
      }
    } else if (this.term.element && this.term.element.parentElement !== el) {
      el.appendChild(this.term.element);
    }
    this.fitNow();
  }

  fitNow(): void {
    if (!this.opened) return;
    try {
      this.fit.fit();
      void ptyResize(this.sessionId, this.term.cols, this.term.rows).catch(() => {});
    } catch {
      /* container not visible yet */
    }
  }

  focus(): void {
    this.term.focus();
  }

  private queueInput(bytes: Uint8Array): void {
    if (this.status.state !== "running") return;
    this.pendingChunks.push(bytes);
    if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => this.flushInput(), FLUSH_INTERVAL_MS);
    }
  }

  private flushInput(): void {
    this.flushTimer = null;
    if (this.pendingChunks.length === 0) return;
    // Merge queued chunks into one byte array so multi-byte UTF-8 sequences
    // crossing chunk boundaries stay intact.
    const chunks = this.pendingChunks;
    this.pendingChunks = [];
    void ptyWrite(this.sessionId, concatBytes(chunks)).catch(() => {});
  }

  dispose(): void {
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    this.webgl?.dispose();
    this.term.dispose();
  }
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0];
  let total = 0;
  for (const b of chunks) total += b.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const b of chunks) {
    out.set(b, offset);
    offset += b.length;
  }
  return out;
}

export type StatusListener = (appId: string, status: SessionStatus) => void;
export type PortsListener = (appId: string, ports: number[]) => void;
export type HealthListener = (appId: string, healthy: boolean) => void;

class SessionRegistry {
  private clients = new Map<string, SessionClient>(); // sessionId -> client
  private appToSession = new Map<string, string>(); // appId -> sessionId
  private statusListeners = new Set<StatusListener>();
  private portsListeners = new Set<PortsListener>();
  private healthListeners = new Set<HealthListener>();
  private starting = new Set<string>();
  private initialized = false;

  terminalFontSize = 13;
  scrollback = 10_000;
  copyOnSelect = false;

  applyTerminalOptions(opts: { fontSize?: number; scrollback?: number }): void {
    if (opts.fontSize) this.terminalFontSize = opts.fontSize;
    if (opts.scrollback) this.scrollback = opts.scrollback;
    for (const client of this.clients.values()) {
      if (opts.fontSize) client.term.options.fontSize = opts.fontSize;
      if (opts.scrollback) client.term.options.scrollback = opts.scrollback;
      client.fitNow();
    }
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    await listenPtyOutput(({ sessionId, data }) => {
      const client = this.clients.get(sessionId);
      if (!client) return;
      const bytes = base64ToBytes(data);
      client.term.write(bytes);
    });
    await listenPtyExit((status) => {
      const client = this.clients.get(status.sessionId);
      if (client) {
        client.status = status;
        this.emitStatus(status.appId, status);
      }
    });
    await listenPtyPorts(({ sessionId, ports }) => {
      const client = this.clients.get(sessionId);
      if (!client) return;
      client.status = { ...client.status, ports };
      for (const listener of this.portsListeners) listener(client.app.id, ports);
    });
    await listenHealth(({ sessionId, appId, healthy }) => {
      // Try sessionId first (always unique), fall back to appId.
      const client = this.clients.get(sessionId) ?? this.getByApp(appId);
      if (!client) return;
      client.status = { ...client.status, healthy };
      for (const listener of this.healthListeners) listener(appId, healthy);
    });
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onPorts(listener: PortsListener): () => void {
    this.portsListeners.add(listener);
    return () => this.portsListeners.delete(listener);
  }

  onHealth(listener: HealthListener): () => void {
    this.healthListeners.add(listener);
    return () => this.healthListeners.delete(listener);
  }

  private emitStatus(appId: string, status: SessionStatus): void {
    for (const listener of this.statusListeners) listener(appId, status);
  }

  getByApp(appId: string): SessionClient | undefined {
    const sessionId = this.appToSession.get(appId);
    return sessionId ? this.clients.get(sessionId) : undefined;
  }

  async start(app: AppConfig): Promise<SessionClient> {
    const existing = this.getByApp(app.id);
    if (existing && existing.status.state === "running") return existing;
    if (this.starting.has(app.id)) throw new Error("already starting");
    this.starting.add(app.id);
    try {
      // Flip the UI to "starting" before the backend round-trip so the click
      // feels instant. `sessionId` is empty until the backend assigns one —
      // this status is display-only and is never keyed into `clients`, so the
      // sessionId-based event listeners cannot match it.
      this.emitStatus(app.id, {
        sessionId: PENDING_SESSION_ID,
        appId: app.id,
        name: app.name,
        shell: app.shell,
        state: "starting",
        startedAt: Date.now(),
      });

      const status = await ptyStart({
        appId: app.id,
        name: app.name,
        kind: app.kind,
        healthCheckUrl: app.healthCheckUrl,
        shell: app.shell,
        cwd: app.cwd,
        startupDelayMs: app.startupDelayMs,
        commands: app.commands,
        envVars: app.envVars,
      });

      // Reap a stale exited client for this app, if any.
      if (existing) this.remove(app.id);

      const client = new SessionClient(app, status);
      this.clients.set(status.sessionId, client);
      this.appToSession.set(app.id, status.sessionId);
      this.emitStatus(app.id, status);
      return client;
    } finally {
      this.starting.delete(app.id);
    }
  }

  /**
   * Request a kill and return immediately after the optimistic status flip.
   *
   * The returned promise resolves once the kill signal has been delivered to
   * the backend — not once the process is gone. Callers that need the UI to
   * stay responsive must not await it; the final `exited` state arrives via
   * the reaper's `pty://exit` event.
   */
  async stop(appId: string): Promise<void> {
    const client = this.getByApp(appId);
    if (!client || client.status.state !== "running") return;
    client.status = { ...client.status, state: "stopping" };
    this.emitStatus(appId, client.status);
    await ptyClose(client.sessionId).catch(() => {});
  }

  remove(appId: string): void {
    const sessionId = this.appToSession.get(appId);
    if (!sessionId) return;
    this.clients.get(sessionId)?.dispose();
    this.clients.delete(sessionId);
    this.appToSession.delete(appId);
  }

  /**
   * Kill the current session (if any) and spawn a fresh one.
   *
   * The kill is awaited before `remove()` so the reaper still finds the client
   * and the old process tree is gone before a new one binds the same ports.
   */
  async restart(app: AppConfig): Promise<SessionClient> {
    await this.stop(app.id);
    this.remove(app.id);
    return this.start(app);
  }

  get runningCount(): number {
    let n = 0;
    for (const client of this.clients.values()) {
      if (client.status.state === "running") n++;
    }
    return n;
  }
}

export const sessionRegistry = new SessionRegistry();

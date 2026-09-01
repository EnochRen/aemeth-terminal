/**
 * Session registry — owns one xterm.js Terminal per live pty session.
 *
 * Terminals are created the moment a session starts (before any DOM exists),
 * so output is buffered in xterm's scrollback even while the user is still on
 * the Apps view. Tabs simply attach/detach the terminal to a DOM node.
 */
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";

import {
  base64ToBytes,
  listenPtyExit,
  listenPtyOutput,
  ptyClose,
  ptyResize,
  ptyStart,
  ptyWrite,
  textEncoder,
} from "@/lib/pty";
import type { AppConfig, SessionStatus } from "@/types";

/** Geist-flavoured ANSI palette on a pure black canvas. */
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
      fontSize: 13,
      lineHeight: 1.35,
      letterSpacing: 0,
      scrollback: 10_000,
      allowProposedApi: true,
      macOptionIsMeta: true,
      theme: XTERM_THEME,
    });

    this.term.loadAddon(this.fit);
    this.term.loadAddon(this.search);
    const unicode = new Unicode11Addon();
    this.term.loadAddon(unicode);
    this.term.unicode.activeVersion = "11";

    this.term.onData((data) => this.queueInput(textEncoder.encode(data)));
    this.term.onBinary((b64) => this.queueInput(base64ToBytes(b64)));
  }

  get sessionId(): string {
    return this.status.sessionId;
  }

  /** Open the terminal into a DOM node (idempotent). */
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

  /** Fit to the current container and tell the backend the new grid size. */
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

class SessionRegistry {
  private clients = new Map<string, SessionClient>(); // sessionId -> client
  private appToSession = new Map<string, string>(); // appId -> sessionId
  private statusListeners = new Set<StatusListener>();
  private starting = new Set<string>();
  private initialized = false;

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
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private emitStatus(appId: string, status: SessionStatus): void {
    for (const listener of this.statusListeners) listener(appId, status);
  }

  getByApp(appId: string): SessionClient | undefined {
    const sessionId = this.appToSession.get(appId);
    return sessionId ? this.clients.get(sessionId) : undefined;
  }

  /** Launch a pty session for the app and create its terminal. */
  async start(app: AppConfig): Promise<SessionClient> {
    const existing = this.getByApp(app.id);
    if (existing && existing.status.state === "running") return existing;
    if (this.starting.has(app.id)) throw new Error("already starting");
    this.starting.add(app.id);
    try {
      const status = await ptyStart({
        appId: app.id,
        name: app.name,
        shell: app.shell,
        cwd: app.cwd,
        startupDelayMs: app.startupDelayMs,
        commands: app.commands,
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

  /** Ask the backend to kill the session (exit event follows). */
  async stop(appId: string): Promise<void> {
    const client = this.getByApp(appId);
    if (client && client.status.state === "running") {
      await ptyClose(client.sessionId).catch(() => {});
    }
  }

  /** Drop the terminal and all bookkeeping for the app. */
  remove(appId: string): void {
    const sessionId = this.appToSession.get(appId);
    if (!sessionId) return;
    this.clients.get(sessionId)?.dispose();
    this.clients.delete(sessionId);
    this.appToSession.delete(appId);
  }

  /** Restart an exited session (or start a stopped one). */
  async restart(app: AppConfig): Promise<SessionClient> {
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

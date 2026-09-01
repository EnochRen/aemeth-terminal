import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Info, RefreshCw, Search, Square, X } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sparkline } from "@/components/shared/sparkline";
import { fmt } from "@/i18n/locales";
import { useT } from "@/i18n/use-t";
import { processKill, processList } from "@/lib/proc";
import { cn } from "@/lib/utils";
import type { ProcessInfo } from "@/types";

type Field = "all" | "name" | "pid" | "port" | "args";
type SortKey = "name" | "pid" | "memory" | "cpu" | "start";

const POLL_MS = 2000;
const MAX_SAMPLES = 30; // 60 seconds at 2 s intervals

function fmtMem(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtTime(sec: number): string {
  if (!sec) return "—";
  const d = new Date(sec * 1000);
  const now = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  if (d.toDateString() === now.toDateString()) return `${hh}:${mm}:${ss}`;
  const M = String(d.getMonth() + 1).padStart(2, "0");
  const D = String(d.getDate()).padStart(2, "0");
  return `${M}-${D} ${hh}:${mm}`;
}

export function ProcessesView() {
  const t = useT();
  const [procs, setProcs] = useState<ProcessInfo[]>([]);
  const [query, setQuery] = useState("");
  const [field, setField] = useState<Field>("all");
  const [sortKey, setSortKey] = useState<SortKey>("memory");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [detail, setDetail] = useState<ProcessInfo | null>(null);
  const [killTarget, setKillTarget] = useState<ProcessInfo | null>(null);

  // Ring buffers for sparkline data: pid → {cpu[], mem[]}
  const historyRef = useRef<Map<number, { cpu: number[]; mem: number[] }>>(new Map());

  const refresh = useCallback(async () => {
    try {
      const list = await processList();
      setProcs(list);

      // Append new samples to the ring buffer.
      const h = historyRef.current;
      const live = new Set<number>();
      for (const p of list) {
        live.add(p.pid);
        let entry = h.get(p.pid);
        if (!entry) {
          entry = { cpu: [], mem: [] };
          h.set(p.pid, entry);
        }
        if (entry.cpu.length >= MAX_SAMPLES) entry.cpu.shift();
        if (entry.mem.length >= MAX_SAMPLES) entry.mem.shift();
        entry.cpu.push(p.cpu);
        entry.mem.push(p.memory);
      }
      // Drop dead entries.
      for (const pid of h.keys()) {
        if (!live.has(pid)) h.delete(pid);
      }
    } catch {
      /* backend busy */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = procs;
    if (q) {
      list = procs.filter((p) => {
        switch (field) {
          case "name":
            return p.name.toLowerCase().includes(q);
          case "pid":
            return String(p.pid).includes(q);
          case "port":
            return p.ports.some((port) => String(port).startsWith(q));
          case "args":
            return p.cmd.toLowerCase().includes(q);
          default:
            return (
              p.name.toLowerCase().includes(q) ||
              p.cmd.toLowerCase().includes(q) ||
              String(p.pid).includes(q) ||
              p.ports.some((port) => String(port).includes(q))
            );
        }
      });
    }
    const dir = sortDir;
    return [...list].sort((a, b) => {
      switch (sortKey) {
        case "name":
          return a.name.localeCompare(b.name) * dir;
        case "pid":
          return (a.pid - b.pid) * dir;
        case "cpu":
          return (a.cpu - b.cpu) * dir;
        case "start":
          return (a.startTime - b.startTime) * dir;
        default:
          return (a.memory - b.memory) * dir;
      }
    });
  }, [procs, query, field, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? 1 : -1);
    }
  };

  const confirmKill = async () => {
    if (!killTarget) return;
    const target = killTarget;
    setKillTarget(null);
    try {
      const n = await processKill(target.pid);
      toast.success(fmt(t.proc.killed, { n }));
      void refresh();
    } catch (err) {
      toast.error(t.proc.killFailed, {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header toolbar */}
      <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border px-5">
        <h1 className="text-[13.5px] font-semibold tracking-tight">{t.proc.title}</h1>
        <span className="font-mono text-[11px] text-[#666]">
          {fmt(t.proc.count, { n: procs.length })}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[#525252]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.proc.searchPlaceholder}
              className="h-7 w-64 rounded-md border border-border bg-transparent pl-7 pr-7 font-mono text-xs text-foreground outline-none transition-colors placeholder:text-[#525252] focus:border-[#3f3f3f]"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#666] hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          <Select value={field} onValueChange={(v) => setField(v as Field)}>
            <SelectTrigger className="h-7 w-24 font-mono text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.proc.fieldAll}</SelectItem>
              <SelectItem value="name">{t.proc.fieldName}</SelectItem>
              <SelectItem value="pid">{t.proc.fieldPid}</SelectItem>
              <SelectItem value="port">{t.proc.fieldPort}</SelectItem>
              <SelectItem value="args">{t.proc.fieldArgs}</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-[#a1a1a1]"
            onClick={() => void refresh()}
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
      </header>

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse font-mono text-[11.5px]">
          <thead className="sticky top-0 z-10 bg-background">
            <tr className="border-b border-border text-left text-[10.5px] text-[#666]">
              <Th label={t.proc.colName} active={sortKey === "name"} dir={sortDir} onClick={() => toggleSort("name")} align="left" pad="pl-5" />
              <Th label={t.proc.colPid} active={sortKey === "pid"} dir={sortDir} onClick={() => toggleSort("pid")} align="right" />
              <Th label={t.proc.colPorts} active={false} dir={1} onClick={() => {}} align="left" />
              <Th label={t.proc.colParent} active={false} dir={1} onClick={() => {}} align="right" />
              <Th label={t.proc.colMem} active={sortKey === "memory"} dir={sortDir} onClick={() => toggleSort("memory")} align="right" />
              <Th label={t.proc.colCpu} active={sortKey === "cpu"} dir={sortDir} onClick={() => toggleSort("cpu")} align="right" />
              <Th label={t.proc.colStart} active={sortKey === "start"} dir={sortDir} onClick={() => toggleSort("start")} align="right" />
              <th className="px-5 py-2 text-right font-medium">{t.proc.colActions}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr
                key={p.pid}
                className="border-b border-border/50 transition-colors hover:bg-accent/40"
              >
                <td className="max-w-0 truncate px-5 py-1.5 text-foreground" style={{ width: "26%" }}>
                  {p.name}
                </td>
                <td className="px-2 py-1.5 text-right text-[#a1a1a1]">{p.pid}</td>
                <td className="px-2 py-1.5">
                  {p.ports.length > 0 ? (
                    <span className="text-state-running">
                      {p.ports.map((x) => `:${x}`).join(" ")}
                    </span>
                  ) : (
                    <span className="text-[#3f3f3f]">—</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right text-[#666]">{p.ppid ?? "—"}</td>
                <td className="px-2 py-1.5 text-right text-[#a1a1a1]">{fmtMem(p.memory)}</td>
                <td className="px-2 py-1.5 text-right text-[#a1a1a1]">{p.cpu.toFixed(0)}%</td>
                <td className="px-2 py-1.5 text-right text-[#666]">{fmtTime(p.startTime)}</td>
                <td className="px-5 py-1.5">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 text-[#a1a1a1]"
                      title={t.proc.details}
                      onClick={() => setDetail(p)}
                    >
                      <Info className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 text-[#a1a1a1] hover:text-destructive"
                      title={t.proc.kill}
                      onClick={() => setKillTarget(p)}
                    >
                      <Square className="size-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-10 text-center text-[#525252]">
                  {t.proc.empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Details dialog */}
      <Dialog open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">
              {detail?.name} · {detail?.pid}
            </DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-2 font-mono text-[11.5px]">
              <Row label={t.proc.exe}>{detail.exe ?? "—"}</Row>
              <Row label={t.proc.cmdline}>{detail.cmd || "—"}</Row>
              <Row label={t.proc.parent}>{detail.ppid ?? "—"}</Row>
              <Row label={t.proc.ports}>
                {detail.ports.length > 0
                  ? detail.ports.map((x) => `:${x}`).join(" ")
                  : "—"}
              </Row>
              <Row label={t.proc.memory}>
                {fmtMem(detail.memory)}
                <Sparkline
                  data={historyRef.current.get(detail.pid)?.mem ?? []}
                  stroke="#30a46c"
                  fill="rgba(48,164,108,0.15)"
                  className="ml-3 inline-block align-middle"
                />
              </Row>
              <Row label={t.proc.cpu}>
                {detail.cpu.toFixed(1)}%
                <Sparkline
                  data={historyRef.current.get(detail.pid)?.cpu ?? []}
                  stroke="#ffb224"
                  fill="rgba(255,178,36,0.15)"
                  className="ml-3 inline-block align-middle"
                />
              </Row>
              <Row label={t.proc.started}>{fmtTime(detail.startTime)}</Row>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Kill confirm */}
      <AlertDialog open={killTarget !== null} onOpenChange={(o) => !o && setKillTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {killTarget ? fmt(t.proc.killTitle, { name: killTarget.name }) : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {killTarget ? fmt(t.proc.killDesc, { pid: killTarget.pid }) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.proc.cancel}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmKill()}>
              {t.proc.kill}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Th({
  label,
  active,
  dir,
  onClick,
  align,
  pad,
}: {
  label: string;
  active: boolean;
  dir: 1 | -1;
  onClick: () => void;
  align: "left" | "right";
  pad?: string;
}) {
  return (
    <th
      className={cn(
        "cursor-pointer px-2 py-2 font-medium transition-colors hover:text-foreground",
        align === "right" ? "text-right" : "text-left",
        active && "text-foreground",
        pad,
      )}
      onClick={onClick}
    >
      {label}
      {active ? (dir === 1 ? " ↑" : " ↓") : ""}
    </th>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="w-24 shrink-0 text-[#666]">{label}</span>
      <span className="min-w-0 break-all text-[#a1a1a1]">{children}</span>
    </div>
  );
}

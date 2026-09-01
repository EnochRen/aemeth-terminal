import { useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FileUp, FolderOpen, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { readTextFile } from "@/lib/save-file";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/use-t";
import { useAppStore } from "@/store/use-app-store";
import { APP_COLORS, type AppConfig, type PresetCommand, type ShellKind } from "@/types";

const DEFAULT_COMMAND_DELAY = 400;

function parseTags(input: string): string[] | undefined {
  const tags = input
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return tags.length > 0 ? [...new Set(tags)] : undefined;
}

function parseEnvFile(raw: string): [string, string][] {
  const pairs: [string, string][] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    pairs.push([trimmed.slice(0, idx).trim(), trimmed.slice(idx + 1).trim()]);
  }
  return pairs;
}

function buildEnvVars(
  entries: { key: string; value: string }[],
): Record<string, string> | undefined {
  const cleaned: Record<string, string> = {};
  for (const { key, value } of entries) {
    if (key.trim()) cleaned[key.trim()] = value;
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

export function AppDialog() {
  const t = useT();
  const open = useAppStore((s) => s.editorOpen);
  const editing = useAppStore((s) => s.editorApp);
  const isClone = useAppStore((s) => s.editorClone);
  const closeEditor = useAppStore((s) => s.closeEditor);
  const saveApp = useAppStore((s) => s.saveApp);
  const shells = useAppStore((s) => s.shells);
  const apps = useAppStore((s) => s.apps);
  const defaultShell = useAppStore((s) => s.defaultShell);

  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(APP_COLORS[0]);
  const [shell, setShell] = useState<ShellKind>("powershell");
  const [cwd, setCwd] = useState("");
  const [startupDelayMs, setStartupDelayMs] = useState(600);
  const [commands, setCommands] = useState<PresetCommand[]>([]);
  const [autoStart, setAutoStart] = useState(false);
  const [envEntries, setEnvEntries] = useState<{ key: string; value: string }[]>([]);
  const [kind, setKind] = useState<AppConfig["kind"]>("service");
  const [healthCheckUrl, setHealthCheckUrl] = useState("");
  const [tags, setTags] = useState("");

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setColor(editing.color);
      setKind(editing.kind ?? "service");
      setHealthCheckUrl(editing.healthCheckUrl ?? "");
      setTags((editing.tags ?? []).join(", "));
      setShell(editing.shell);
      setCwd(editing.cwd ?? "");
      setStartupDelayMs(editing.startupDelayMs);
      setCommands(editing.commands.map((c) => ({ ...c })));
      setAutoStart(editing.autoStart);
      setEnvEntries(
        editing.envVars
          ? Object.entries(editing.envVars).map(([k, v]) => ({ key: k, value: v }))
          : [],
      );
    } else {
      setName("");
      setColor(APP_COLORS[apps.length % APP_COLORS.length]);
      setKind("service");
      setHealthCheckUrl("");
      setTags("");
      setShell(defaultShell());
      setCwd("");
      setStartupDelayMs(600);
      setCommands([]);
      setAutoStart(false);
      setEnvEntries([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const availableShells = useMemo(() => shells.filter((s) => s.available), [shells]);
  const valid = name.trim().length > 0;

  const pickDirectory = async () => {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      title: t.dialog.pickDir,
      defaultPath: cwd || undefined,
    });
    if (typeof picked === "string") setCwd(picked);
  };

  const updateCommand = (index: number, patch: Partial<PresetCommand>) => {
    setCommands((cs) => cs.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  };

  const importEnvFile = async () => {
    const picked = await openDialog({
      multiple: false,
      title: t.dialog.importEnv,
      filters: [{ name: "Env file", extensions: ["env", "txt"] }],
    });
    if (typeof picked !== "string") return;
    try {
      const content = await readTextFile(picked);
      const parsed = parseEnvFile(content);
      const existing = new Map(envEntries.map((e) => [e.key, e.value]));
      for (const [k, v] of parsed) existing.set(k, v);
      setEnvEntries([...existing.entries()].map(([key, value]) => ({ key, value })));
    } catch {
      /* file read error */
    }
  };

  const handleSave = async () => {
    if (!valid) return;
    const envVars = buildEnvVars(envEntries);
    const now = Date.now();
    const app: AppConfig = editing && !isClone
      ? {
          ...editing,
          name: name.trim(),
          kind,
          healthCheckUrl: healthCheckUrl.trim() || undefined,
          tags: parseTags(tags),
          color,
          shell,
          cwd: cwd.trim() || null,
          startupDelayMs,
          commands: commands.filter((c) => c.command.trim().length > 0),
          autoStart,
          envVars,
          updatedAt: now,
        }
      : {
          id: crypto.randomUUID(),
          name: name.trim(),
          kind,
          healthCheckUrl: healthCheckUrl.trim() || undefined,
          tags: parseTags(tags),
          color,
          shell,
          cwd: cwd.trim() || null,
          startupDelayMs,
          commands: commands.filter((c) => c.command.trim().length > 0),
          autoStart,
          envVars,
          sortOrder: apps.length,
          createdAt: now,
          updatedAt: now,
        };
    await saveApp(app);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeEditor()}>
      <DialogContent className="gap-5 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isClone ? t.dialog.titleClone : editing ? t.dialog.titleEdit : t.dialog.titleNew}</DialogTitle>
          <DialogDescription>{t.dialog.desc}</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="general" className="flex flex-col">
          <TabsList variant="line" className="mb-4">
            <TabsTrigger value="general">{t.dialog.tabGeneral}</TabsTrigger>
            <TabsTrigger value="runtime">{t.dialog.tabRuntime}</TabsTrigger>
            <TabsTrigger value="env">{t.dialog.tabEnv}</TabsTrigger>
          </TabsList>

          <div className="max-h-[55vh] overflow-y-auto pr-1">
            {/* ──────────── General ──────────── */}
            <TabsContent value="general" className="mt-0 space-y-5">
              <div className="grid gap-2">
                <Label htmlFor="app-name">{t.dialog.name}</Label>
                <div className="flex items-center gap-3">
                  <Input
                    id="app-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t.dialog.namePlaceholder}
                    className="flex-1"
                    autoFocus
                  />
                  <Select value={kind} onValueChange={(v) => setKind(v as AppConfig["kind"])}>
                    <SelectTrigger className="h-10 w-28 font-mono text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="service">{t.dialog.kindService}</SelectItem>
                      <SelectItem value="script">{t.dialog.kindScript}</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-1.5">
                    {APP_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setColor(c)}
                        className={cn(
                          "size-5 rounded-full transition-transform hover:scale-110",
                          color === c && "ring-2 ring-foreground/70 ring-offset-2 ring-offset-popover",
                        )}
                        style={{ backgroundColor: c }}
                        aria-label={`${t.dialog.color} ${c}`}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid gap-2">
                <Label>{t.dialog.shell}</Label>
                <div className="max-w-60">
                  <Select value={shell} onValueChange={(v) => setShell(v as ShellKind)}>
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {availableShells.find((s) => s.kind === shell)?.label ?? shell}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {availableShells.map((s) => (
                        <SelectItem key={s.kind} value={s.kind}>
                          <span className="flex items-baseline gap-2">
                            {s.label}
                            {s.path && (
                              <span className="max-w-64 truncate text-[10px] text-muted-foreground">
                                {s.path}
                              </span>
                            )}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="app-cwd">{t.dialog.cwd}</Label>
                <div className="flex gap-1.5">
                  <Input
                    id="app-cwd"
                    value={cwd}
                    onChange={(e) => setCwd(e.target.value)}
                    placeholder={t.dialog.cwdPlaceholder}
                    className="flex-1 font-mono text-xs"
                  />
                  <Button variant="secondary" size="icon" onClick={() => void pickDirectory()}>
                    <FolderOpen className="size-4" />
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border/60 px-3.5 py-3">
                <div>
                  <Label className="text-sm">{t.dialog.autoStart}</Label>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {t.dialog.autoStartHint}
                  </p>
                </div>
                <Switch checked={autoStart} onCheckedChange={setAutoStart} />
              </div>
            </TabsContent>

            {/* ──────────── Runtime ──────────── */}
            <TabsContent value="runtime" className="mt-0 space-y-5">
              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Label>{t.dialog.commands}</Label>
                  <span className="text-[11px] text-muted-foreground">
                    {t.dialog.commandsHint}
                  </span>
                </div>
                <div className="space-y-2">
                  {commands.map((c, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-5 text-right font-mono text-xs text-[#525252]">
                        {i + 1}.
                      </span>
                      <Input
                        value={c.command}
                        onChange={(e) => updateCommand(i, { command: e.target.value })}
                        placeholder={i === 0 ? t.dialog.cmdPlaceholder1 : t.dialog.cmdPlaceholder2}
                        className="flex-1 font-mono text-xs"
                      />
                      <div className="relative w-28">
                        <Input
                          type="number"
                          min={0}
                          step={100}
                          value={c.delayMs}
                          onChange={(e) => updateCommand(i, { delayMs: Number(e.target.value) || 0 })}
                          className="pr-8 text-xs"
                        />
                        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                          ms
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setCommands((cs) => cs.filter((_, x) => x !== i))}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full border-dashed text-muted-foreground"
                    onClick={() =>
                      setCommands((cs) => [...cs, { command: "", delayMs: DEFAULT_COMMAND_DELAY }])
                    }
                  >
                    <Plus className="size-3.5" /> {t.dialog.addCommand}
                  </Button>
                </div>
              </div>

              <div className="grid gap-2.5">
                <div className="flex items-center justify-between">
                  <Label>{t.dialog.delay}</Label>
                  <span className="font-mono text-xs text-muted-foreground">{startupDelayMs} ms</span>
                </div>
                <Slider
                  value={[startupDelayMs]}
                  min={0}
                  max={5000}
                  step={100}
                  onValueChange={(v) => setStartupDelayMs(v[0])}
                />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {t.dialog.delayHint}
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="app-health">{t.dialog.healthCheckUrl}</Label>
                <Input
                  id="app-health"
                  value={healthCheckUrl}
                  onChange={(e) => setHealthCheckUrl(e.target.value)}
                  placeholder="http://localhost:5173"
                  className="font-mono text-xs"
                />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {t.dialog.healthCheckUrlHint}
                </p>
              </div>
            </TabsContent>

            {/* ──────────── Environment ──────────── */}
            <TabsContent value="env" className="mt-0 space-y-5">
              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Label>{t.dialog.envVars}</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 text-[10px] text-[#a1a1a1]"
                    onClick={() => void importEnvFile()}
                  >
                    <FileUp className="size-3" /> {t.dialog.importEnv}
                  </Button>
                </div>
                {envEntries.length > 0 && (
                  <div className="mb-1 space-y-1.5">
                    {envEntries.map((e, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <Input
                          value={e.key}
                          onChange={(ev) =>
                            setEnvEntries((es) =>
                              es.map((x, xi) => (xi === i ? { ...x, key: ev.target.value } : x)),
                            )
                          }
                          placeholder={t.dialog.envKey}
                          className="h-7 w-40 font-mono text-[11px]"
                        />
                        <span className="text-[#3f3f3f]">=</span>
                        <Input
                          value={e.value}
                          onChange={(ev) =>
                            setEnvEntries((es) =>
                              es.map((x, xi) => (xi === i ? { ...x, value: ev.target.value } : x)),
                            )
                          }
                          placeholder={t.dialog.envValue}
                          className="h-7 flex-1 font-mono text-[11px]"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => setEnvEntries((es) => es.filter((_, xi) => xi !== i))}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full border-dashed text-muted-foreground"
                  onClick={() => setEnvEntries((es) => [...es, { key: "", value: "" }])}
                >
                  <Plus className="size-3.5" /> {t.dialog.addEnv}
                </Button>
              </div>

              <Separator />

              <div className="grid gap-2">
                <Label htmlFor="app-tags">{t.dialog.tags}</Label>
                <Input
                  id="app-tags"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="qa, live"
                  className="font-mono text-xs"
                />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {t.dialog.tagsHint}
                </p>
              </div>
            </TabsContent>
          </div>
        </Tabs>

        <DialogFooter>
          <Button variant="ghost" onClick={closeEditor}>
            {t.dialog.cancel}
          </Button>
          <Button disabled={!valid} onClick={() => void handleSave()}>
            {editing ? t.dialog.save : t.dialog.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
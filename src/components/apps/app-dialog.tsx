import { useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Plus, Trash2 } from "lucide-react";

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
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/use-t";
import { useAppStore } from "@/store/use-app-store";
import { APP_COLORS, type AppConfig, type PresetCommand, type ShellKind } from "@/types";

const DEFAULT_COMMAND_DELAY = 400;

export function AppDialog() {
  const t = useT();
  const open = useAppStore((s) => s.editorOpen);
  const editing = useAppStore((s) => s.editorApp);
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

  // Initialize form whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setColor(editing.color);
      setShell(editing.shell);
      setCwd(editing.cwd ?? "");
      setStartupDelayMs(editing.startupDelayMs);
      setCommands(editing.commands.map((c) => ({ ...c })));
      setAutoStart(editing.autoStart);
    } else {
      setName("");
      setColor(APP_COLORS[apps.length % APP_COLORS.length]);
      setShell(defaultShell());
      setCwd("");
      setStartupDelayMs(600);
      setCommands([]);
      setAutoStart(false);
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

  const handleSave = async () => {
    if (!valid) return;
    const now = Date.now();
    const app: AppConfig = editing
      ? {
          ...editing,
          name: name.trim(),
          color,
          shell,
          cwd: cwd.trim() || null,
          startupDelayMs,
          commands: commands.filter((c) => c.command.trim().length > 0),
          autoStart,
          updatedAt: now,
        }
      : {
          id: crypto.randomUUID(),
          name: name.trim(),
          color,
          shell,
          cwd: cwd.trim() || null,
          startupDelayMs,
          commands: commands.filter((c) => c.command.trim().length > 0),
          autoStart,
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
          <DialogTitle>{editing ? t.dialog.titleEdit : t.dialog.titleNew}</DialogTitle>
          <DialogDescription>{t.dialog.desc}</DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[70vh] gap-5 overflow-y-auto pr-1">
          {/* Name + color */}
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

          {/* Shell + cwd */}
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>{t.dialog.shell}</Label>
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
          </div>

          <Separator />

          {/* Preset commands */}
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

          {/* Startup delay */}
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

          {/* Auto start */}
          <div className="flex items-center justify-between rounded-lg border border-border/60 px-3.5 py-3">
            <div>
              <Label className="text-sm">{t.dialog.autoStart}</Label>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {t.dialog.autoStartHint}
              </p>
            </div>
            <Switch checked={autoStart} onCheckedChange={setAutoStart} />
          </div>
        </div>

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

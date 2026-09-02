import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { LOCALES, type Locale } from "@/i18n/locales";
import { useT } from "@/i18n/use-t";
import { useAppStore } from "@/store/use-app-store";
import { version as appVersion } from "@/../package.json";
import type { ShellKind } from "@/types";
import { Button } from "@/components/ui/button";
import { FolderOpen } from "lucide-react";
import { openDataDir, openLogsDir } from "@/lib/pty";
import { toast } from "sonner";

const SCROLLBACK_OPTIONS = [1_000, 5_000, 10_000, 20_000];

export function SettingsView() {
  const t = useT();
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const locale = useAppStore((s) => s.locale);
  const setLocale = useAppStore((s) => s.setLocale);
  const shells = useAppStore((s) => s.shells);

  const availableShells = shells.filter((s) => s.available);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border px-5">
        <h1 className="text-[13.5px] font-semibold tracking-tight">{t.settings.title}</h1>
        <span className="font-mono text-[11px] text-[#666]">{t.settings.desc}</span>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-xl gap-9 px-5 py-7">
          {/* ---------------- General ---------------- */}
          <section className="grid gap-4">
            <p className="label-micro">{t.settings.general}</p>
            <div className="divide-y divide-border border-y border-border">
              <Row label={t.settings.language}>
                <Select value={locale} onValueChange={(v) => void setLocale(v as Locale)}>
                  <SelectTrigger className="w-40">
                    <SelectValue>{LOCALES.find((l) => l.value === locale)?.label}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {LOCALES.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>

              <Row label={t.settings.defaultShell}>
                <Select
                  value={settings.defaultShell}
                  onValueChange={(v) =>
                    void setSettings({ defaultShell: v as ShellKind | "auto" })
                  }
                >
                  <SelectTrigger className="w-40">
                    <SelectValue>
                      {settings.defaultShell === "auto"
                        ? t.settings.defaultShellAuto
                        : availableShells.find((s) => s.kind === settings.defaultShell)?.label ??
                          settings.defaultShell}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">{t.settings.defaultShellAuto}</SelectItem>
                    {availableShells.map((s) => (
                      <SelectItem key={s.kind} value={s.kind}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>

              <Row label={t.settings.confirmClose} hint={t.settings.confirmCloseHint}>
                <Switch
                  checked={settings.confirmClose}
                  onCheckedChange={(v) => void setSettings({ confirmClose: v })}
                />
              </Row>
            </div>
          </section>

          {/* ---------------- Files ---------------- */}
          <section className="grid gap-4">
            <p className="label-micro">{t.settings.files}</p>
            <div className="divide-y divide-border border-y border-border">
              <Row label={t.settings.dataFolder} hint={t.settings.dataFolderHint}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void openDataDir().catch((error) => {
                      toast.error(t.toasts.openFolderFailed, {
                        description: error instanceof Error ? error.message : String(error),
                      });
                    })
                  }
                >
                  <FolderOpen />
                  {t.settings.openFolder}
                </Button>
              </Row>
              <Row label={t.settings.logsFolder} hint={t.settings.logsFolderHint}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void openLogsDir().catch((error) => {
                      toast.error(t.toasts.openFolderFailed, {
                        description: error instanceof Error ? error.message : String(error),
                      });
                    })
                  }
                >
                  <FolderOpen />
                  {t.settings.openFolder}
                </Button>
              </Row>
            </div>
          </section>

          {/* ---------------- Terminal ---------------- */}
          <section className="grid gap-4">
            <p className="label-micro">{t.settings.terminal}</p>
            <div className="divide-y divide-border border-y border-border">
              <Row label={t.settings.fontSize}>
                <div className="flex w-44 items-center gap-3">
                  <Slider
                    value={[settings.terminalFontSize]}
                    min={11}
                    max={20}
                    step={1}
                    onValueChange={(v) => void setSettings({ terminalFontSize: v[0] })}
                  />
                  <span className="w-9 shrink-0 text-right font-mono text-xs text-[#a1a1a1]">
                    {settings.terminalFontSize}
                  </span>
                </div>
              </Row>

              <Row label={t.settings.scrollback}>
                <Select
                  value={String(settings.scrollback)}
                  onValueChange={(v) => void setSettings({ scrollback: Number(v) })}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SCROLLBACK_OPTIONS.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        <span className="font-mono text-xs">{n.toLocaleString()}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>

              <Row label={t.settings.copyOnSelect} hint={t.settings.copyOnSelectHint}>
                <Switch
                  checked={settings.copyOnSelect}
                  onCheckedChange={(v) => void setSettings({ copyOnSelect: v })}
                />
              </Row>
            </div>
          </section>

          {/* ---------------- Updates ---------------- */}
          <section className="grid gap-4">
            <p className="label-micro">Updates</p>
            <div className="divide-y divide-border border-y border-border">
              <Row label={t.settings.autoUpdate} hint={t.settings.autoUpdateHint}>
                <Switch
                  checked={settings.autoUpdate}
                  onCheckedChange={(v) => void setSettings({ autoUpdate: v })}
                />
              </Row>
              <Row label="Version">
                <span className="font-mono text-xs text-[#a1a1a1]">{appVersion}</span>
              </Row>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-3.5">
      <div className="min-w-0">
        <Label className="text-[13px] font-medium">{label}</Label>
        {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

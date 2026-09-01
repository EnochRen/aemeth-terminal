import { AppCard } from "@/components/apps/app-card";
import { fmt } from "@/i18n/locales";
import { useT } from "@/i18n/use-t";
import { useAppStore } from "@/store/use-app-store";

export function AppsView() {
  const t = useT();
  const apps = useAppStore((s) => s.apps);
  const sessions = useAppStore((s) => s.sessions);

  const running = Object.values(sessions).filter((s) => s.state === "running").length;

  return (
    <div className="flex h-full flex-col">
      {/* Header — vercel-style toolbar */}
      <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border px-5">
        <h1 className="text-[13.5px] font-semibold tracking-tight">{t.apps.title}</h1>
        <span className="font-mono text-[11px] text-[#666]">
          {fmt(t.apps.count, { apps: apps.length, running })}
        </span>
      </header>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-5">
        {apps.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(340px,1fr))]">
            {apps.map((app) => (
              <AppCard key={app.id} app={app} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  const t = useT();
  const openEditor = useAppStore((s) => s.openEditor);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
      <div className="flex size-9 items-center justify-center rounded-md border border-[#333] font-mono text-sm text-foreground">
        Æ
      </div>
      <div className="space-y-1.5">
        <p className="label-micro">{t.apps.emptyLabel}</p>
        <p className="mx-auto max-w-sm text-[12.5px] leading-relaxed text-[#a1a1a1]">
          {t.apps.emptyDesc}
        </p>
      </div>
      <button
        type="button"
        onClick={() => openEditor(null)}
        className="font-mono text-[11px] text-[#a1a1a1] underline decoration-[#333] underline-offset-4 transition-colors hover:text-foreground"
      >
        {t.apps.createFirst} →
      </button>
    </div>
  );
}

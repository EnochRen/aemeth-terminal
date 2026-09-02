import { Loader2 } from "lucide-react";
import { useT } from "@/i18n/use-t";
import { cn } from "@/lib/utils";
import type { SessionStatus } from "@/types";

interface StatusPillProps {
  session: SessionStatus | null;
  className?: string;
}

export function StatusPill({ session, className }: StatusPillProps) {
  const t = useT();
  if (!session) {
    return (
      <span className={cn("inline-flex items-center gap-2 font-mono text-xs text-state-idle", className)}>
        <span className="size-1.5 rounded-full bg-state-idle" />
        {t.status.idle}
      </span>
    );
  }
  if (session.state === "running") {
    return (
      <span className={cn("inline-flex items-center gap-2 font-mono text-xs text-muted-foreground", className)}>
        <span className="size-1.5 rounded-full bg-state-running" />
        {t.status.running}
      </span>
    );
  }
  if (session.state === "starting" || session.state === "stopping") {
    return (
      <span className={cn("inline-flex items-center gap-1.5 font-mono text-xs text-state-warn", className)}>
        <Loader2 className="size-3 animate-spin" />
        {session.state === "starting" ? t.status.starting : t.status.stopping}
      </span>
    );
  }
  const failed = session.exitCode !== 0 && session.exitCode !== undefined;
  return (
    <span className={cn("inline-flex items-center gap-2 font-mono text-xs text-muted-foreground", className)}>
      <span className={cn("size-1.5 rounded-full", failed ? "bg-state-error" : "bg-state-idle")} />
      {t.status.exited}
      {session.exitCode !== undefined ? ` · ${session.exitCode}` : ""}
    </span>
  );
}

export function StatusDot({ session, className }: StatusPillProps) {
  if (!session) return <span className={cn("size-1.5 rounded-full bg-state-idle", className)} />;
  if (session.state === "running") {
    return <span className={cn("size-1.5 rounded-full bg-state-running", className)} />;
  }
  if (session.state === "starting" || session.state === "stopping") {
    return <Loader2 className={cn("size-3 animate-spin text-state-warn", className)} />;
  }
  const failed = session.exitCode !== 0 && session.exitCode !== undefined;
  return (
    <span className={cn("size-1.5 rounded-full", failed ? "bg-state-error" : "bg-state-idle", className)} />
  );
}
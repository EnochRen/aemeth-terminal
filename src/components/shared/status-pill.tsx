import { cn } from "@/lib/utils";
import type { SessionStatus } from "@/types";

interface StatusPillProps {
  session: SessionStatus | null;
  className?: string;
}

/** Monospace status readout — color carried only by the dot. */
export function StatusPill({ session, className }: StatusPillProps) {
  if (!session) {
    return (
      <span className={cn("inline-flex items-center gap-2 font-mono text-xs text-state-idle", className)}>
        <span className="size-1.5 rounded-full bg-state-idle" />
        idle
      </span>
    );
  }
  if (session.state === "running") {
    return (
      <span className={cn("inline-flex items-center gap-2 font-mono text-xs text-muted-foreground", className)}>
        <span className="size-1.5 rounded-full bg-state-running" />
        running
      </span>
    );
  }
  const failed = session.exitCode !== 0 && session.exitCode !== undefined;
  return (
    <span className={cn("inline-flex items-center gap-2 font-mono text-xs text-muted-foreground", className)}>
      <span className={cn("size-1.5 rounded-full", failed ? "bg-state-error" : "bg-state-idle")} />
      exited{session.exitCode !== undefined ? ` · ${session.exitCode}` : ""}
    </span>
  );
}

/** 6px dot used inside terminal tabs. */
export function StatusDot({ session, className }: StatusPillProps) {
  if (!session) return <span className={cn("size-1.5 rounded-full bg-state-idle", className)} />;
  if (session.state === "running") {
    return <span className={cn("size-1.5 rounded-full bg-state-running", className)} />;
  }
  const failed = session.exitCode !== 0 && session.exitCode !== undefined;
  return (
    <span className={cn("size-1.5 rounded-full", failed ? "bg-state-error" : "bg-state-idle", className)} />
  );
}

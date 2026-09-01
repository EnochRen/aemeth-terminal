import { cn } from "@/lib/utils";
import type { SessionStatus } from "@/types";

interface StatusPillProps {
  session: SessionStatus | null;
  className?: string;
}

/** Colored dot + label describing an app's runtime state. */
export function StatusPill({ session, className }: StatusPillProps) {
  if (!session) {
    return (
      <span className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
        <span className="size-1.5 rounded-full bg-border" />
        未运行
      </span>
    );
  }
  if (session.state === "running") {
    return (
      <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium text-[#3dd68c]", className)}>
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#3dd68c] opacity-60" />
          <span className="relative inline-flex size-1.5 rounded-full bg-[#3dd68c]" />
        </span>
        运行中
      </span>
    );
  }
  const failed = session.exitCode !== 0 && session.exitCode !== undefined;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs",
        failed ? "text-[#f26d6d]" : "text-muted-foreground",
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", failed ? "bg-[#f26d6d]" : "bg-muted-foreground/60")} />
      已退出{session.exitCode !== undefined ? ` · ${session.exitCode}` : ""}
    </span>
  );
}

/** Small dot used inside terminal tabs. */
export function StatusDot({ session, className }: StatusPillProps) {
  if (!session) return <span className={cn("size-2 rounded-full bg-border", className)} />;
  if (session.state === "running") {
    return (
      <span className={cn("relative flex size-2", className)}>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#3dd68c] opacity-50" />
        <span className="relative inline-flex size-2 rounded-full bg-[#3dd68c]" />
      </span>
    );
  }
  const failed = session.exitCode !== 0 && session.exitCode !== undefined;
  return (
    <span className={cn("size-2 rounded-full", failed ? "bg-[#f26d6d]" : "bg-muted-foreground/50", className)} />
  );
}

import { cn } from "@/lib/utils";
import type { ShellKind } from "@/types";

const SHELL_LABEL: Record<ShellKind, string> = {
  powershell: "powershell",
  pwsh: "pwsh",
  cmd: "cmd",
  bash: "bash",
  zsh: "zsh",
  sh: "sh",
};

export function ShellBadge({ kind, className }: { kind: ShellKind; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[4px] border border-border bg-transparent px-1.5 py-px font-mono text-[10.5px] leading-[1.5] text-muted-foreground",
        className,
      )}
    >
      {SHELL_LABEL[kind]}
    </span>
  );
}

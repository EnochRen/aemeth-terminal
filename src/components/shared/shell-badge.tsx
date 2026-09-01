import { cn } from "@/lib/utils";
import type { ShellKind } from "@/types";

const SHELL_META: Record<ShellKind, { label: string; className: string }> = {
  powershell: { label: "PowerShell", className: "bg-[#2b5797]/25 text-[#7db2f0] border-[#2b5797]/40" },
  pwsh: { label: "PowerShell 7", className: "bg-[#2671be]/25 text-[#8cc4ff] border-[#2671be]/40" },
  cmd: { label: "CMD", className: "bg-[#5a6478]/25 text-[#aab4c8] border-[#5a6478]/40" },
  bash: { label: "Bash", className: "bg-[#8a6d1f]/25 text-[#f0c660] border-[#8a6d1f]/40" },
  zsh: { label: "Zsh", className: "bg-[#6d4a8f]/25 text-[#c39be8] border-[#6d4a8f]/40" },
  sh: { label: "sh", className: "bg-[#3e5c56]/25 text-[#8fd0c3] border-[#3e5c56]/40" },
};

export function ShellBadge({ kind, className }: { kind: ShellKind; className?: string }) {
  const meta = SHELL_META[kind];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-medium leading-none tracking-wide",
        meta.className,
        className,
      )}
    >
      {meta.label}
    </span>
  );
}

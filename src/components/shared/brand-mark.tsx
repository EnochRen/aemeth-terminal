import { cn } from "@/lib/utils";

/**
 * Brand mark: hairline-bordered rounded box holding the swiss-army-knife
 * glyph — white handle bar with the pink blade unfolded (the app icon mark).
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[5px] border border-[#333]",
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 64 64" className="size-[70%] pointer-events-none" aria-hidden="true">
        <path
          d="M17 37.5 H47"
          fill="none"
          stroke="#f5f5f5"
          strokeWidth={7}
          strokeLinecap="round"
        />
        <g fill="#ff56a1" stroke="#ff56a1" strokeWidth={1.5} strokeLinejoin="round">
          <path d="M21.03 39.78 L40.49 24.48 L39.51 23.02 L17.97 35.22 Z" />
          <circle cx="19.5" cy="37.5" r="2.75" />
          <circle cx="40" cy="23.75" r="0.875" />
        </g>
      </svg>
    </span>
  );
}

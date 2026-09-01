import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/use-t";
import type { SessionClient } from "@/lib/session-registry";

const SEARCH_OPTIONS = {
  decorations: {
    matchBackground: "#0070f3",
    activeMatchBackground: "#ffb224",
    matchOverviewRuler: "#0070f3",
    activeMatchColorOverviewRuler: "#ffb224",
  },
};

/** Floating search bar (Ctrl+F) bound to one terminal's SearchAddon. */
export function TerminalSearch({
  client,
  onClose,
}: {
  client: SessionClient;
  onClose: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    return () => client.search.clearDecorations();
  }, [client]);

  const findNext = (q: string = query) => {
    if (q) client.search.findNext(q, SEARCH_OPTIONS);
  };
  const findPrevious = () => {
    if (query) client.search.findPrevious(query, SEARCH_OPTIONS);
  };

  return (
    <div className="absolute right-4 top-2 z-30 flex items-center gap-0.5 rounded-md border border-border bg-[#0a0a0a] p-1 shadow-lg">
      <Search className="ml-1 size-3.5 shrink-0 text-[#666]" />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (e.target.value) client.search.findNext(e.target.value, SEARCH_OPTIONS);
          else client.search.clearDecorations();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) findPrevious();
            else findNext();
          } else if (e.key === "Escape") {
            onClose();
          }
        }}
        placeholder={t.search.placeholder}
        className="h-6 w-44 bg-transparent px-1.5 font-mono text-xs text-foreground outline-none placeholder:text-[#525252]"
      />
      <Button
        variant="ghost"
        size="icon"
        className="size-6 text-[#a1a1a1]"
        disabled={!query}
        onClick={findPrevious}
        aria-label={t.search.previous}
      >
        <ChevronUp className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-6 text-[#a1a1a1]"
        disabled={!query}
        onClick={() => findNext()}
        aria-label={t.search.next}
      >
        <ChevronDown className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-6 text-[#a1a1a1]"
        onClick={onClose}
        aria-label={t.search.close}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

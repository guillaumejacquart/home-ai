"use client";

import { useState } from "react";
import { Brain, ChevronDown } from "lucide-react";

export function ReasoningPart({
  text,
  isStreaming = false,
}: {
  text: string;
  isStreaming?: boolean;
}) {
  const [open, setOpen] = useState(false);

  // Stays collapsed by default, even while streaming; only opens if the user opened it.
  const preview = text.slice(0, 120).replace(/\n/g, " ");

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/70">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-amber-800"
      >
        <Brain className="size-3.5 shrink-0" />
        <span>Réflexion</span>
        {isStreaming ? (
          <span className="ml-auto flex items-center gap-1 text-[11px] text-amber-600">
            <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
            en cours…
          </span>
        ) : (
          <span className="ml-auto text-[11px] font-normal text-amber-600/80">
            {preview ? `${preview.slice(0, 40)}…` : "voir"}
          </span>
        )}
        <ChevronDown className={`size-3.5 shrink-0 text-amber-600 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-amber-100 bg-white px-3 py-2">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-zinc-700">
            {text}
          </pre>
        </div>
      )}
    </div>
  );
}

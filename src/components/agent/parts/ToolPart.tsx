"use client";

import { useState } from "react";
import { CheckCircle2, ChevronDown, Loader2, Wrench, XCircle } from "lucide-react";

export type ToolState =
  | "input-streaming"
  | "input-available"
  | "approval-requested"
  | "approval-responded"
  | "output-available"
  | "output-error"
  | "output-denied";

const RUNNING: ToolState[] = [
  "input-streaming",
  "input-available",
  "approval-requested",
  "approval-responded",
];

export function ToolPart({
  name,
  state,
  input,
  output,
  errorText,
}: {
  name: string;
  state: ToolState;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}) {
  const [open, setOpen] = useState(false);
  const isRunning = RUNNING.includes(state);
  const isError = state === "output-error";
  const isDenied = state === "output-denied";

  return (
    <div className={`rounded-lg border ${isError ? "border-red-200 bg-red-50/60" : "border-brand/20 bg-brand-light/30"}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className={`flex size-6 items-center justify-center rounded-md ${isError ? "bg-red-100 text-red-600" : isRunning ? "bg-amber-100 text-amber-600" : "bg-emerald-100 text-emerald-600"}`}>
          {isRunning ? <Loader2 className="size-3.5 animate-spin" /> : isError ? <XCircle className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
        </span>
        <span className="flex items-center gap-1.5 text-xs font-medium text-ink">
          <Wrench className="size-3" />
          {name}
        </span>
        <span className="ml-auto text-[11px] text-muted">
          {isRunning ? "en cours…" : isError ? "erreur" : isDenied ? "refusé" : "terminé"}
        </span>
        <ChevronDown className={`size-3.5 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-brand/10 bg-white px-3 py-2">
          {input !== undefined && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Input</div>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-canvas p-2 text-[11px]">
                {formatValue(input)}
              </pre>
            </div>
          )}
          {output !== undefined && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Output</div>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-canvas p-2 text-[11px]">
                {formatValue(output)}
              </pre>
            </div>
          )}
          {errorText && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-red-600">Erreur</div>
              <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-red-50 p-2 text-[11px] text-red-700">{errorText}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatValue(v: unknown): string {
  if (typeof v === "string") return v.slice(0, 4000);
  try {
    return JSON.stringify(v, null, 2).slice(0, 4000);
  } catch {
    return String(v).slice(0, 4000);
  }
}

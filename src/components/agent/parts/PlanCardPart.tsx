"use client";

import { useState } from "react";
import { Check, Loader2, Pencil, Sparkles } from "lucide-react";

import { Button, Textarea } from "@/components/ui";

export type PlanKind = "app" | "script";

export interface PlanTarget {
  id: string;
  prompt: string;
}

function asObject(value: unknown): Record<string, unknown> | null {
  const parsed = typeof value === "string" ? safeJson(value) : value;
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Le tool plan_app / plan_script renvoie `{ plan, id, … }`. */
function readPlan(output: unknown): string | null {
  const obj = asObject(output);
  const plan = obj?.plan;
  if (typeof plan === "string" && plan.trim()) return plan;
  // Certains modèles renvoient le plan brut plutôt que l'objet attendu.
  if (typeof output === "string" && output.trim().length > 20) return output;
  return null;
}

export function PlanCardPart({
  kind,
  state,
  input,
  output,
  applied,
  onApply,
}: {
  kind: PlanKind;
  state: string;
  input: unknown;
  output: unknown;
  /** Un generate_* suit déjà ce plan dans le fil. */
  applied: boolean;
  onApply: (planText: string, kind: PlanKind, target: PlanTarget) => void;
}) {
  if (state !== "output-available") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent-light/40 px-3 py-2 text-xs text-muted">
        <Loader2 className="size-3.5 animate-spin" />
        Préparation du plan…
      </div>
    );
  }

  const plan = readPlan(output);
  if (!plan) return null;
  return (
    <PlanCard kind={kind} plan={plan} input={input} output={output} applied={applied} onApply={onApply} />
  );
}

/**
 * Monté seulement quand le plan est complet : le texte initial est donc juste,
 * pas besoin de le resynchroniser pendant le stream.
 */
function PlanCard({
  kind,
  plan,
  input,
  output,
  applied,
  onApply,
}: {
  kind: PlanKind;
  plan: string;
  input: unknown;
  output: unknown;
  applied: boolean;
  onApply: (planText: string, kind: PlanKind, target: PlanTarget) => void;
}) {
  const [text, setText] = useState(plan);
  const [sent, setSent] = useState(false);

  const locked = sent || applied;
  const target: PlanTarget = {
    id: String(asObject(output)?.id ?? ""),
    prompt: String(asObject(input)?.prompt ?? ""),
  };

  function handleApply() {
    if (!text.trim() || locked) return;
    setSent(true);
    onApply(text.trim(), kind, target);
  }

  return (
    <div className="rounded-xl border border-accent bg-accent-light p-3">
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-lg bg-white text-accent shadow-sm">
          <Pencil className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-accent">Plan proposé</p>
          <p className="text-xs text-muted">Relis, modifie si besoin, puis lance la génération.</p>
        </div>
        {applied && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
            <Check className="size-3" /> appliqué
          </span>
        )}
        {sent && !applied && (
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-light px-2 py-0.5 text-xs font-medium text-brand-dark">
            <Sparkles className="size-3" /> envoyé
          </span>
        )}
      </div>

      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={7}
        className="mt-3 font-mono text-xs"
        aria-label="Plan modifiable"
        disabled={locked}
      />

      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={handleApply} disabled={locked || !text.trim()}>
          <Sparkles className="size-3.5" />
          Générer le code
        </Button>
        {locked && <span className="self-center text-xs text-muted">Le plan a été envoyé à l’assistant.</span>}
      </div>
    </div>
  );
}

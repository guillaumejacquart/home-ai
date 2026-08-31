"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, Textarea } from "@/components/ui";

interface Props {
  planText: string;
  setPlanText: (v: string) => void;
  onGenerateCode: () => void;
  onCancel: () => void;
  busy?: boolean;
  phase?: "plan" | "code" | null;
  elapsed?: number;
}

export function PlanCard({ planText, setPlanText, onGenerateCode, onCancel, busy, phase, elapsed }: Props) {
  const t = useTranslations("appEditor");
  const tCommon = useTranslations("common");
  return (
    <div className="rounded-lg border border-accent bg-accent-light p-3">
      <h3 className="text-sm font-semibold text-accent">{t("planEditTitle")}</h3>
      <p className="mt-0.5 text-xs text-muted">{t("planEditHint")}</p>
      <Textarea
        value={planText}
        onChange={(e) => setPlanText(e.target.value)}
        rows={7}
        className="mt-2 font-mono text-xs"
        aria-label={t("planEditLabel")}
        disabled={!!busy}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onGenerateCode} disabled={!!busy}>
          {t("generateCode")}
        </Button>
        <Button size="sm" variant="ghost" disabled={!!busy} onClick={onCancel}>
          {tCommon("cancel")}
        </Button>
        {busy && phase === "code" && (
          <span className="ml-auto flex items-center gap-1 text-xs text-muted">
            <Loader2 className="size-3 animate-spin" />
            {t("phaseCode")} ({elapsed ?? 0}s)
          </span>
        )}
      </div>
    </div>
  );
}

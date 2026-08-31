"use client";

import { Loader2, Workflow } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Badge, Button } from "@/components/ui";
import { ScriptFlow, type FlowSpan } from "@/components/ScriptFlow";
import { DATE_TIME_FORMAT } from "@/lib/format";

import { RUN_VARIANT, type Run } from "./types";

/** A run's row: badge + "Flow" button that loads and shows the trace. */
export function RunRow({
  scriptId,
  run,
  runDetails,
  detailLoading,
  onToggleDetail,
}: {
  scriptId: string;
  run: Run;
  runDetails: Record<string, FlowSpan[]>;
  detailLoading: Record<string, boolean>;
  onToggleDetail: (scriptId: string, runId: string) => void;
}) {
  const t = useTranslations("scripts");
  const format = useFormatter();
  const spans = runDetails[run.id];
  const loading = detailLoading[run.id];

  return (
    <div className="rounded-lg border border-line bg-white p-3">
      <div className="flex items-center gap-2">
        <Badge variant={RUN_VARIANT[run.status]}>{run.status}</Badge>
        <span className="text-xs text-muted">
          {format.dateTime(new Date(run.startedAt), DATE_TIME_FORMAT)}
          {run.durationMs != null ? ` · ${run.durationMs}ms` : ""}
        </span>
        <Button
          size="sm"
          variant="secondary"
          className="ml-auto px-2"
          onClick={() => onToggleDetail(scriptId, run.id)}
          disabled={loading}
          title={t("viewFlow")}
          aria-label={t("flowAria", {
            date: format.dateTime(new Date(run.startedAt), DATE_TIME_FORMAT),
          })}
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : spans !== undefined ? (
            t("hideFlow")
          ) : (
            <Workflow className="size-4" />
          )}
        </Button>
      </div>
      {run.error && (
        <pre className="mt-2 whitespace-pre-wrap rounded bg-danger-light p-2 text-xs text-danger">
          {run.error}
        </pre>
      )}
      {spans !== undefined && spans.length > 0 ? (
        <div className="mt-2">
          <ScriptFlow spans={spans} />
        </div>
      ) : (
        run.output && (
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-canvas p-2 text-xs">
            {run.output}
          </pre>
        )
      )}
    </div>
  );
}

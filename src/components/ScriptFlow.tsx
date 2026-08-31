"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  CheckCircle2,
  ChevronRight,
  Cloud,
  Database,
  Mail,
  Sparkles,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui";

export type FlowSpan = {
  id: string;
  seq: number;
  parentId: string | null;
  kind: "step" | "call" | "log";
  origin?: "explicit" | "implicit" | null;
  label?: string | null;
  method?: string | null;
  args?: string | null;
  result?: string | null;
  status: "success" | "error";
  error?: string | null;
  startedAt: string;
  durationMs?: number | null;
};

type FlowNode = FlowSpan & { children: FlowNode[] };

function methodIcon(method: string) {
  if (method.startsWith("storage.")) return <Database className="size-3.5" />;
  if (method.startsWith("google.")) return <Cloud className="size-3.5" />;
  if (method.startsWith("mail.")) return <Mail className="size-3.5" />;
  if (method.startsWith("ai.")) return <Sparkles className="size-3.5" />;
  return null;
}

function StatusIcon({ status }: { status: "success" | "error" }) {
  return status === "success" ? (
    <CheckCircle2 className="size-3.5 text-success" />
  ) : (
    <XCircle className="size-3.5 text-danger" />
  );
}

function formatDuration(ms?: number | null) {
  if (ms == null) return "";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function prettyJson(raw?: string | null) {
  if (!raw) return null;
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function PayloadDetails({ title, raw }: { title: string; raw?: string | null }) {
  if (!raw) return null;
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs text-muted">{title}</summary>
      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-canvas p-2 font-mono text-xs">
        {prettyJson(raw)}
      </pre>
    </details>
  );
}

function CallRow({ span }: { span: FlowSpan }) {
  const t = useTranslations("scripts");
  return (
    <div className="flex flex-col rounded-md border border-line bg-white px-3 py-2">
      <div className="flex items-center gap-2">
        <StatusIcon status={span.status} />
        <span className="inline-flex items-center gap-1.5 font-mono text-xs font-medium text-brand-dark">
          {methodIcon(span.method ?? "")}
          {span.method}
        </span>
        <span className="ml-auto text-xs text-muted">{formatDuration(span.durationMs)}</span>
        {span.status === "error" && (
          <Badge variant="danger">
            {span.error ? span.error.slice(0, 80) : "erreur"}
          </Badge>
        )}
      </div>
      {span.status === "error" && span.error && (
        <pre className="mt-1 whitespace-pre-wrap rounded bg-danger-light p-2 text-xs text-danger">
          {span.error}
        </pre>
      )}
      <PayloadDetails title={t("flowInput")} raw={span.args} />
      <PayloadDetails title={t("flowOutput")} raw={span.result} />
    </div>
  );
}

function LogLine({ span }: { span: FlowSpan }) {
  return (
    <p className="rounded px-2 py-0.5 font-mono text-xs text-muted">
      {span.label ?? ""}
    </p>
  );
}

function StepPhaseCard({ node, index }: { node: FlowNode; index: number }) {
  const t = useTranslations("scripts");
  const isError = node.status === "error";
  return (
    <div
      className={`flex w-full flex-col overflow-hidden rounded-xl border bg-white shadow-sm ${isError ? "border-danger/40" : "border-line"}`}
    >
      <div className={`flex items-center gap-2 border-b px-3 py-2 ${isError ? "bg-danger-light/60" : "bg-canvas"}`}>
        <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${isError ? "bg-danger" : "bg-brand"}`}>
          {index + 1}
        </span>
        <span className="truncate text-sm font-semibold text-brand-dark" title={node.label ?? undefined}>
          {node.label ?? t("step")}
        </span>
        <Badge variant={isError ? "danger" : "success"} className="shrink-0">
          {node.status}
        </Badge>
        <span className="ml-auto shrink-0 text-xs text-muted">{formatDuration(node.durationMs)}</span>
      </div>
      {node.error && (
        <pre className="mx-2 mt-2 whitespace-pre-wrap rounded bg-danger-light p-2 text-xs text-danger">
          {node.error}
        </pre>
      )}
      <div className="max-h-[320px] space-y-1.5 overflow-y-auto p-2">
        {node.children.length === 0 ? (
          <p className="py-2 text-center text-xs text-muted">—</p>
        ) : (
          node.children.map((child) => <SpanNode key={child.id} node={child} />)
        )}
      </div>
    </div>
  );
}

function CallPhaseCard({ span, index }: { span: FlowSpan; index: number }) {
  return (
    <div className="w-full rounded-xl border border-line bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b bg-canvas px-3 py-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-neutral-light text-xs font-bold text-neutral">
          {index + 1}
        </span>
        <span className="truncate font-mono text-xs font-medium text-brand-dark">{span.method}</span>
      </div>
      <div className="p-2">
        <CallRow span={span} />
      </div>
    </div>
  );
}

function LogPhaseCard({ span, index }: { span: FlowSpan; index: number }) {
  return (
    <div className="w-full rounded-xl border border-dashed border-line bg-white px-3 py-3 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-neutral-light text-xs font-bold text-neutral">
          {index + 1}
        </span>
        <span className="text-xs font-medium text-muted">log</span>
      </div>
      <LogLine span={span} />
    </div>
  );
}

function PhaseNode({ node, index }: { node: FlowNode; index: number }) {
  if (node.kind === "step") return <StepPhaseCard node={node} index={index} />;
  if (node.kind === "call") return <CallPhaseCard span={node} index={index} />;
  return <LogPhaseCard span={node} index={index} />;
}

function SpanNode({ node }: { node: FlowNode }) {
  if (node.kind === "step") {
    // Nested step inside another step: keep vertical stacked look
    return (
      <div className="rounded-lg border border-line bg-canvas px-2 py-2">
        <div className="mb-1 flex items-center gap-2">
          <span className="rounded-full bg-brand-light px-2 py-0.5 text-xs font-semibold text-brand-dark">
            {node.label ?? "Étape"}
          </span>
          <Badge variant={node.status === "success" ? "success" : "danger"}>{node.status}</Badge>
          <span className="ml-auto text-xs text-muted">{formatDuration(node.durationMs)}</span>
        </div>
        {node.error && (
          <pre className="mb-1 whitespace-pre-wrap rounded bg-danger-light p-1.5 text-xs text-danger">
            {node.error}
          </pre>
        )}
        <div className="space-y-1.5">
          {node.children.map((child) => (
            <SpanNode key={child.id} node={child} />
          ))}
        </div>
      </div>
    );
  }
  if (node.kind === "log") return <LogLine span={node} />;
  return <CallRow span={node} />;
}

function buildTree(spans: FlowSpan[]): FlowNode[] {
  const nodes = new Map<string, FlowNode>();
  for (const s of spans) nodes.set(s.id, { ...s, children: [] });
  const roots: FlowNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function ScriptFlow({ spans }: { spans: FlowSpan[] }) {
  const t = useTranslations("scripts");
  const roots = useMemo(() => buildTree(spans), [spans]);

  if (roots.length === 0) {
    return <p className="text-sm text-muted">{t("noFlow")}</p>;
  }

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex min-w-max items-start gap-0 px-1">
        {roots.map((node, idx) => (
          <div key={node.id} className="flex items-start">
            <div className="w-[300px] shrink-0">
              <PhaseNode node={node} index={idx} />
            </div>
            {idx < roots.length - 1 && (
              <div className="flex h-[52px] shrink-0 items-center">
                <div className="h-0.5 w-6 bg-line" />
                <ChevronRight className="-ml-0.5 size-4 shrink-0 text-muted" aria-hidden />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
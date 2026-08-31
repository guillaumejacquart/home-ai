/** Types shared by `ScriptsManager` and its subcomponents. */

export type TriggerKind = "schedule" | "manual" | "webhook";

export interface ScriptRow {
  id: string;
  name: string;
  visibility: "private" | "family";
  triggerKind: TriggerKind;
  schedule: string;
  webhookSlug: string | null;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
}

export type ScriptDetail = ScriptRow & { code: string; webhookSecret?: string | null };

export interface Run {
  id: string;
  status: "running" | "success" | "error" | "timeout";
  output: string | null;
  error: string | null;
  durationMs: number | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface ChatMsg {
  id: string;
  role: "user" | "assistant" | "plan";
  content: string;
  model?: string | null;
  createdAt: string;
}

export interface ScriptVersion {
  id: string;
  version: number;
  name: string;
  schedule: string;
  code: string;
  prompt: string | null;
  createdAt: string;
}

export interface AppOption {
  id: string;
  name: string;
}

export type PanelTab = "runs" | "versions" | "code" | "storage";

export const RUN_VARIANT: Record<Run["status"], "success" | "danger" | "neutral"> = {
  running: "neutral",
  success: "success",
  error: "danger",
  timeout: "neutral",
};

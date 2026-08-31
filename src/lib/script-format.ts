import { CronExpressionParser } from "cron-parser";

/** Reason it is invalid — translated in the UI, see the `scripts.schedule` namespace. */
export type ScheduleError = "empty" | "invalid";

export interface SchedulePreview {
  valid: boolean;
  /** Raw upcoming run dates, formatted by the caller. */
  nextRuns: Date[];
  error?: ScheduleError;
}

/**
 * Turns a 5-field cron expression into its next run dates, so you can read a
 * schedule without having to decode "0 8 * * 1".
 */
export function previewSchedule(schedule: string, count = 3): SchedulePreview {
  const expr = schedule.trim();
  if (!expr) return { valid: false, nextRuns: [], error: "empty" };
  try {
    const it = CronExpressionParser.parse(expr);
    const nextRuns: Date[] = [];
    for (let i = 0; i < count; i++) {
      nextRuns.push(it.next().toDate());
    }
    return { valid: true, nextRuns };
  } catch {
    return { valid: false, nextRuns: [], error: "invalid" };
  }
}

import { CronExpressionParser } from "cron-parser";

/** Cause d'invalidité — traduite côté UI, cf. namespace `scripts.schedule`. */
export type ScheduleError = "empty" | "invalid";

export interface SchedulePreview {
  valid: boolean;
  /** Prochaines dates d'exécution brutes, formatées par l'appelant. */
  nextRuns: Date[];
  error?: ScheduleError;
}

/**
 * Traduit une expression cron 5 champs en prochaines dates, pour relire une
 * planification sans avoir à décoder « 0 8 * * 1 ».
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

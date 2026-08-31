// Turns a 5-field cron expression into a routine descriptor (best-effort).

/**
 * Structured routine, so the same schedule can be rendered in English for the
 * LLM prompt and localised for the UI.
 */
export type RoutineDescriptor =
  | { key: "hourly" }
  | { key: "daily"; hour: number }
  | { key: "weekly"; weekday: number; hour: number }
  | { key: "monthly"; day: number; hour: number };

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Reads a 5-field cron expression as a routine. Returns `null` when the pattern
 * is too complex to summarise.
 */
export function describeSchedule(schedule: string): RoutineDescriptor | null {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, month, dow] = parts;
  if (month !== "*") return null;
  if (dom === "*" && dow === "*") {
    if (hour !== "*" && min === "0") {
      const h = Number(hour);
      return Number.isInteger(h) ? { key: "daily", hour: h } : null;
    }
    if (hour === "*" && min === "0") return { key: "hourly" };
    return null;
  }
  if (dom === "*" && /^\d+$/.test(dow) && min === "0" && /^\d+$/.test(hour)) {
    const d = Number(dow);
    if (d >= 0 && d <= 6 && WEEKDAYS[d]) return { key: "weekly", weekday: d, hour: Number(hour) };
  }
  if (dow === "*" && /^\d+$/.test(dom) && min === "0" && /^\d+$/.test(hour)) {
    return { key: "monthly", day: Number(dom), hour: Number(hour) };
  }
  return null;
}

/** English rendering, used for the graph's fallback label and the LLM prompt. */
export function formatRoutine(routine: RoutineDescriptor): string {
  switch (routine.key) {
    case "hourly":
      return "Every hour";
    case "daily":
      return `Every day at ${pad2(routine.hour)}:00`;
    case "weekly":
      return `Every ${WEEKDAYS[routine.weekday]} at ${pad2(routine.hour)}:00`;
    case "monthly":
      return `Day ${routine.day} of the month at ${pad2(routine.hour)}:00`;
  }
}

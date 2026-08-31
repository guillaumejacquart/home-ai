import { previewSchedule } from "@/lib/script-format";

/** Common household scheduling presets. Labels are localised via the `scripts` namespace. */
export const SCRIPT_PRESETS = [
  { labelKey: "presetHourly", schedule: "0 * * * *" },
  { labelKey: "presetDaily8", schedule: "0 8 * * *" },
  { labelKey: "presetDaily18", schedule: "0 18 * * *" },
  { labelKey: "presetMonday8", schedule: "0 8 * * 1" },
  { labelKey: "presetMondayMorning", schedule: "0 9 * * 1" },
  { labelKey: "presetSundayEvening", schedule: "0 19 * * 0" },
  { labelKey: "presetEvery30Min", schedule: "*/30 * * * *" },
  { labelKey: "presetMonthlyFirst8", schedule: "0 8 1 * *" },
] as const;

export type ScriptPreset = (typeof SCRIPT_PRESETS)[number];

/** A preset is valid when cron-parser accepts it (safety net while editing). */
export function isValidScript(schedule: string): boolean {
  return previewSchedule(schedule).valid;
}

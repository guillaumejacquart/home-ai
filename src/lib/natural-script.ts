import { previewSchedule } from "@/lib/script-format";

export interface ScriptPreset {
  label: string;
  schedule: string;
}

/** Presets de planification courants pour la famille. */
export const SCRIPT_PRESETS: ScriptPreset[] = [
  { label: "Chaque heure", schedule: "0 * * * *" },
  { label: "Tous les jours à 8h", schedule: "0 8 * * *" },
  { label: "Tous les jours à 18h", schedule: "0 18 * * *" },
  { label: "Lundi à 8h", schedule: "0 8 * * 1" },
  { label: "Chaque lundi matin", schedule: "0 9 * * 1" },
  { label: "Chaque dimanche soir", schedule: "0 19 * * 0" },
  { label: "Toutes les 30 min", schedule: "*/30 * * * *" },
  { label: "1er du mois à 8h", schedule: "0 8 1 * *" },
];

/** Un preset est valide si cron-parser l'accepte (filet de sécurité pour l'édition). */
export function isValidScript(schedule: string): boolean {
  return previewSchedule(schedule).valid;
}
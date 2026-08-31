// Traduction d'une expression cron 5 champs en libellé de routine (best-effort).

const WEEKDAYS = [
  "dimanche",
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
] as const;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Traduit une expression cron 5 champs en libellé lisible, pour matérialiser
 * une routine. Retourne `null` si le pattern est trop complexe.
 */
export function describeSchedule(schedule: string): string | null {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, month, dow] = parts;
  if (month !== "*") return null;
  if (dom === "*" && dow === "*") {
    if (hour !== "*" && min === "0") {
      const h = Number(hour);
      return Number.isInteger(h) ? `Tous les jours à ${pad2(h)}h00` : null;
    }
    if (hour === "*" && min === "0") return "Toutes les heures";
    return null;
  }
  if (dom === "*" && /^\d+$/.test(dow) && min === "0" && /^\d+$/.test(hour)) {
    const d = Number(dow);
    if (d >= 0 && d <= 6 && WEEKDAYS[d]) {
      const h = Number(hour);
      return `Chaque ${WEEKDAYS[d]} à ${pad2(h)}h00`;
    }
  }
  if (dow === "*" && /^\d+$/.test(dom) && min === "0" && /^\d+$/.test(hour)) {
    const h = Number(hour);
    return `Le ${dom} du mois à ${pad2(h)}h00`;
  }
  return null;
}
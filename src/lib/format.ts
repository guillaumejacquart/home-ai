/** Shared options for rendering a short date + time. */
export const DATE_TIME_FORMAT = {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
} as const;

/**
 * Compact relative time ("5 min ago"). Past one month we switch to the absolute
 * date, which reads better than "14 months ago".
 */
export function formatRelativeTime(date: Date | string, locale: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
  const min = Math.round((Date.now() - d.getTime()) / 60_000);

  if (min < 1) return rtf.format(0, "minute");
  if (min < 60) return rtf.format(-min, "minute");
  const hours = Math.round(min / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  const days = Math.round(hours / 24);
  if (days < 30) return rtf.format(-days, "day");
  return d.toLocaleDateString(locale);
}

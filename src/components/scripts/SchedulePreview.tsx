"use client";

import { useMemo } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { previewSchedule } from "@/lib/script-format";
import { DATE_TIME_FORMAT } from "@/lib/format";

/** Reads back a cron expression: next run times, or an error message. */
export function SchedulePreview({ schedule }: { schedule: string }) {
  const t = useTranslations("scripts");
  const format = useFormatter();
  const preview = useMemo(() => previewSchedule(schedule), [schedule]);
  if (!schedule.trim()) return null;
  if (!preview.valid) {
    return (
      <p className="mt-1 text-xs font-medium text-danger">
        {preview.error === "empty" ? t("scheduleEmpty") : t("scheduleInvalid")}
      </p>
    );
  }
  const runs = preview.nextRuns.map((d) => format.dateTime(d, DATE_TIME_FORMAT)).join(" · ");
  return <p className="mt-1 text-xs text-muted">{t("nextRuns", { runs })}</p>;
}

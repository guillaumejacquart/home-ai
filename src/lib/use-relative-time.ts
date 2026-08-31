"use client";

import { useLocale } from "next-intl";

import { formatRelativeTime } from "@/lib/format";

/** `formatRelativeTime` bound to the active language. */
export function useRelativeTime() {
  const locale = useLocale();
  return (date: Date | string) => formatRelativeTime(date, locale);
}

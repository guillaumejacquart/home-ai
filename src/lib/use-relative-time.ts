"use client";

import { useLocale } from "next-intl";

import { formatRelativeTime } from "@/lib/format";

/** `formatRelativeTime` lié à la langue active. */
export function useRelativeTime() {
  const locale = useLocale();
  return (date: Date | string) => formatRelativeTime(date, locale);
}

"use client";

import { useRef } from "react";
import type { LucideIcon } from "lucide-react";

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: LucideIcon;
}

/**
 * Accessible tabs: `role="tablist"`, `aria-selected`, arrow key / Home / End
 * navigation. Two styles: `underline` (page tabs) and `pill` (tabs in a
 * nested panel).
 */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  variant = "underline",
  label,
}: {
  tabs: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  variant?: "underline" | "pill";
  label: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  function onKeyDown(e: React.KeyboardEvent) {
    const index = tabs.findIndex((t) => t.id === value);
    let next = -1;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next === -1) return;
    e.preventDefault();
    onChange(tabs[next].id);
    listRef.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next]?.focus();
  }

  const isPill = variant === "pill";

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={
        isPill
          ? "flex flex-wrap gap-1 rounded-lg bg-card p-1 shadow-sm"
          : "flex gap-1 overflow-x-auto border-b border-line"
      }
    >
      {tabs.map((t) => {
        const active = t.id === value;
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={active}
            aria-controls={`tabpanel-${t.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={`flex shrink-0 items-center gap-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 ${
              isPill
                ? `rounded-md px-3 py-1.5 ${
                    active
                      ? "bg-brand text-white shadow-sm"
                      : "text-muted hover:bg-brand-light hover:text-brand-dark"
                  }`
                : `-mb-px rounded-t-lg border-b-2 px-4 py-2 ${
                    active
                      ? "border-brand text-brand-dark"
                      : "border-transparent text-muted hover:bg-brand-light"
                  }`
            }`}
          >
            {Icon && <Icon className="size-4" />}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/** Tab panel content, linked to its button via `aria-labelledby`. */
export function TabPanel({
  id,
  children,
  className = "",
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="tabpanel"
      id={`tabpanel-${id}`}
      aria-labelledby={`tab-${id}`}
      tabIndex={0}
      className={`focus-visible:outline-none ${className}`}
    >
      {children}
    </div>
  );
}

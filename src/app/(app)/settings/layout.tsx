"use client";

import { BarChart3, Brain, BrainCircuit, KeyRound, Plug, SlidersHorizontal } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { PageHeader, Tabs } from "@/components/ui";
import type { TabItem } from "@/components/ui";

const TAB_IDS = ["general", "intelligence", "memory", "access", "mcp", "usage"] as const;
type SettingsTab = (typeof TAB_IDS)[number];

/**
 * Settings shell: header + tabs. Each tab is a real route segment
 * (`/settings/tokens`…), so it's addressable and back-button friendly;
 * it only loads its own data.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations("settings");
  const router = useRouter();
  const pathname = usePathname();

  const current = (TAB_IDS.find((id) => pathname.startsWith(`/settings/${id}`)) ??
    "general") as SettingsTab;

  const tabs: readonly TabItem<SettingsTab>[] = [
    { id: "general", label: t("tabGeneral"), icon: SlidersHorizontal },
    { id: "intelligence", label: t("tabIntelligence"), icon: BrainCircuit },
    { id: "memory", label: t("tabMemory"), icon: Brain },
    { id: "access", label: t("tabAccess"), icon: KeyRound },
    { id: "mcp", label: t("tabMcp"), icon: Plug },
    { id: "usage", label: t("tabUsage"), icon: BarChart3 },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <Tabs
        tabs={tabs}
        value={current}
        onChange={(id) => router.push(`/settings/${id}`)}
        label={t("tabsLabel")}
      />
      {children}
    </div>
  );
}

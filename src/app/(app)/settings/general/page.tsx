"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { Alert, Button, Card, Field, Select, TabPanel, useToast } from "@/components/ui";
import { putSettings, useAction, useSettings, useSyncFrom } from "@/components/settings/shared";
import { api } from "@/lib/api-client";
import { type Locale } from "@/i18n/config";

export default function GeneralSettingsPage() {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const activeLocale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const { data, reload } = useSettings();
  const { pending, error, run } = useAction();

  const [briefEnabled, setBriefEnabled] = useState(false);
  const [briefHour, setBriefHour] = useState(8);

  useSyncFrom(data, (d) => {
    setBriefEnabled(d.brief.enabled);
    setBriefHour(d.brief.hour);
  });

  function changeLocale(next: Locale) {
    void run(
      "locale",
      async () => {
        await putSettings({ locale: next });
        toast(t("languageSaved"));
        // The route sets the cookie; we need to re-render to reload the messages.
        router.refresh();
      },
      t("saveError"),
    );
  }

  function saveBrief() {
    void run(
      "brief",
      async () => {
        await putSettings({ briefEnabled, briefHour });
        toast(t("modelsSaved"));
        void reload();
      },
      t("saveError"),
    );
  }

  function generateBrief() {
    void run(
      "generate",
      async () => {
        await api.post("/api/assistant/brief", { locale: activeLocale });
        toast(t("briefGenerated"));
      },
      t("briefError"),
    );
  }

  return (
    <TabPanel id="general" className="space-y-8">
      {error && <Alert>{error}</Alert>}

      {/* Langue de l'interface */}
      <Card>
        <h2 className="font-semibold text-brand-dark">{t("languageTitle")}</h2>
        <p className="mt-1 text-sm text-muted">{t("languageDescription")}</p>
        <div className="mt-4 max-w-xs">
          <Field label={t("languageLabel")}>
            <Select
              value={activeLocale}
              disabled={pending === "locale"}
              onChange={(e) => changeLocale(e.target.value as Locale)}
            >
              <option value="fr">{t("languageFr")}</option>
              <option value="en">{t("languageEn")}</option>
            </Select>
          </Field>
        </div>
      </Card>

      {/* Brief quotidien */}
      <Card>
        <h2 className="font-semibold text-brand-dark">{t("briefTitle")}</h2>
        <p className="mt-1 text-sm text-muted">{t("briefDescription")}</p>
        <div className="mt-4 space-y-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={briefEnabled}
              onChange={(e) => setBriefEnabled(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm font-medium">{t("briefEnabledLabel")}</span>
          </label>
          {briefEnabled && (
            <div className="max-w-xs">
              <Field label={t("briefHourLabel")}>
                <Select
                  value={String(briefHour)}
                  onChange={(e) => setBriefHour(parseInt(e.target.value, 10))}
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>
                      {String(i).padStart(2, "0")}:00
                    </option>
                  ))}
                </Select>
              </Field>
              <p className="mt-1 text-xs text-muted">{t("briefHourHint")}</p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={pending === "brief"} onClick={saveBrief}>
              {pending === "brief" ? tCommon("saving") : tCommon("save")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending === "generate"}
              onClick={generateBrief}
            >
              {pending === "generate" ? t("briefGenerating") : t("briefGenerateNow")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => router.push("/assistant")}>
              {t("briefOpenJournal")}
            </Button>
          </div>
        </div>
      </Card>
    </TabPanel>
  );
}

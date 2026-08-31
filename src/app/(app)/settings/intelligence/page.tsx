"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";

import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Select,
  Skeleton,
  TabPanel,
  useToast,
} from "@/components/ui";
import {
  putSettings,
  useAction,
  useSettings,
  useSyncFrom,
  type ProviderId,
  type TestResult,
} from "@/components/settings/shared";
import { api } from "@/lib/api-client";
import { useSession } from "@/lib/auth-client";
import { can } from "@/lib/rbac";

export default function IntelligenceSettingsPage() {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const toast = useToast();
  const { data: sessionData } = useSession();
  const isAdmin = can(sessionData?.user?.role, "platform.settings");
  const { data, loading, reload } = useSettings();
  const { pending, error, run } = useAction();

  const [provider, setProvider] = useState<ProviderId>("opencode-go");
  const [plannerModel, setPlannerModel] = useState("");
  const [coderModel, setCoderModel] = useState("");
  const [assistantModel, setAssistantModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});

  const loadModels = useCallback(async (providerId: ProviderId) => {
    setModelsLoading(true);
    try {
      const d = await api.get<{ models: string[] }>(`/api/settings/models?provider=${providerId}`);
      setModels(d.models ?? []);
    } catch {
      setModels([]);
    } finally {
      setModelsLoading(false);
    }
  }, []);

  useSyncFrom(data, (d) => {
    setProvider(d.defaults.provider);
    setPlannerModel(d.defaults.plannerModel);
    setCoderModel(d.defaults.coderModel);
    setAssistantModel(d.defaults.assistantModel ?? d.defaults.plannerModel);
    void loadModels(d.defaults.provider);
  });

  function handleTest(providerId: ProviderId) {
    void run(
      `test:${providerId}`,
      async () => {
        const result = await api.post<TestResult>("/api/settings/test", { provider: providerId });
        setTestResults((prev) => ({ ...prev, [providerId]: result }));
      },
      t("networkTestError"),
    );
  }

  function handleSaveKey(providerId: ProviderId) {
    const value = apiKeyInputs[providerId]?.trim();
    if (!value) return;
    void run(
      `key:${providerId}`,
      async () => {
        await putSettings({ apiKeys: { [providerId]: value } });
        setApiKeyInputs((prev) => ({ ...prev, [providerId]: "" }));
        toast(t("keySaved", { provider: providerId }));
        void reload();
      },
      t("saveError"),
    );
  }

  function handleClearKey(providerId: ProviderId) {
    void run(
      `key:${providerId}`,
      async () => {
        await putSettings({ apiKeys: { [providerId]: null } });
        setApiKeyInputs((prev) => ({ ...prev, [providerId]: "" }));
        toast(t("keyCleared", { provider: providerId }));
        void reload();
      },
      t("saveError"),
    );
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    void run(
      "models",
      async () => {
        const payload = await putSettings({
          provider,
          plannerModel: plannerModel.trim() || null,
          coderModel: coderModel.trim() || null,
          assistantModel: assistantModel.trim() || null,
        });
        toast(t("modelsSaved"));
        setProvider(payload.defaults.provider);
        setPlannerModel(payload.defaults.plannerModel);
        setCoderModel(payload.defaults.coderModel);
        setAssistantModel(payload.defaults.assistantModel);
        void reload();
      },
      t("saveError"),
    );
  }

  if (loading) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-56" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const savingKey = pending?.startsWith("key:") ? pending.slice(4) : null;
  const testing = pending?.startsWith("test:") ? pending.slice(5) : null;

  return (
    <TabPanel id="intelligence" className="space-y-8">
      {error && <Alert>{error}</Alert>}

      {/* Providers */}
      <Card>
        <h2 className="font-semibold text-brand-dark">{t("providersTitle")}</h2>
        <p className="mt-1 text-sm text-muted">{t("providersDescription")}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {(data?.providers ?? []).map((p) => {
            const result = testResults[p.id];
            const source = p.source;
            return (
              <div key={p.id} className="rounded-lg border border-line bg-canvas p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold">{p.id}</span>
                  {source ? (
                    <Badge variant="success">{t("configured", { source })}</Badge>
                  ) : (
                    <Badge variant="danger">{t("notConfigured")}</Badge>
                  )}
                </div>
                <p className="mt-2 truncate font-mono text-xs text-muted">{p.baseUrl}</p>

                <div className="mt-3 space-y-2">
                  {isAdmin ? (
                    <>
                      <Input
                        type="password"
                        value={apiKeyInputs[p.id] ?? ""}
                        onChange={(e) =>
                          setApiKeyInputs((prev) => ({ ...prev, [p.id]: e.target.value }))
                        }
                        placeholder={t("apiKeyPlaceholder")}
                        className="font-mono text-xs"
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={savingKey !== null}
                          onClick={() => handleSaveKey(p.id)}
                        >
                          {savingKey === p.id ? "…" : t("saveKey")}
                        </Button>
                        {source === "db" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={savingKey !== null}
                            onClick={() => handleClearKey(p.id)}
                          >
                            {t("clearKey")}
                          </Button>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-muted">{t("keysManagedByAdmin")}</p>
                  )}
                </div>

                {isAdmin && (
                  <div className="mt-3 flex items-center gap-3">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={testing !== null}
                      onClick={() => handleTest(p.id)}
                    >
                      {testing === p.id ? "…" : t("test")}
                    </Button>
                    {result?.ok ? (
                      <span className="text-sm font-medium text-success">
                        {t("testOk", { latency: result.latencyMs ?? 0 })}
                      </span>
                    ) : result && !result.ok ? (
                      <span className="text-sm text-danger">{result.error ?? t("testFailed")}</span>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
          <p className="font-semibold">{t("openRouterHintTitle")}</p>
          <p className="mt-1">{t("openRouterHintBody")}</p>
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            <a
              href="https://openrouter.ai/settings/privacy"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              openrouter.ai/settings/privacy
            </a>
            <a
              href="https://openrouter.ai/settings/preferences"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              openrouter.ai/settings/preferences (18+)
            </a>
          </p>
          <p className="mt-2 text-amber-800">{t("openRouterMuseSparkHint")}</p>
        </div>
      </Card>

      {/* Default models */}
      <Card>
        <h2 className="font-semibold text-brand-dark">{t("modelsTitle")}</h2>
        <p className="mt-1 text-sm text-muted">{t("modelsDescription")}</p>
        <form onSubmit={save} className="mt-4 space-y-4">
          <Field label={t("defaultProvider")}>
            <Select
              value={provider}
              onChange={(e) => {
                const next = e.target.value as ProviderId;
                setProvider(next);
                void loadModels(next);
              }}
            >
              <option value="opencode-go">opencode-go</option>
              <option value="openrouter">openrouter</option>
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("plannerModel")}>
              <Input
                value={plannerModel}
                onChange={(e) => setPlannerModel(e.target.value)}
                placeholder="glm-5.3"
                list="settings-models"
              />
            </Field>
            <Field label={t("coderModel")}>
              <Input
                value={coderModel}
                onChange={(e) => setCoderModel(e.target.value)}
                placeholder="deepseek-v4-flash"
                list="settings-models"
              />
            </Field>
            <Field label={t("assistantModel")}>
              <Input
                value={assistantModel}
                onChange={(e) => setAssistantModel(e.target.value)}
                placeholder="glm-5.3"
                list="settings-models"
              />
            </Field>
          </div>
          <p className="text-xs text-muted">{t("assistantModelHint")}</p>
          <datalist id="settings-models">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <p className="text-xs text-muted">
            {modelsLoading
              ? t("modelsLoading")
              : models.length > 0
                ? t("modelsAvailable", { count: models.length, provider })
                : t("modelsNone")}
          </p>
          <p className="text-xs text-muted">{t("serverDefaults")}</p>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending === "models"}>
              {pending === "models" ? tCommon("saving") : tCommon("save")}
            </Button>
          </div>
        </form>
      </Card>
    </TabPanel>
  );
}

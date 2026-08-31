"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import {
  Alert,
  Badge,
  Button,
  buttonStyles,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  useConfirm,
  useToast,
} from "@/components/ui";
import { Bot, Cloud, CloudSun, FileText, Home, Inbox, Link2, Search, Send } from "lucide-react";

type Conn = {
  id: string;
  type: "google" | "smtp" | "imap" | "telegram" | "notion" | "homeassistant" | "weather" | "webhook";
  label: string;
  status: "active" | "error" | "expired";
  lastError: string | null;
};

type FormMode = Exclude<Conn["type"], "google"> | null;
type ProviderType = Conn["type"];

const TYPE_LABEL: Record<Conn["type"], string> = {
  google: "Google",
  smtp: "SMTP",
  imap: "IMAP",
  telegram: "Telegram",
  notion: "Notion",
  homeassistant: "Home Assistant",
  weather: "Météo",
  webhook: "Webhook",
};

const STATUS_VARIANT: Record<Conn["status"], "success" | "danger" | "neutral"> = {
  active: "success",
  error: "danger",
  expired: "neutral",
};

const PROVIDERS: {
  type: Conn["type"];
  title: string;
  icon: typeof Cloud;
  descriptionKey: string;
}[] = [
  { type: "google", title: "Google", icon: Cloud, descriptionKey: "providerGoogleDescription" },
  { type: "smtp", title: "SMTP", icon: Send, descriptionKey: "providerSmtpDescription" },
  { type: "imap", title: "IMAP", icon: Inbox, descriptionKey: "providerImapDescription" },
  { type: "telegram", title: "Telegram", icon: Bot, descriptionKey: "providerTelegramDescription" },
  { type: "notion", title: "Notion", icon: FileText, descriptionKey: "providerNotionDescription" },
  { type: "homeassistant", title: "Home Assistant", icon: Home, descriptionKey: "providerHomeAssistantDescription" },
  { type: "weather", title: "Météo", icon: CloudSun, descriptionKey: "providerWeatherDescription" },
  { type: "webhook", title: "Webhook", icon: Link2, descriptionKey: "providerWebhookDescription" },
];

/** Libellé de statut → clé de traduction. */
const STATUS_KEY = {
  active: "statusActive",
  error: "statusError",
  expired: "statusExpired",
} as const;

export function ConnectionsManager() {
  const t = useTranslations("connections");
  const searchParams = useSearchParams();
  const toast = useToast();
  const confirm = useConfirm();
  const [conns, setConns] = useState<Conn[]>([]);
  const [loading, setLoading] = useState(true);
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | ProviderType>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | Conn["status"]>("all");

  const banner = searchParams.get("connected") || searchParams.get("error");

  const refresh = useCallback(async () => {
    const res = await fetch("/api/connections");
    if (res.ok) setConns(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/connections")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (active) {
          setConns(data);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conns.filter((c) => {
      if (typeFilter !== "all" && c.type !== typeFilter) return false;
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (q && !`${c.label} ${TYPE_LABEL[c.type]}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [conns, search, typeFilter, statusFilter]);

  const activeFilters = search !== "" || typeFilter !== "all" || statusFilter !== "all";

  async function handleTest(conn: Conn) {
    setError(null);
    const res = await fetch(`/api/connections/${conn.id}/test`, { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      setNotice(data.message);
      toast(data.message ?? t("testOk"));
      await refresh();
    } else {
      const message = data.error ?? t("testFailed");
      setError(message);
      toast(message, "danger");
      await refresh();
    }
  }

  async function handleDelete(conn: Conn) {
    const ok = await confirm({
      title: t("deleteTitle", { label: conn.label }),
      description: t("deleteDescription"),
    });
    if (!ok) return;
    const res = await fetch(`/api/connections/${conn.id}`, { method: "DELETE" });
    if (res.ok) {
      await refresh();
      toast(t("deleted"));
    } else {
      toast(t("deleteError"), "danger");
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("title")}
        count={!loading && conns.length > 0 ? conns.length : undefined}
        description={t("description")}
      />

      {banner && (
        <Alert variant={searchParams.get("error") ? "danger" : "info"}>
          {banner === "connected" ? t("googleConnected") : decodeURIComponent(banner)}
        </Alert>
      )}
      {notice && <Alert variant="success">{notice}</Alert>}
      {error && <Alert>{error}</Alert>}

      {/* Catalogue des services disponibles */}
      <Card>
        <h2 className="font-semibold text-brand-dark">{t("addTitle")}</h2>
        <p className="mt-1 text-sm text-muted">{t("addDescription")}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PROVIDERS.map((p) => {
            const Icon = p.icon;
            return (
            <div
              key={p.type}
              className="flex flex-col justify-between rounded-lg border border-line bg-canvas p-4"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-white text-brand shadow-sm">
                    <Icon className="size-4" />
                  </span>
                  <span className="font-semibold text-brand-dark">{p.title}</span>
                  {conns.some((c) => c.type === p.type) && (
                    <Badge variant="success">{t("connectedBadge")}</Badge>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted">{t(p.descriptionKey as never)}</p>
              </div>
              <div className="mt-3">
                {p.type === "google" ? (
                  <Link
                    href="/api/connections/google/start"
                    className={buttonStyles("primary", "sm")}
                  >
                    {t("connectGoogle")}
                  </Link>
                ) : (
                  <Button size="sm" onClick={() => setFormMode(p.type as FormMode)}>
                    {t("add")}
                  </Button>
                )}
              </div>
            </div>
            );
          })}
        </div>

        {formMode && (
          <div className="mt-4">
            {(formMode === "smtp" || formMode === "imap") ? (
              <MailForm
                mode={formMode}
                onDone={async () => {
                  setFormMode(null);
                  await refresh();
                }}
              />
            ) : (
              <GenericForm
                mode={formMode}
                onDone={async () => {
                  setFormMode(null);
                  await refresh();
                }}
              />
            )}
          </div>
        )}
      </Card>

      {/* Mes connexions */}
      {!loading && conns.length > 0 && (
        <Card>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 className="font-semibold text-brand-dark">{t("myConnections")}</h2>
            <div className="relative ml-auto min-w-[180px] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("searchPlaceholder")}
                className="pl-9"
              />
            </div>
            <Select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as "all" | Conn["type"])}
              className="w-auto"
              aria-label={t("filterByType")}
            >
              <option value="all">{t("allTypes")}</option>
              {Object.keys(TYPE_LABEL).map((type) => (
                <option key={type} value={type}>
                  {TYPE_LABEL[type as Conn["type"]]}
                </option>
              ))}
            </Select>
            <Select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as "all" | Conn["status"])
              }
              className="w-auto"
              aria-label={t("filterByStatus")}
            >
              <option value="all">{t("allStatuses")}</option>
              <option value="active">{t("statusActive")}</option>
              <option value="error">{t("statusError")}</option>
              <option value="expired">{t("statusExpired")}</option>
            </Select>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={<Search className="size-6" />}
              title={t("noResultsTitle")}
              description={t("noResultsDescription")}
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch("");
                    setTypeFilter("all");
                    setStatusFilter("all");
                  }}
                >
                  {t("resetFilters")}
                </Button>
              }
            />
          ) : (
            <div className="space-y-2">
              {filtered.map((c) => (
                <ConnRow
                  key={c.id}
                  conn={c}
                  onTest={() => handleTest(c)}
                  onDelete={() => handleDelete(c)}
                  onRenamed={refresh}
                  onError={setError}
                />
              ))}
            </div>
          )}

          {activeFilters && filtered.length > 0 && (
            <p className="mt-3 text-xs text-muted">
              {t("resultCount", { count: filtered.length, total: conns.length })}
            </p>
          )}
        </Card>
      )}

      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      )}

      {!loading && conns.length === 0 && (
        <p className="text-sm text-muted">{t("empty")}</p>
      )}
    </div>
  );
}

function ConnRow({
  conn,
  onTest,
  onDelete,
  onRenamed,
  onError,
}: {
  conn: Conn;
  onTest: () => void;
  onDelete: () => void;
  onRenamed: () => void;
  onError: (message: string) => void;
}) {
  const t = useTranslations("connections");
  const tCommon = useTranslations("common");
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(conn.label);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!label.trim() || busy) return;
    setBusy(true);
    const res = await fetch(`/api/connections/${conn.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: label.trim() }),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (res.ok) {
      setEditing(false);
      await onRenamed();
    } else {
      onError(data?.error ?? t("renameError"));
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-canvas px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <Badge>{TYPE_LABEL[conn.type]}</Badge>
        {editing ? (
          <div className="flex items-center gap-2">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
                if (e.key === "Escape") {
                  setLabel(conn.label);
                  setEditing(false);
                }
              }}
              autoFocus
              className="w-48"
            />
            <Button size="sm" onClick={() => void save()} disabled={busy}>
              OK
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setLabel(conn.label);
                setEditing(false);
              }}
            >
              {tCommon("cancel")}
            </Button>
          </div>
        ) : (
          <span className="font-medium">{conn.label}</span>
        )}
        <Badge variant={STATUS_VARIANT[conn.status]}>{t(STATUS_KEY[conn.status])}</Badge>
        {conn.lastError && <span className="text-xs text-danger">{conn.lastError}</span>}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={onTest}>
          {t("test")}
        </Button>
        {!editing && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setLabel(conn.label);
              setEditing(true);
            }}
          >
            {t("rename")}
          </Button>
        )}
        <Button variant="danger" size="sm" onClick={onDelete}>
          {tCommon("delete")}
        </Button>
      </div>
    </div>
  );
}

/** Ports usuels : bascule automatique quand on (dé)coche TLS. */
const DEFAULT_PORTS: Record<"smtp" | "imap", { secure: string; plain: string }> = {
  smtp: { secure: "465", plain: "587" },
  imap: { secure: "993", plain: "143" },
};

function MailForm({
  mode,
  onDone,
}: {
  mode: Exclude<FormMode, null> & ("smtp" | "imap");
  onDone: () => void;
}) {
  const t = useTranslations("connections");
  const tCommon = useTranslations("common");
  const ports = DEFAULT_PORTS[mode];
  const [label, setLabel] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(ports.secure);
  const [secure, setSecure] = useState(true);
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [from, setFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const config: Record<string, unknown> = { host, port: Number(port), secure, user, pass };
    if (mode === "smtp" && from) config.from = from;
    const res = await fetch("/api/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: mode, label: label || mode.toUpperCase(), config }),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok) {
      onDone();
    } else {
      setError(data.error ?? t("createError"));
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-line p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("formName")}>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("formNamePlaceholder")} />
        </Field>
        <Field label={t("formHost")}>
          <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder={mode === "imap" ? "imap.hostinger.com" : "smtp.hostinger.com"} required />
        </Field>
        <Field label={t("formPort")}>
          <Input type="number" value={port} onChange={(e) => setPort(e.target.value)} required />
        </Field>
        <Field label={t("formSecurity")}>
          <label className="flex items-center gap-2 pt-2 text-sm">
            <input
              type="checkbox"
              checked={secure}
              onChange={(e) => {
                const next = e.target.checked;
                setSecure(next);
                // Suit le port usuel, sauf si l'utilisateur en a saisi un autre.
                setPort((current) =>
                  current === ports.secure || current === ports.plain
                    ? next
                      ? ports.secure
                      : ports.plain
                    : current,
                );
              }}
            />
            TLS / SSL
          </label>
        </Field>
        <Field label={t("formUser")}>
          <Input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="off" required />
        </Field>
        <Field label={t("formPassword")}>
          <Input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" required />
        </Field>
        {mode === "smtp" && (
          <Field label={t("formFrom")}>
            <Input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="moi@domaine.fr" />
          </Field>
        )}
      </div>
      {error && <Alert>{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "…" : t("formSubmit")}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {tCommon("cancel")}
        </Button>
      </div>
    </form>
  );
}

function GenericForm({
  mode,
  onDone,
}: {
  mode: Exclude<FormMode, null>;
  onDone: () => void;
}) {
  const t = useTranslations("connections");
  const tCommon = useTranslations("common");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // telegram
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  // notion
  const [apiKey, setApiKey] = useState("");
  // homeassistant
  const [baseUrl, setBaseUrl] = useState("");
  const [accessToken, setAccessToken] = useState("");
  // weather
  const [weatherKey, setWeatherKey] = useState("");
  const [city, setCity] = useState("");
  // webhook
  const [webhookUrl, setWebhookUrl] = useState("");
  const [secret, setSecret] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    let config: Record<string, unknown> = {};
    if (mode === "telegram") {
      if (!botToken.trim()) { setError(t("createError")); setBusy(false); return; }
      config = { botToken: botToken.trim(), defaultChatId: chatId.trim() || undefined };
    } else if (mode === "notion") {
      if (!apiKey.trim()) { setError(t("createError")); setBusy(false); return; }
      config = { apiKey: apiKey.trim() };
    } else if (mode === "homeassistant") {
      if (!baseUrl.trim() || !accessToken.trim()) { setError(t("createError")); setBusy(false); return; }
      config = { baseUrl: baseUrl.trim(), accessToken: accessToken.trim() };
    } else if (mode === "weather") {
      if (!weatherKey.trim()) { setError(t("createError")); setBusy(false); return; }
      config = { apiKey: weatherKey.trim(), defaultCity: city.trim() || undefined };
    } else if (mode === "webhook") {
      if (!webhookUrl.trim()) { setError(t("createError")); setBusy(false); return; }
      config = { url: webhookUrl.trim(), secret: secret.trim() || undefined };
    }
    const res = await fetch("/api/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: mode, label: label || TYPE_LABEL[mode as Conn["type"]], config }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) onDone();
    else setError((data as { error?: string }).error ?? t("createError"));
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-line p-4">
      <Field label={t("formName")}>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("formNamePlaceholder")} />
      </Field>

      {mode === "telegram" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Bot Token">
            <Input value={botToken} onChange={(e) => setBotToken(e.target.value)} placeholder="123456:ABC..." required />
          </Field>
          <Field label="Chat ID par défaut (optionnel)">
            <Input value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="-100123… ou 123456" />
          </Field>
          <p className="col-span-2 text-xs text-muted">Crée un bot via @BotFather, colle le token. Le chatId s&apos;obtient en envoyant un message au bot puis /api.</p>
        </div>
      )}

      {mode === "notion" && (
        <Field label="Notion API Key (secret_…)">
          <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="secret_…" required />
        </Field>
      )}

      {mode === "homeassistant" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Base URL">
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://ha.home.example.com" required />
          </Field>
          <Field label="Access Token (long-lived)">
            <Input type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} required />
          </Field>
        </div>
      )}

      {mode === "weather" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="OpenWeather API Key">
            <Input type="password" value={weatherKey} onChange={(e) => setWeatherKey(e.target.value)} placeholder="openweathermap key" required />
          </Field>
          <Field label="Ville par défaut (optionnel)">
            <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Paris" />
          </Field>
        </div>
      )}

      {mode === "webhook" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="URL">
            <Input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://n8n.example.com/webhook/…" required />
          </Field>
          <Field label="Secret (optionnel)">
            <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="X-Webhook-Secret" />
          </Field>
        </div>
      )}

      {error && <Alert>{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{busy ? "…" : t("formSubmit")}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>{tCommon("cancel")}</Button>
      </div>
    </form>
  );
}

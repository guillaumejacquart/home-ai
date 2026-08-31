"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Skeleton,
  TabPanel,
  useToast,
} from "@/components/ui";
import { UsersAdmin } from "@/components/UsersAdmin";
import { useAction } from "@/components/settings/shared";
import { api } from "@/lib/api-client";
import { useSession } from "@/lib/auth-client";
import { can } from "@/lib/rbac";
import { useResource } from "@/lib/use-resource";

interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export default function AccessSettingsPage() {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const toast = useToast();
  const { data: sessionData } = useSession();
  const canManageUsers = can(sessionData?.user?.role, "users.manage");
  const { data, loading, reload, setData } = useResource<ApiToken[]>("/api/tokens");
  const { pending, error, run } = useAction();

  const [newTokenName, setNewTokenName] = useState("");
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  const tokens = data ?? [];

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    void run(
      "create",
      async () => {
        const payload = await api.post<{ token: string }>("/api/tokens", {
          name: newTokenName.trim() || undefined,
        });
        setCreatedToken(payload.token);
        setNewTokenName("");
        void reload();
      },
      t("saveError"),
    );
  }

  function handleRevoke(id: string) {
    void run(
      `revoke:${id}`,
      async () => {
        await api.del(`/api/tokens/${id}`);
        setData(tokens.filter((tk) => tk.id !== id));
      },
      t("saveError"),
    );
  }

  const revokingId = pending?.startsWith("revoke:") ? pending.slice(7) : null;

  return (
    <TabPanel id="access" className="space-y-8">
      {error && <Alert>{error}</Alert>}

      {/* Personal access tokens */}
      <Card>
        <h2 className="font-semibold text-brand-dark">{t("tokensTitle")}</h2>
        <p className="mt-1 text-sm text-muted">{t("tokensDescription")}</p>

        {createdToken && (
          <Alert>
            <p className="font-semibold">{t("tokenCreatedTitle")}</p>
            <p className="mt-1">{t("tokenCreatedBody")}</p>
            <code className="mt-2 block break-all rounded bg-canvas p-2 font-mono text-xs">
              {createdToken}
            </code>
            <Button
              size="sm"
              variant="secondary"
              className="mt-3"
              onClick={() => {
                void navigator.clipboard.writeText(createdToken);
                setCreatedToken(null);
                toast(t("tokenCopied"));
              }}
            >
              {t("tokenCopy")}
            </Button>
          </Alert>
        )}

        <form onSubmit={handleCreate} className="mt-4 flex max-w-md items-end gap-2">
          <div className="flex-1">
            <Field label={t("tokenNameLabel")}>
              <Input
                value={newTokenName}
                onChange={(e) => setNewTokenName(e.target.value)}
                placeholder={t("tokenNamePlaceholder")}
              />
            </Field>
          </div>
          <Button type="submit" disabled={pending === "create"}>
            {pending === "create" ? tCommon("saving") : t("tokenCreate")}
          </Button>
        </form>

        <div className="mt-4 space-y-2">
          {loading ? (
            <Skeleton className="h-10" />
          ) : tokens.length === 0 ? (
            <p className="text-sm text-muted">{t("tokensEmpty")}</p>
          ) : (
            tokens.map((tk) => (
              <div
                key={tk.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-line bg-canvas px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{tk.name}</span>
                    <code className="font-mono text-xs text-muted">{tk.prefix}…</code>
                  </div>
                  <p className="text-xs text-muted">
                    {t("tokenCreatedAt", { date: new Date(tk.createdAt).toLocaleDateString() })}
                    {tk.lastUsedAt
                      ? ` · ${t("tokenLastUsed", { date: new Date(tk.lastUsedAt).toLocaleDateString() })}`
                      : ` · ${t("tokenNeverUsed")}`}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={revokingId === tk.id}
                  onClick={() => handleRevoke(tk.id)}
                >
                  {revokingId === tk.id ? "…" : t("tokenRevoke")}
                </Button>
              </div>
            ))
          )}
        </div>
      </Card>

      {canManageUsers && (
        <Card>
          <h2 className="font-semibold text-brand-dark">{t("tabMembers")}</h2>
          <div className="mt-4">
            <UsersAdmin />
          </div>
        </Card>
      )}
    </TabPanel>
  );
}

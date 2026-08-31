"use client";

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { Alert, Button, Field, Input, Select, Skeleton, useToast } from "@/components/ui";
import { api } from "@/lib/api-client";

type Invite = {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  createdAt: string;
};

export function InviteManager() {
  const t = useTranslations("users");
  const tRoles = useTranslations("roles");
  const format = useFormatter();
  const toast = useToast();

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ invitations: Invite[] }>("/api/invitations");
      setInvites(data.invitations ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("inviteError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      setError(t("inviteInvalidEmail"));
      return;
    }
    setCreating(true);
    setError(null);
    setCreatedLink(null);
    try {
      const data = await api.post<{ url: string }>("/api/invitations", { email: trimmed, role });
      setCreatedLink(data.url);
      setEmail("");
      toast(t("inviteCreated"));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("inviteError"));
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    setRevokingId(id);
    setError(null);
    try {
      await api.del(`/api/invitations/${id}`);
      setInvites((prev) => prev.filter((inv) => inv.id !== id));
      toast(t("inviteRevoked"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("inviteError"));
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t("invitesDescription")}</p>

      {error && <Alert>{error}</Alert>}

      {createdLink && (
        <Alert>
          <p className="font-semibold">{t("inviteLinkTitle")}</p>
          <p className="mt-1 text-sm">{t("inviteLinkBody")}</p>
          <code className="mt-2 block break-all rounded bg-canvas p-2 font-mono text-xs">{createdLink}</code>
          <Button
            size="sm"
            variant="secondary"
            className="mt-3"
            onClick={() => {
              void navigator.clipboard.writeText(createdLink);
              toast(t("inviteCopied"));
            }}
          >
            {t("inviteCopy")}
          </Button>
        </Alert>
      )}

      <form onSubmit={handleCreate} className="flex max-w-xl flex-wrap items-end gap-2">
        <div className="min-w-[200px] flex-1">
          <Field label={t("inviteEmailLabel")}>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("inviteEmailPlaceholder")}
              required
            />
          </Field>
        </div>
        <div className="w-36">
          <Field label={t("inviteRoleLabel")}>
            <Select value={role} onChange={(e) => setRole(e.target.value === "admin" ? "admin" : "user")}>
              <option value="user">{tRoles("user")}</option>
              <option value="admin">{tRoles("admin")}</option>
            </Select>
          </Field>
        </div>
        <Button type="submit" disabled={creating}>
          {creating ? t("inviteCreating") : t("inviteCreate")}
        </Button>
      </form>

      <div>
        {loading ? (
          <Skeleton className="h-12" />
        ) : invites.length === 0 ? (
          <p className="text-sm text-muted">{t("inviteEmpty")}</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {invites.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{inv.email}</p>
                  <p className="text-xs text-muted">
                    {tRoles(inv.role as "admin" | "user")} · {t("inviteExpiresAt", { date: format.dateTime(new Date(inv.expiresAt), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) })}
                  </p>
                </div>
                <Button size="sm" variant="ghost" disabled={revokingId === inv.id} onClick={() => void handleRevoke(inv.id)}>
                  {revokingId === inv.id ? "…" : t("inviteRevoke")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { Alert, Badge, Card, Select, Skeleton, useToast } from "@/components/ui";
import { authClient, useSession } from "@/lib/auth-client";
import { asRole } from "@/lib/rbac";

type Member = {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: Date | string;
};

export function UsersAdmin() {
  const t = useTranslations("users");
  const tRoles = useTranslations("roles");
  const format = useFormatter();
  const toast = useToast();
  const { data: sessionData } = useSession();
  const currentUserId = sessionData?.user?.id;

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data, error } = await authClient.admin.listUsers({
        query: { limit: 100, sortBy: "createdAt", sortDirection: "asc" },
      });
      if (!data) throw new Error(error?.message ?? t("loadError"));
      setMembers((data.users ?? []) as Member[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  async function setRole(userId: string, role: "admin" | "user") {
    setBusyId(userId);
    setError(null);
    try {
      const { error } = await authClient.admin.setRole({ userId, role });
      if (error) throw new Error(error.message ?? t("saveError"));
      toast(role === "admin" ? t("roleUpdatedAdmin") : t("roleUpdatedMember"));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveError"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t("intro")}</p>

      {error && <Alert>{error}</Alert>}

      <Card>
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : members.length === 0 ? (
          <p className="text-muted">{t("empty")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {members.map((m) => {
              const role = asRole(m.role);
              const isSelf = m.id === currentUserId;
              return (
                <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-ink">{m.name}</span>
                      {role && (
                        <Badge variant={role === "admin" ? "default" : "neutral"}>
                          {tRoles(role)}
                        </Badge>
                      )}
                    </div>
                    <p className="truncate text-sm text-muted">
                      {t("joinedOn", {
                        email: m.email,
                        date: format.dateTime(new Date(m.createdAt), {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        }),
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={m.role}
                      disabled={isSelf || busyId !== null}
                      onChange={(e) =>
                        void setRole(m.id, e.target.value === "admin" ? "admin" : "user")
                      }
                      aria-label={t("roleOf", { name: m.name })}
                      title={isSelf ? t("cannotChangeOwnRole") : undefined}
                      className="w-auto py-1.5 disabled:cursor-not-allowed disabled:bg-canvas disabled:text-muted"
                    >
                      <option value="user">{tRoles("user")}</option>
                      <option value="admin">{tRoles("admin")}</option>
                    </Select>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

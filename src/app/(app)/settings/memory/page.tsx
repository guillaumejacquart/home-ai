"use client";

import { useState } from "react";
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
import { useAction } from "@/components/settings/shared";
import { api } from "@/lib/api-client";
import { useResource } from "@/lib/use-resource";

type MemoryKind = "fact" | "preference" | "project";

interface MemoryRow {
  id: string;
  kind: MemoryKind;
  content: string;
  source: "auto" | "assistant" | "user";
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

/** `fact` → `memoryKindFact` (existing i18n keys). */
function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function MemorySettingsPage() {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const toast = useToast();
  const { data, loading, reload, setData } = useResource<MemoryRow[]>("/api/assistant/memory");
  const { pending, error, run } = useAction();

  const [newContent, setNewContent] = useState("");
  const [newKind, setNewKind] = useState<MemoryKind>("fact");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [editingKind, setEditingKind] = useState<MemoryKind>("fact");

  const memories = data ?? [];

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const content = newContent.trim();
    if (!content) return;
    void run(
      "create",
      async () => {
        await api.post("/api/assistant/memory", { content, kind: newKind });
        setNewContent("");
        toast(t("memoryAdded"));
        void reload();
      },
      t("memoryError"),
    );
  }

  function handleDelete(id: string) {
    void run(
      `delete:${id}`,
      async () => {
        await api.del(`/api/assistant/memory/${id}`);
        setData(memories.filter((m) => m.id !== id));
        toast(t("memoryDeleted"));
      },
      t("memoryError"),
    );
  }

  function handleUpdate(id: string) {
    const content = editingContent.trim();
    if (!content) return;
    void run(
      `update:${id}`,
      async () => {
        await api.patch(`/api/assistant/memory/${id}`, { content, kind: editingKind });
        setEditingId(null);
        toast(t("memoryUpdated"));
        void reload();
      },
      t("memoryError"),
    );
  }

  function handleTogglePin(m: MemoryRow) {
    void run(
      `pin:${m.id}`,
      async () => {
        await api.patch(`/api/assistant/memory/${m.id}`, { pinned: !m.pinned });
        void reload();
      },
      t("memoryError"),
    );
  }

  return (
    <TabPanel id="memory" className="space-y-8">
      {error && <Alert>{error}</Alert>}

      <Card>
        <h2 className="font-semibold text-brand-dark">{t("memoryTitle")}</h2>
        <p className="mt-1 text-sm text-muted">{t("memoryDescription")}</p>

        <form onSubmit={handleCreate} className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="w-36 shrink-0">
            <Field label={t("memoryAdd")}>
              <Select value={newKind} onChange={(e) => setNewKind(e.target.value as MemoryKind)}>
                <option value="fact">{t("memoryKindFact")}</option>
                <option value="preference">{t("memoryKindPreference")}</option>
                <option value="project">{t("memoryKindProject")}</option>
              </Select>
            </Field>
          </div>
          <div className="flex-1">
            <Field label={t("memoryAdd")}>
              <Input
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder={t("memoryAddPlaceholder")}
              />
            </Field>
          </div>
          <Button type="submit" disabled={pending === "create" || !newContent.trim()}>
            {pending === "create" ? tCommon("saving") : t("memoryAdd")}
          </Button>
        </form>

        <div className="mt-4 space-y-2">
          {loading ? (
            <Skeleton className="h-10" />
          ) : memories.length === 0 ? (
            <p className="text-sm text-muted">{t("memoryEmpty")}</p>
          ) : (
            memories.map((m) => (
              <div
                key={m.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-line bg-canvas px-3 py-2"
              >
                {editingId === m.id ? (
                  <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-end">
                    <div className="w-32 shrink-0">
                      <Select
                        value={editingKind}
                        onChange={(e) => setEditingKind(e.target.value as MemoryKind)}
                      >
                        <option value="fact">{t("memoryKindFact")}</option>
                        <option value="preference">{t("memoryKindPreference")}</option>
                        <option value="project">{t("memoryKindProject")}</option>
                      </Select>
                    </div>
                    <Input
                      value={editingContent}
                      onChange={(e) => setEditingContent(e.target.value)}
                      className="flex-1"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => handleUpdate(m.id)}>
                        {tCommon("save")}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                        {tCommon("cancel")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={m.pinned ? "success" : "neutral"}>
                          {t(`memoryKind${capitalize(m.kind)}` as never)}
                        </Badge>
                        <span className="text-xs text-muted">
                          {t(`memorySource${capitalize(m.source)}` as never)}
                        </span>
                        {m.pinned && (
                          <span className="text-xs font-medium text-success">
                            · {t("memoryPinned")}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm">{m.content}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleTogglePin(m)}
                        title={t("memoryPinned")}
                      >
                        {m.pinned ? "★" : "☆"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingId(m.id);
                          setEditingContent(m.content);
                          setEditingKind(m.kind);
                        }}
                      >
                        {t("memoryEdit")}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(m.id)}>
                        {t("memoryDelete")}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </Card>
    </TabPanel>
  );
}

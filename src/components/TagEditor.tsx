"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { MAX_TAGS, normalizeTag } from "@/lib/tags";

/**
 * Édition d'étiquettes. Une étiquette n'est ajoutée que sur Entrée ou virgule —
 * jamais au blur, pour ne pas créer un tag à moitié tapé quand on clique
 * ailleurs. Même limite (`MAX_TAGS`) que celle appliquée côté serveur.
 */
export function TagEditor({
  tags,
  onChange,
  size = "md",
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  size?: "sm" | "md";
}) {
  const t = useTranslations("tags");
  const [draft, setDraft] = useState("");

  function addTag(raw: string) {
    const tag = normalizeTag(raw);
    if (!tag || tags.includes(tag) || tags.length >= MAX_TAGS) return;
    onChange([...tags, tag]);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(draft);
      setDraft("");
    } else if (e.key === "Backspace" && draft === "" && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  }

  const small = size === "sm";

  return (
    <div className={`flex flex-wrap items-center ${small ? "gap-1" : "gap-2"}`}>
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-full bg-brand-light px-2 py-0.5 text-xs font-medium text-brand-dark"
        >
          #{tag}
          <button
            type="button"
            onClick={() => onChange(tags.filter((x) => x !== tag))}
            className="text-brand/60 transition hover:text-danger focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-danger"
            aria-label={t("remove", { tag })}
          >
            ×
          </button>
        </span>
      ))}
      {tags.length < MAX_TAGS && (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={small ? t("placeholderSm") : t("placeholder")}
          aria-label={t("addLabel")}
          className={`rounded-full border border-dashed border-line bg-transparent py-0.5 text-xs outline-none transition focus:border-brand ${
            small ? "w-16 px-2" : "w-28 px-3"
          }`}
        />
      )}
    </div>
  );
}

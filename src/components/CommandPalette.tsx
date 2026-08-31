"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clock, Database, Grid3X3, LayoutTemplate, PlugZap, Puzzle, Search, Settings, Sparkles } from "lucide-react";

type PaletteItem = {
  id: string;
  label: string;
  description?: string;
  href?: string;
  action?: () => void;
  icon: React.ComponentType<{ className?: string }>;
  group: string;
};

const NAV_GROUPS: { label: string; items: PaletteItem[] }[] = [
  {
    label: "Créer",
    items: [
      { id: "nav-apps", label: "Apps", href: "/apps", icon: Puzzle, group: "Créer" },
      { id: "nav-scripts", label: "Scripts", href: "/scripts", icon: Clock, group: "Créer" },
      { id: "nav-dashboards", label: "Tableaux", href: "/dashboards", icon: Grid3X3, group: "Créer" },
    ],
  },
  {
    label: "Données",
    items: [
      { id: "nav-connections", label: "Connexions", href: "/connections", icon: PlugZap, group: "Données" },
      { id: "nav-storage", label: "Stockage", href: "/storage", icon: Database, group: "Données" },
    ],
  },
  {
    label: "Système",
    items: [{ id: "nav-settings", label: "Paramètres", href: "/settings", icon: Settings, group: "Système" }],
  },
];

function normalize(s: string) {
  return s.toLowerCase().trim();
}

function matches(text: string, query: string) {
  if (!query) return true;
  const q = normalize(query).split(/\s+/).filter(Boolean);
  const t = normalize(text);
  return q.every((word) => t.includes(word));
}

export function CommandPalette({
  open,
  onClose,
  onAskAssistant,
}: {
  open: boolean;
  onClose: () => void;
  onAskAssistant: (query: string) => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [apps, setApps] = useState<{ id: string; slug: string; name: string; description?: string | null }[]>([]);
  const [scripts, setScripts] = useState<{ id: string; name: string; schedule: string }[]>([]);
  const [dashboards, setDashboards] = useState<{ id: string; slug: string; name: string; description?: string | null }[]>([]);
  const [templates, setTemplates] = useState<{ slug: string; name: string; description?: string; installed?: boolean }[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery("");
    setActiveIndex(0);
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    // fetch in parallel, best-effort
    fetch("/api/apps").then((r) => (r.ok ? r.json() : [])).then((d) => setApps(Array.isArray(d) ? d : [])).catch(() => {});
    fetch("/api/scripts").then((r) => (r.ok ? r.json() : [])).then((d) => setScripts(Array.isArray(d) ? d : [])).catch(() => {});
    fetch("/api/dashboards").then((r) => (r.ok ? r.json() : [])).then((d) => setDashboards(Array.isArray(d) ? d : [])).catch(() => {});
    fetch("/api/templates").then((r) => (r.ok ? r.json() : [])).then((d) => setTemplates(Array.isArray(d) ? d : [])).catch(() => {});
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filteredNavGroups = useMemo(
    () =>
      NAV_GROUPS.map((group) => ({
        title: group.label,
        items: group.items.filter((i) => matches(`${i.label} ${i.description ?? ""}`, query)),
      })).filter((group) => group.items.length > 0),
    [query],
  );

  const filteredApps = useMemo(
    () => apps.filter((a) => matches(`${a.name} ${a.slug} ${a.description ?? ""}`, query)).slice(0, 6),
    [apps, query],
  );
  const filteredScripts = useMemo(
    () => scripts.filter((c) => matches(`${c.name} ${c.schedule}`, query)).slice(0, 5),
    [scripts, query],
  );
  const filteredDashboards = useMemo(
    () => dashboards.filter((d) => matches(`${d.name} ${d.slug} ${d.description ?? ""}`, query)).slice(0, 5),
    [dashboards, query],
  );
  const filteredTemplates = useMemo(
    () => templates.filter((t) => matches(`${t.name} ${t.slug} ${t.description ?? ""}`, query)).slice(0, 4),
    [templates, query],
  );

  const sections: { title: string; items: PaletteItem[] }[] = useMemo(() => {
    const q = query.trim();
    const askItem: PaletteItem | null = q
      ? {
          id: "ask-assistant",
          label: `Demander à l'assistant : "${q.slice(0, 60)}"`,
          description: "Ouvre le drawer et envoie la requête",
          icon: Sparkles,
          group: "Assistant",
          action: () => {
            onAskAssistant(q);
            onClose();
          },
        }
      : null;
    const out: { title: string; items: PaletteItem[] }[] = [];
    if (askItem) out.push({ title: "Assistant", items: [askItem] });
    out.push(...filteredNavGroups);
    if (filteredApps.length)
      out.push({
        title: "Apps",
        items: filteredApps.map((a) => ({
          id: `app-${a.id}`,
          label: a.name,
          description: a.slug ? `/a/${a.slug}` : a.id,
          href: `/apps/${a.id}`,
          icon: Puzzle,
          group: "Apps",
        })),
      });
    if (filteredScripts.length)
      out.push({
        title: "Scripts",
        items: filteredScripts.map((c) => ({
          id: `script-${c.id}`,
          label: c.name,
          description: c.schedule,
          href: `/scripts`,
          icon: Clock,
          group: "Scripts",
        })),
      });
    if (filteredDashboards.length)
      out.push({
        title: "Tableaux",
        items: filteredDashboards.map((d) => ({
          id: `dash-${d.id}`,
          label: d.name,
          description: d.slug,
          href: `/dashboards/${d.id}`,
          icon: Grid3X3,
          group: "Tableaux",
        })),
      });
    if (filteredTemplates.length)
      out.push({
        title: "Modèles",
        items: filteredTemplates.map((t) => ({
          id: `tpl-${t.slug}`,
          label: t.name,
          description: t.installed ? `${t.description ?? t.slug} · installé` : (t.description ?? t.slug),
          href: `/apps`,
          icon: LayoutTemplate,
          group: "Modèles",
        })),
      });
    return out;
  }, [query, onAskAssistant, onClose, filteredNavGroups, filteredApps, filteredScripts, filteredDashboards, filteredTemplates]);

  const flatItems = useMemo(() => sections.flatMap((s) => s.items), [sections]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveIndex(0);
  }, [query]);

  function handleNavigate(item: PaletteItem) {
    if (item.action) {
      item.action();
      return;
    }
    if (item.href) {
      onClose();
      router.push(item.href);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flatItems[activeIndex];
      if (item) handleNavigate(item);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 px-4 pt-[12vh] backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-line bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Palette de commandes"
      >
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <Search className="size-4 shrink-0 text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Rechercher apps, scripts, tableaux… ou demander à l'assistant"
            className="flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-muted"
            autoComplete="off"
          />
          <span className="hidden rounded border border-line bg-canvas px-1.5 py-0.5 font-mono text-xs text-muted sm:inline">Échap</span>
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-2">
          {flatItems.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted">
              Aucun résultat. Essaie une autre recherche ou <button className="font-semibold text-brand hover:underline" onClick={() => query.trim() && (() => { onAskAssistant(query.trim()); onClose(); })()}>demande à l&apos;assistant</button>.
            </p>
          ) : (
            sections.map((section) => (
              <div key={section.title} className="mb-2 last:mb-0">
                <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted">{section.title}</p>
                <ul className="space-y-0.5">
                  {section.items.map((item) => {
                    const globalIndex = flatItems.indexOf(item);
                    const active = globalIndex === activeIndex;
                    const Icon = item.icon;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => handleNavigate(item)}
                          onMouseEnter={() => setActiveIndex(globalIndex)}
                          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition ${active ? "bg-brand-light text-brand-dark" : "text-ink hover:bg-canvas"}`}
                        >
                          <span className={`flex size-7 shrink-0 items-center justify-center rounded-md ${active ? "bg-brand text-white" : "bg-canvas text-muted"}`}>
                            <Icon className="size-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{item.label}</span>
                            {item.description && <span className="block truncate text-xs text-muted">{item.description}</span>}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-line bg-canvas px-3 py-2 text-xs text-muted">
          <span className="flex items-center gap-2">
            <span className="hidden sm:inline">↑↓ pour naviguer · Entrée pour ouvrir · </span>Échap pour fermer
          </span>
          <Link href="/assistant" onClick={onClose} className="font-semibold text-brand hover:underline">
            Ouvrir l&apos;assistant →
          </Link>
        </div>
      </div>
    </div>
  );
}

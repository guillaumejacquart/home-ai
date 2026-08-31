"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Bot,
  ChevronDown,
  Clock,
  Database,
  Grid3X3,
  LayoutDashboard,
  LogOut,
  Menu,
  Network,
  PlugZap,
  Puzzle,
  Search,
  Settings,
  Sparkles,
  X,
} from "lucide-react";

import { signOut, useSession } from "@/lib/auth-client";
import { buttonStyles, ConfirmProvider, ToastProvider } from "@/components/ui";
import { can } from "@/lib/rbac";
import { AssistantOverlay } from "@/components/agent/Overlay";
import { CommandPalette } from "@/components/CommandPalette";
import { AgentContextProvider, type AgentScope } from "@/components/agent/AgentContext";

type NavItem = {
  href: string;
  labelKey: "dashboards" | "apps" | "scripts" | "connections" | "storage" | "settings" | "state";
  icon: typeof LayoutDashboard;
  permission?: "users.manage";
};

const NAV_GROUPS: {
  labelKey: "create" | "data" | "system";
  items: readonly NavItem[];
}[] = [
  {
    labelKey: "create",
    items: [
      { href: "/apps", labelKey: "apps", icon: Puzzle },
      { href: "/scripts", labelKey: "scripts", icon: Clock },
      { href: "/dashboards", labelKey: "dashboards", icon: Grid3X3 },
    ],
  },
  {
    labelKey: "data",
    items: [
      { href: "/connections", labelKey: "connections", icon: PlugZap },
      { href: "/storage", labelKey: "storage", icon: Database },
      { href: "/state", labelKey: "state", icon: Network },
    ],
  },
  {
    labelKey: "system",
    items: [{ href: "/settings", labelKey: "settings", icon: Settings }],
  },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

type ResolvedNavItem = NavItem & { label: string };

function NavDropdown({
  label,
  items,
  pathname,
  onNavigate,
}: {
  label: string;
  items: readonly ResolvedNavItem[];
  pathname: string;
  onNavigate: () => void;
}) {
  const [open, setOpen] = useState(false);

  if (items.length === 1) {
    const item = items[0];
    const Icon = item.icon;
    const active = isActive(pathname, item.href);
    return (
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        onClick={onNavigate}
        className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 ${
          active
            ? "bg-brand-light text-brand-dark"
            : "text-muted hover:bg-brand-light/70 hover:text-ink"
        }`}
      >
        <Icon className="size-4" />
        {item.label}
      </Link>
    );
  }

  const groupActive = items.some((item) => isActive(pathname, item.href));

  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 ${
          groupActive || open
            ? "bg-brand-light text-brand-dark"
            : "text-muted hover:bg-brand-light/70 hover:text-ink"
        }`}
      >
        {label}
        <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 pt-1">
          <div
            role="menu"
            className="min-w-44 rounded-xl border border-line bg-white p-1 shadow-lg"
          >
          {items.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  setOpen(false);
                  onNavigate();
                }}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-brand-light text-brand-dark"
                    : "text-muted hover:bg-brand-light/70 hover:text-ink"
                }`}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
          </div>
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const router = useRouter();
  const { data: sessionData } = useSession();
  const role = sessionData?.user?.role;
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerQuery, setDrawerQuery] = useState<string | null>(null);
  const [drawerScope, setDrawerScope] = useState<AgentScope | null>(null);

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    label: t(group.labelKey),
    items: group.items
      .filter((item) => !item.permission || can(role, item.permission))
      .map((item) => ({ ...item, label: t(item.labelKey) })),
  })).filter((group) => group.items.length > 0);

  async function handleSignOut() {
    await signOut();
    router.push("/login");
    router.refresh();
  }

  function handleAskAssistant(query: string) {
    setDrawerQuery(query);
    setDrawerScope(null);
    setDrawerOpen(true);
  }

  function openAssistant(scope?: AgentScope | null, query?: string | null) {
    if (scope !== undefined) setDrawerScope(scope ?? null);
    if (query !== undefined) setDrawerQuery(query ?? null);
    setDrawerOpen(true);
  }

  function closeAssistant() {
    setDrawerOpen(false);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
      if (mod && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setDrawerOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <AgentContextProvider value={{ openAssistant, closeAssistant }}>
      <ToastProvider>
        <ConfirmProvider>
          <div className="min-h-screen">
          <a
            href="#contenu"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
          >
            {t("skipToContent")}
          </a>

          <nav className="sticky top-0 z-20 border-b border-line bg-white/80 backdrop-blur-md">
            <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6 md:gap-6">
              <Link href="/" className="flex shrink-0 items-center gap-2.5">
                <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-accent text-white shadow-sm">
                  <Sparkles className="size-4" />
                </span>
                <span className="font-bold tracking-tight text-brand-dark">
                  Home&nbsp;AI
                </span>
              </Link>

              {/* Navigation large écran */}
              <div className="hidden flex-1 items-center md:flex">
                {visibleGroups.map((group, gi) => (
                  <div
                    key={group.labelKey}
                    className={`flex items-center ${gi > 0 ? "ml-2 border-l border-line pl-2" : ""}`}
                  >
                    <NavDropdown
                      label={group.label}
                      items={group.items}
                      pathname={pathname}
                      onNavigate={() => setMenuOpen(false)}
                    />
                  </div>
                ))}
              </div>
              {/* Raccourcis globaux */}
              <div className="ml-auto hidden items-center gap-1 md:flex">
                <button
                  type="button"
                  onClick={() => setPaletteOpen(true)}
                  className={`${buttonStyles("ghost", "sm")} gap-1.5`}
                  aria-label="Palette de commandes"
                  title="Palette (⌘K)"
                >
                  <Search className="size-4" />
                  <span className="hidden lg:inline">Rechercher</span>
                  <span className="hidden rounded border border-line bg-canvas px-1 py-0.5 font-mono text-xs text-muted lg:inline">⌘K</span>
                </button>
                <Link href="/assistant" className={`${buttonStyles("ghost", "sm")} gap-1.5`}>
                  <Bot className="size-4" />
                  <span className="hidden lg:inline">Assistant</span>
                </Link>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  className={`${buttonStyles("ghost", "sm")} gap-1.5`}
                  aria-label="Assistant rapide"
                  title="Assistant rapide (⌘J)"
                >
                  <Sparkles className="size-4" />
                  <span className="hidden rounded border border-line bg-canvas px-1 py-0.5 font-mono text-xs text-muted lg:inline">⌘J</span>
                </button>
              </div>
              <div className="hidden md:block">
                <button className={buttonStyles("ghost", "sm")} onClick={handleSignOut}>
                  <LogOut className="size-4" />
                  {t("signOut")}
                </button>
              </div>

              {/* Actions mobiles + bascule du menu */}
              <div className="ml-auto flex items-center gap-1 md:hidden">
                <button
                  type="button"
                  onClick={() => setPaletteOpen(true)}
                  aria-label="Rechercher"
                  className={`${buttonStyles("ghost", "sm")} px-2`}
                >
                  <Search className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  aria-label="Assistant"
                  className={`${buttonStyles("ghost", "sm")} px-2`}
                >
                  <Bot className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-expanded={menuOpen}
                  aria-controls="menu-mobile"
                  aria-label={menuOpen ? t("closeMenu") : t("openMenu")}
                  className={`${buttonStyles("ghost", "sm")} px-2`}
                >
                  {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
                </button>
              </div>
            </div>

            {/* Navigation mobile */}
            {menuOpen && (
              <div id="menu-mobile" className="border-t border-line bg-white md:hidden">
                <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3">
                  {visibleGroups.map((group) => (
                    <div key={group.labelKey} className="space-y-1">
                      <p className="px-3 pt-2 text-xs font-semibold uppercase tracking-wide text-muted">
                        {t(group.labelKey)}
                      </p>
                      {group.items.map((item) => {
                        const active = isActive(pathname, item.href);
                        const Icon = item.icon;
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            aria-current={active ? "page" : undefined}
                            onClick={() => setMenuOpen(false)}
                            className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                              active
                                ? "bg-brand-light text-brand-dark"
                                : "text-muted hover:bg-brand-light/70 hover:text-ink"
                            }`}
                          >
                            <Icon className="size-4" />
                            {t(item.labelKey)}
                          </Link>
                        );
                      })}
                    </div>
                  ))}
                  <button
                    className={`${buttonStyles("ghost", "sm")} mt-1 justify-start`}
                    onClick={handleSignOut}
                  >
                    <LogOut className="size-4" />
                    {t("signOut")}
                  </button>
                </div>
              </div>
            )}
          </nav>

          <main id="contenu" className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
            {children}
          </main>

          <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onAskAssistant={handleAskAssistant} />
          <AssistantOverlay
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            initialQuery={drawerQuery}
            onInitialQueryConsumed={() => setDrawerQuery(null)}
            scope={drawerScope}
            onScopeConsumed={() => setDrawerScope(null)}
          />
        </div>
      </ConfirmProvider>
    </ToastProvider>
    </AgentContextProvider>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";

import { AppFrame } from "@/components/AppFrame";
import { buildAppDocument } from "@/lib/app-runtime";
import { requireUser } from "@/lib/session";
import { getAppBySlug } from "@/services/apps/apps";
import { currentHtml } from "@/services/apps/versions";

export default async function AppRuntimePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");

  const { slug } = await params;
  const app = await getAppBySlug(user.id, slug);
  if (!app) redirect("/");

  const html = await currentHtml(app.id);
  if (!html) redirect("/");

  const doc = buildAppDocument(html, app.id);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-white/80 px-4 py-2 backdrop-blur-md">
        <Link
          href="/apps"
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-muted transition hover:bg-brand-light hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
        >
          <ArrowLeft className="size-4" />
          <span className="hidden sm:inline">Mes apps</span>
        </Link>
        <span className="min-w-0 flex-1 truncate font-semibold text-brand-dark">
          {app.name}
        </span>
        <Link
          href={`/apps/${app.id}`}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold text-brand transition hover:bg-brand-light hover:text-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
        >
          <Pencil className="size-4" />
          <span className="hidden sm:inline">Modifier</span>
        </Link>
      </header>
      <div className="min-h-0 flex-1 bg-white">
        <AppFrame appId={app.id} document={doc} />
      </div>
    </div>
  );
}

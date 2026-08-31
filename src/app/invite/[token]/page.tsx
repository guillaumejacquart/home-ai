import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Alert, Card } from "@/components/ui";
import { AuthForm } from "@/components/AuthForm";
import { getSession } from "@/lib/session";
import { validateInvitation } from "@/services/invitations/service";

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ email?: string }>;
}) {
  const t = await getTranslations("auth");
  const session = await getSession();
  if (session) redirect("/");

  const { token } = await params;
  const { email } = await searchParams;
  const normalizedEmail = email?.trim().toLowerCase() ?? "";

  if (!token || !normalizedEmail) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-accent text-white shadow-md">
            <Sparkles className="size-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-brand-dark">{t("createAccount")}</h1>
            <p className="mt-1 text-sm text-muted">{t("inviteSubtitle")}</p>
          </div>
        </div>
        <Card>
          <Alert>{t("invalidInvite")}</Alert>
        </Card>
      </main>
    );
  }

  const invite = await validateInvitation(normalizedEmail, token);
  if (!invite) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-accent text-white shadow-md">
            <Sparkles className="size-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-brand-dark">{t("createAccount")}</h1>
            <p className="mt-1 text-sm text-muted">{t("inviteSubtitle")}</p>
          </div>
        </div>
        <Card>
          <Alert>{t("invalidInvite")}</Alert>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <div className="mb-6 flex flex-col items-center gap-3 text-center">
        <span className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-accent text-white shadow-md">
          <Sparkles className="size-6" />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-brand-dark">{t("createAccount")}</h1>
          <p className="mt-1 text-sm text-muted">{t("inviteSubtitle")}</p>
        </div>
      </div>
      <Card>
        <AuthForm mode="signup" defaultEmail={normalizedEmail} inviteToken={token} />
      </Card>
    </main>
  );
}

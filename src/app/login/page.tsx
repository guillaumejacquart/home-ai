import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Card } from "@/components/ui";
import { AuthForm } from "@/components/AuthForm";
import { getSession } from "@/lib/session";

export default async function LoginPage() {
  const t = await getTranslations("auth");
  const session = await getSession();
  if (session) {
    redirect("/");
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <div className="mb-6 flex flex-col items-center gap-3 text-center">
        <span className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-accent text-white shadow-md">
          <Sparkles className="size-6" />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-brand-dark">Home AI</h1>
          <p className="mt-1 text-sm text-muted">{t("loginSubtitle")}</p>
        </div>
      </div>
      <Card>
        <AuthForm mode="login" />
      </Card>
    </main>
  );
}
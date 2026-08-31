"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { signIn, signUp } from "@/lib/auth-client";
import { Button, Field, Input } from "@/components/ui";

type Mode = "login" | "signup";

export function AuthForm({
  mode,
  redirectTo = "/",
  defaultEmail = "",
  inviteToken,
}: {
  mode: Mode;
  redirectTo?: string;
  defaultEmail?: string;
  inviteToken?: string;
}) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isSignup = mode === "signup";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = isSignup
        ? await signUp.email({
            name,
            email,
            password,
            ...(inviteToken ? { inviteToken } : {}),
          } as Parameters<typeof signUp.email>[0])
        : await signIn.email({ email, password });
      if (res.error) {
        const raw = res.error.message ?? "";
        const mapped =
          raw === "signupDisabled"
            ? t("signupDisabledDescription")
            : raw === "invalidInvite"
              ? t("invalidInvite")
              : raw;
        setError(mapped || t("genericError"));
        return;
      }
      router.push(redirectTo);
      router.refresh();
    } catch {
      setError(t("serverUnreachable"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {isSignup && (
        <Field label={t("name")}>
          <Input
            type="text"
            value={name}
            autoComplete="name"
            required
            onChange={(e) => setName(e.target.value)}
            className="w-full"
          />
        </Field>
      )}
      <Field label={t("email")}>
        <Input
          type="email"
          value={email}
          autoComplete="email"
          required
          onChange={(e) => setEmail(e.target.value)}
          className="w-full"
        />
      </Field>
      <Field label={t("password")}>
        <Input
          type="password"
          value={password}
          autoComplete={isSignup ? "new-password" : "current-password"}
          required
          onChange={(e) => setPassword(e.target.value)}
          className="w-full"
        />
      </Field>

      {error && <p className="text-sm font-medium text-danger">{error}</p>}

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "…" : isSignup ? t("createMyAccount") : t("signIn")}
      </Button>

      <p className="text-center text-sm text-muted">
        {isSignup ? (
          <>
            {t("alreadyHaveAccount")}{" "}
            <Link href="/login" className="font-semibold text-brand">
              {t("signIn")}
            </Link>
          </>
        ) : (
          <>
            {t("noAccountYet")}{" "}
            <Link href="/signup" className="font-semibold text-brand">
              {t("createAccount")}
            </Link>
          </>
        )}
      </p>
    </form>
  );
}

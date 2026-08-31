"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { StorageKeyEditor } from "@/components/storage/StorageKeyEditor";
import { Alert } from "@/components/ui";

type Scope = "app" | "global" | "script";

function isScope(v: string | null): v is Scope {
  return v === "app" || v === "global" || v === "script";
}

export function StorageEditClient() {
  const searchParams = useSearchParams();
  const t = useTranslations("storageExplorer");
  const tCommon = useTranslations("common");

  const scopeParam = searchParams.get("scope");
  const keyParam = searchParams.get("key");
  const appId = searchParams.get("appId");
  const scriptId = searchParams.get("scriptId");
  const returnTo = searchParams.get("returnTo");

  const scope: Scope | null = useMemo(() => {
    if (isScope(scopeParam)) return scopeParam;
    // Infer from ids if scope missing
    if (appId) return "app";
    if (scriptId) return "script";
    return "global";
  }, [scopeParam, appId, scriptId]);

  const backHref = useMemo(() => {
    if (returnTo) return returnTo;
    if (scope === "app" && appId) return `/storage?view=${encodeURIComponent(`app:${appId}`)}`;
    if (scope === "script" && scriptId) return `/storage?view=${encodeURIComponent(`script:${scriptId}`)}`;
    if (scope === "global") return "/storage?view=global";
    return "/storage";
  }, [returnTo, scope, appId, scriptId]);

  if (!keyParam || !scope) {
    return <Alert variant="danger">{t("noResults")}</Alert>;
  }

  if (scope === "app" && !appId) {
    return <Alert variant="danger">{tCommon("unknownError")}</Alert>;
  }
  if (scope === "script" && !scriptId) {
    return <Alert variant="danger">{tCommon("unknownError")}</Alert>;
  }

  return (
    <StorageKeyEditor
      scope={scope}
      storageKey={keyParam}
      appId={appId}
      scriptId={scriptId}
      backHref={backHref}
    />
  );
}

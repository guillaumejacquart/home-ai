import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import {
  defaultLocale,
  isLocale,
  LOCALE_COOKIE,
  localeFromAcceptLanguage,
  type Locale,
} from "./config";

/**
 * Préférence enregistrée en base. Consultée seulement quand le cookie manque
 * (nouveau navigateur) : le cookie évite cette requête sur les rendus suivants.
 * Silencieuse en cas d'échec — la langue ne doit jamais casser un rendu.
 */
async function storedLocale(): Promise<Locale | null> {
  try {
    const { getSession } = await import("@/lib/session");
    const session = await getSession();
    if (!session?.user) return null;
    const { getUserSettings } = await import("@/services/llm/settings");
    return (await getUserSettings(session.user.id)).locale;
  } catch {
    return null;
  }
}

/**
 * Pas de préfixe de langue dans l'URL : la locale vient du cookie (posé depuis
 * les paramètres), sinon de la préférence en base, sinon de l'en-tête
 * Accept-Language du navigateur.
 */
export default getRequestConfig(async () => {
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookieLocale)
    ? cookieLocale
    : ((await storedLocale()) ??
      localeFromAcceptLanguage((await headers()).get("accept-language")) ??
      defaultLocale);

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});

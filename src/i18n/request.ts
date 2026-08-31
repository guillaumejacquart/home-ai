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
 * Preference stored in the database. Only consulted when the cookie is
 * missing (new browser) — the cookie avoids this query on later renders.
 * Silent on failure: locale resolution must never break a render.
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
 * No language prefix in the URL: locale comes from the cookie (set from
 * settings), otherwise the database preference, otherwise the browser's
 * Accept-Language header.
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

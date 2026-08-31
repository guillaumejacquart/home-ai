import type fr from "../messages/fr.json";
import type { Locale } from "./i18n/config";

// Rend `t("…")` typé : une clé absente de messages/fr.json échoue au typecheck.
declare module "next-intl" {
  interface AppConfig {
    Messages: typeof fr;
    Locale: Locale;
  }
}

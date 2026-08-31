import type fr from "../messages/fr.json";
import type { Locale } from "./i18n/config";

// Makes `t("…")` type-safe: a key missing from messages/fr.json fails the typecheck.
declare module "next-intl" {
  interface AppConfig {
    Messages: typeof fr;
    Locale: Locale;
  }
}

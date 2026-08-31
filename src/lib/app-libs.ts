/**
 * Bibliothèques injectées dans le document de toute app générée.
 *
 * Source unique, sans dépendance : les balises servies (`buildAppDocument`, les
 * aperçus) et la description donnée aux LLM sortent d'ici. Ajouter une lib =
 * une entrée, et le prompt suit automatiquement.
 */

export interface InjectedLib {
  label: string;
  /** Comment le code généré s'en sert — repris tel quel dans les prompts. */
  usage: string;
  src: string;
  defer?: boolean;
}

export const INJECTED_LIBS: InjectedLib[] = [
  {
    label: "Tailwind CSS 4",
    usage: "classes utilitaires, disponibles directement",
    src: "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4",
  },
  {
    label: "Alpine.js 3",
    usage: "attributs x-data, x-for, x-model, x-on, x-text, x-show",
    src: "https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js",
    defer: true,
  },
  {
    label: "Chart.js 4",
    usage: "global `Chart` (UMD), sans import",
    src: "https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js",
  },
];

/** Balises <script> à injecter dans le <head> du document d'app. */
export function injectedLibTags(): string {
  return INJECTED_LIBS.map(
    (l) => `<script${l.defer ? " defer" : ""} src="${l.src}"></script>`,
  ).join("\n");
}

/** Une ligne par lib, pour les prompts. */
export function injectedLibsPromptLines(): string {
  return INJECTED_LIBS.map((l) => `- ${l.label} — ${l.usage}`).join("\n");
}

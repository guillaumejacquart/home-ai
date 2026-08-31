/**
 * Libraries injected into the document of every generated app.
 *
 * Single dependency-free source: the served tags (`buildAppDocument`, previews)
 * and the description handed to the LLMs both come from here. Adding a library
 * means one entry, and the prompt follows automatically.
 */

export interface InjectedLib {
  label: string;
  /** How generated code uses it — copied verbatim into the prompts. */
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
    usage: "global `Chart` (UMD), no import needed",
    src: "https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js",
  },
];

/** <script> tags to inject into the app document's <head>. */
export function injectedLibTags(): string {
  return INJECTED_LIBS.map(
    (l) => `<script${l.defer ? " defer" : ""} src="${l.src}"></script>`,
  ).join("\n");
}

/** One line per library, for the prompts. */
export function injectedLibsPromptLines(): string {
  return INJECTED_LIBS.map((l) => `- ${l.label} — ${l.usage}`).join("\n");
}

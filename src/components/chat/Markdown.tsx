"use client";

import React, { isValidElement } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Markdown rendering for messages (GFM: tables, checkboxes, autolinks).
 *
 * Raw HTML isn't interpreted (no `rehype-raw`): react-markdown escapes
 * anything that isn't Markdown, so nothing can be injected.
 */

const CODE_COLLAPSE_LINES = 12;

/** Safety net: strips a leftover `<think>` tag from an old message. */
function stripThinkTags(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/i, "")
    .replace(/<\/?think>/gi, "");
}

/** Text and language of the `<code>` carried by a `<pre>`. */
function readCodeChild(children: React.ReactNode): { text: string; lang?: string } {
  if (!isValidElement(children)) return { text: String(children ?? "") };
  const props = children.props as { children?: React.ReactNode; className?: string };
  const lang = /language-([\w-]+)/.exec(props.className ?? "")?.[1];
  return { text: String(props.children ?? "").replace(/\n$/, ""), lang };
}

const components: Components = {
  // Long blocks collapse; otherwise generated HTML floods the conversation.
  pre({ children }) {
    const { text, lang } = readCodeChild(children);
    const lineCount = text.split("\n").length;

    if (lineCount <= CODE_COLLAPSE_LINES) {
      return (
        <pre className="overflow-auto rounded bg-canvas p-3 font-mono text-xs">
          <code>{text}</code>
        </pre>
      );
    }
    return (
      <details className="overflow-hidden rounded border border-line bg-canvas">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium text-muted">
          <span>
            {lang ?? "code"} · {lineCount} lignes
          </span>
          <span className="ml-auto text-brand">Voir le code</span>
        </summary>
        <pre className="max-h-64 overflow-auto border-t border-line bg-white p-3 font-mono text-xs">
          <code>{text}</code>
        </pre>
      </details>
    );
  },

  // Only called for inline code: `pre` doesn't render its children.
  code({ children }) {
    return (
      <code className="rounded bg-canvas px-1 py-0.5 font-mono text-xs">{children}</code>
    );
  },

  table({ children }) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-xs">{children}</table>
      </div>
    );
  },
  thead({ children }) {
    return <thead className="bg-canvas">{children}</thead>;
  },
  th({ children }) {
    return (
      <th className="border border-line px-2 py-1.5 font-semibold text-ink">{children}</th>
    );
  },
  td({ children }) {
    return <td className="border border-line px-2 py-1.5 align-top">{children}</td>;
  },

  a({ href, children }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-brand underline hover:text-brand-dark"
      >
        {children}
      </a>
    );
  },

  p({ children }) {
    return <p className="whitespace-pre-wrap">{children}</p>;
  },
  ul({ children }) {
    return <ul className="ml-4 list-disc space-y-1">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="ml-4 list-decimal space-y-1">{children}</ol>;
  },
  li({ children }) {
    return <li className="[&>ul]:mt-1 [&>ol]:mt-1">{children}</li>;
  },
  h1({ children }) {
    return <h1 className="text-base font-bold">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="text-sm font-semibold">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="text-sm font-semibold">{children}</h3>;
  },
  blockquote({ children }) {
    return (
      <blockquote className="border-l-2 border-line pl-3 italic text-muted">{children}</blockquote>
    );
  },
  hr() {
    return <hr className="border-line" />;
  },
  strong({ children }) {
    return <strong className="font-semibold">{children}</strong>;
  },
  input({ checked, type }) {
    // GFM checkboxes: read-only.
    if (type !== "checkbox") return null;
    return <input type="checkbox" checked={checked} readOnly className="mr-1 align-middle" />;
  },
};

export function Markdown({ content }: { content: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {stripThinkTags(content)}
      </ReactMarkdown>
    </div>
  );
}

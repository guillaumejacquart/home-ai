import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";

export function getMDXComponents(a: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    ...a,
  };
}

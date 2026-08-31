import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: "Home AI Docs",
      url: "/docs",
    },
    links: [
      {
        text: "App",
        url: "/",
        active: "none",
      },
    ],
  };
}

import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";
import { baseOptions } from "@/lib/layout.shared";
import { source } from "@/lib/source";
import "fumadocs-ui/style.css";
import "./docs.css";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <RootProvider
      theme={{
        enabled: false,
        attribute: "class",
        defaultTheme: "light",
        enableSystem: false,
      }}
    >
      <DocsLayout tree={source.pageTree} {...baseOptions()}>
        {children}
      </DocsLayout>
    </RootProvider>
  );
}

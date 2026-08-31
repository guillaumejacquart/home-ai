import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { createMDX } from "fumadocs-mdx/next";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
const withMDX = createMDX();

const nextConfig: NextConfig = {
  // Standalone build (.next/standalone), only for Docker.
  ...(process.env.BUILD_TARGET === "docker" ? { output: "standalone" as const } : {}),
  serverExternalPackages: ["better-sqlite3", "nodemailer", "imapflow", "googleapis"],
  turbopack: {
    root: import.meta.dirname,
  },
};

export default withNextIntl(withMDX(nextConfig));

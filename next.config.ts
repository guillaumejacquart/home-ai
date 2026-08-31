import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Build autonome (.next/standalone) uniquement pour Docker.
  ...(process.env.BUILD_TARGET === "docker" ? { output: "standalone" as const } : {}),
  serverExternalPackages: ["better-sqlite3", "nodemailer", "imapflow", "googleapis"],
  turbopack: {
    root: import.meta.dirname,
  },
};

export default withNextIntl(nextConfig);

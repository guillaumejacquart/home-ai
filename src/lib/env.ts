import { z } from "zod";

/** Validation centralisée des variables d'environnement. */
const envSchema = z.object({
  DB_DRIVER: z.enum(["sqlite"]).default("sqlite"),
  SQLITE_PATH: z.string().default("./local.db"),

  BETTER_AUTH_SECRET: z
    .string()
    .min(16)
    .default("dev-secret-change-me-please-32chars-min"),
  BETTER_AUTH_URL: z.string().default("http://localhost:3000"),

  // Chiffrement des secrets utilisateurs (connexions Google/SMTP/IMAP).
  ENCRYPTION_KEY: z.string().min(16).default("dev-encryption-key-min-16"),

  // Google OAuth.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // Providers LLM (OpenAI-compatible).
  OPENCODE_API_KEY: z.string().optional(),
  OPENCODE_BASE_URL: z.string().default("https://opencode.ai/zen/go/v1"),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().default("https://openrouter.ai/api/v1"),

  LLM_PLANNER_MODEL: z.string().default("glm-5.3"),
  LLM_CODER_MODEL: z.string().default("deepseek-v4-flash"),
  LLM_ASSISTANT_MODEL: z.string().optional(),

  // Navigateur headless local (Lightpanda).
  LIGHTPANDA_URL: z.string().url().default("http://127.0.0.1:9222"),
  LIGHTPANDA_PORT: z.coerce.number().int().positive().default(9222),
  LIGHTPANDA_BIN: z.string().default(".local/bin/lightpanda"),
});

export const env = envSchema.parse({
  DB_DRIVER: process.env.DB_DRIVER,
  SQLITE_PATH: process.env.SQLITE_PATH,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  OPENCODE_API_KEY: process.env.OPENCODE_API_KEY,
  OPENCODE_BASE_URL: process.env.OPENCODE_BASE_URL,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL,
  LLM_PLANNER_MODEL: process.env.LLM_PLANNER_MODEL,
  LLM_CODER_MODEL: process.env.LLM_CODER_MODEL,
  LLM_ASSISTANT_MODEL: process.env.LLM_ASSISTANT_MODEL,
  LIGHTPANDA_URL: process.env.LIGHTPANDA_URL,
  LIGHTPANDA_PORT: process.env.LIGHTPANDA_PORT,
  LIGHTPANDA_BIN: process.env.LIGHTPANDA_BIN,
});

export const isGoogleConfigured = Boolean(
  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET,
);

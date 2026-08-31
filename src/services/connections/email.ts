import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { z } from "zod";

import type { ConnectionProvider } from "@/services/connections/definition";

export const smtpSchema = z.object({
  host: z.string().min(1, "Host required"),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z.string().min(1, "User required"),
  pass: z.string().min(1, "Password required"),
  from: z.string().optional(),
});

export const imapSchema = z.object({
  host: z.string().min(1, "Host required"),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z.string().min(1, "User required"),
  pass: z.string().min(1, "Password required"),
});

export type SmtpConfig = z.infer<typeof smtpSchema>;
export type ImapConfig = z.infer<typeof imapSchema>;

export interface SmtpConfigLegacy {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from?: string;
}

export interface ImapConfigLegacy {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

/** Sends a test email through an SMTP config. Returns a human-readable message. */
export async function testSmtp(cfg: SmtpConfig): Promise<string> {
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  });
  try {
    await transporter.verify();
    return "SMTP: authentication OK";
  } finally {
    transporter.close();
  }
}

/** Sends an email through an SMTP config. */
export async function sendMail(
  cfg: SmtpConfig,
  opts: { to: string; subject: string; text: string; html?: string },
): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  });
  try {
    await transporter.sendMail({
      from: cfg.from ?? cfg.user,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    });
  } finally {
    transporter.close();
  }
}

function imapClient(cfg: ImapConfig): ImapFlow {
  return new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  });
}

/** Tests the IMAP connection: connect, auth, select INBOX, disconnect. */
export async function testImap(cfg: ImapConfig): Promise<string> {
  const client = imapClient(cfg);
  try {
    await client.connect();
    const info = await client.mailboxOpen("INBOX");
    const count = info.exists ?? 0;
    return `IMAP: connection OK — ${count} message(s) in INBOX`;
  } finally {
    await client.logout().catch(() => {});
  }
}

/**
 * Searches IMAP messages in INBOX. `query` is a list of criteria
 * imapflow understands (e.g. `["FROM", "x@y.com"]` or `["SINCE", dateISO]`).
 * Returns the envelopes (sender, subject, date).
 */
export async function imapSearch(
  cfg: ImapConfig,
  query: unknown[] = [],
  maxResults = 20,
): Promise<{ uid: number; from: string; subject: string; date: string }[]> {
  const client = imapClient(cfg);
  try {
    await client.connect();
    await client.mailboxOpen("INBOX");
    const results = await client.search(query as never, { uid: true });
    const uids = (results === false ? [] : results).slice(-maxResults);
    const out: { uid: number; from: string; subject: string; date: string }[] = [];
    for (const uid of uids) {
      const msg = await client.fetchOne(uid, { envelope: true });
      if (!msg) continue;
      const env = msg.envelope;
      const from = env?.from?.[0]?.address ?? "";
      out.push({
        uid,
        from,
        subject: env?.subject ?? "",
        date: env?.date ? new Date(env.date).toISOString() : "",
      });
    }
    return out;
  } finally {
    await client.logout().catch(() => {});
  }
}

/** Reads the text body of an IMAP message by its uid. */
export async function imapRead(cfg: ImapConfig, uid: number) {
  const client = imapClient(cfg);
  try {
    await client.connect();
    await client.mailboxOpen("INBOX");
    const msg = await client.fetchOne(uid, { envelope: true, source: true });
    if (!msg) return { subject: "", from: "", body: "" };
    const source = msg.source?.toString("utf8") ?? "";
    const parts = source.split("\r\n\r\n");
    const body = parts.length > 1 ? parts.slice(1).join("\r\n\r\n") : source;
    return {
      subject: msg.envelope?.subject ?? "",
      from: msg.envelope?.from?.[0]?.address ?? "",
      body,
    };
  } finally {
    await client.logout().catch(() => {});
  }
}

export const smtpProvider = {
  type: "smtp",
  label: "SMTP",
  schema: smtpSchema,
  test: testSmtp,
  sdk: {
    namespace: "mail",
    methods: {
      send: sendMail as (cfg: SmtpConfig, ...args: unknown[]) => Promise<unknown>,
    },
  },
  ui: { icon: "Send", descriptionKey: "providerSmtpDescription" },
} satisfies ConnectionProvider<SmtpConfig>;

export const imapProvider = {
  type: "imap",
  label: "IMAP",
  schema: imapSchema,
  test: testImap,
  sdk: {
    namespace: "mail",
    methods: {
      search: imapSearch as (cfg: ImapConfig, ...args: unknown[]) => Promise<unknown>,
      read: imapRead as (cfg: ImapConfig, ...args: unknown[]) => Promise<unknown>,
    },
  },
  ui: { icon: "Inbox", descriptionKey: "providerImapDescription" },
} satisfies ConnectionProvider<ImapConfig>;

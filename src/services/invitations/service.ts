import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { db, tables } from "@/db/client";
import { env } from "@/lib/env";

const INVITE_TTL_MS = 48 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

function generateId(): string {
  return randomBytes(16).toString("hex");
}

export function isSignupAllowedByEnv(): boolean {
  return env.ALLOW_SIGNUP === true;
}

export async function isSignupOpen(): Promise<boolean> {
  if (isSignupAllowedByEnv()) return true;
  const any = await db.select({ id: tables.user.id }).from(tables.user).limit(1);
  return any.length === 0;
}

export async function validateInvitation(email: string, token: string) {
  const tokenHash = hashToken(token);
  const normalizedEmail = email.trim().toLowerCase();
  const rows = await db
    .select()
    .from(tables.invitations)
    .where(and(eq(tables.invitations.email, normalizedEmail), eq(tables.invitations.tokenHash, tokenHash)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.usedAt) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return row;
}

export async function consumeInvitation(email: string, token: string): Promise<{ role: "admin" | "user" } | null> {
  const row = await validateInvitation(email, token);
  if (!row) return null;
  await db
    .update(tables.invitations)
    .set({ usedAt: new Date() })
    .where(eq(tables.invitations.id, row.id));
  return { role: row.role as "admin" | "user" };
}

export async function createInvitation(params: {
  email: string;
  role?: "admin" | "user";
  createdBy: string;
}): Promise<{ id: string; token: string; expiresAt: Date }> {
  const email = params.email.trim().toLowerCase();
  const role = params.role ?? "user";
  const token = generateToken();
  const tokenHash = hashToken(token);
  const id = generateId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);

  await db.insert(tables.invitations).values({
    id,
    email,
    role,
    tokenHash,
    expiresAt,
    createdBy: params.createdBy,
    createdAt: now,
  });

  return { id, token, expiresAt };
}

export async function listInvitations(): Promise<
  Array<{
    id: string;
    email: string;
    role: string;
    expiresAt: Date;
    usedAt: Date | null;
    createdAt: Date;
    createdBy: string;
  }>
> {
  const rows = await db.select().from(tables.invitations).orderBy(tables.invitations.createdAt);
  // Filter out used + expired strictly in JS for consistent ordering.
  return rows.filter((r) => !r.usedAt && r.expiresAt.getTime() >= Date.now());
}

export async function revokeInvitation(id: string): Promise<boolean> {
  const res = await db.delete(tables.invitations).where(eq(tables.invitations.id, id)).returning({ id: tables.invitations.id });
  return res.length > 0;
}

export function buildInviteUrl(token: string, email: string): string {
  const base = env.BETTER_AUTH_URL.replace(/\/$/, "");
  return `${base}/invite/${token}?email=${encodeURIComponent(email.trim().toLowerCase())}`;
}

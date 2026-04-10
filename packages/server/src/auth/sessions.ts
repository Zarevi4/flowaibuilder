import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { sessions, users } from '../db/schema.js';
import type { AuthUser } from '@flowaibuilder/shared';

export interface SessionMeta {
  ip?: string;
  userAgent?: string;
}

export interface CreatedSession {
  token: string;
  expiresAt: Date;
}

const DEFAULT_TTL_DAYS = 30;

function ttlMs(): number {
  const days = parseInt(process.env.SESSION_TTL_DAYS ?? '', 10);
  const n = Number.isFinite(days) && days > 0 ? days : DEFAULT_TTL_DAYS;
  return n * 24 * 60 * 60 * 1000;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function createSession(
  userId: string,
  meta: SessionMeta = {},
): Promise<CreatedSession> {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + ttlMs());
  await db.insert(sessions).values({
    userId,
    tokenHash,
    expiresAt,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
    lastSeenAt: new Date(),
  });
  return { token, expiresAt };
}

export interface ResolvedSession {
  session: { id: string; userId: string; expiresAt: Date };
  user: AuthUser;
}

function toAuthUser(row: typeof users.$inferSelect): AuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name ?? null,
    role: (row.role ?? 'editor') as AuthUser['role'],
  };
}

export async function getSessionByToken(token: string): Promise<ResolvedSession | null> {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const [sess] = await db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash));
  if (!sess) return null;
  if (sess.expiresAt && sess.expiresAt.getTime() < Date.now()) {
    // Expired — best-effort cleanup, don't await.
    void db.delete(sessions).where(eq(sessions.tokenHash, tokenHash)).catch(() => undefined);
    return null;
  }
  const [user] = await db.select().from(users).where(eq(users.id, sess.userId));
  if (!user) return null;
  return {
    session: { id: sess.id, userId: sess.userId, expiresAt: sess.expiresAt! },
    user: toAuthUser(user),
  };
}

export async function deleteSession(token: string): Promise<void> {
  if (!token) return;
  const tokenHash = hashToken(token);
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

export async function touchSession(token: string, meta: SessionMeta = {}): Promise<void> {
  if (!token) return;
  const tokenHash = hashToken(token);
  await db
    .update(sessions)
    .set({ lastSeenAt: new Date(), ip: meta.ip ?? null, userAgent: meta.userAgent ?? null })
    .where(eq(sessions.tokenHash, tokenHash));
}

export const __test__ = { hashToken };

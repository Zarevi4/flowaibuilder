import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { hashPassword } from './password.js';

/**
 * Seed the first admin user if the users table is empty AND
 * ADMIN_EMAIL + ADMIN_PASSWORD env vars are set.
 *
 * Called once from index.ts during boot, after registerAuditLogger.
 */
export async function seedFirstAdmin(app: FastifyInstance): Promise<void> {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;
  try {
    const [{ c }] = (await db
      .select({ c: sql<number>`count(*)::int` })
      .from(users)) as Array<{ c: number }>;
    if (c > 0) return;
    const passwordHash = await hashPassword(password);
    await db.insert(users).values({
      email,
      name: 'Admin',
      passwordHash,
      role: 'admin',
    });
    app.log.info({ email }, 'seedFirstAdmin: created first admin user');
  } catch (err) {
    app.log.error({ err }, 'seedFirstAdmin failed');
  }
}

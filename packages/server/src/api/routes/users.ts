import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq, ne, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { hashPassword } from '../../auth/password.js';

/** Case-insensitive UUID compare — Postgres stores canonical lowercase,
 *  but clients may send mixed case in URL params. */
function sameId(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

/** Count remaining admins excluding a given user id — used to enforce
 *  the "at least one admin must remain" invariant on demote/delete. */
async function countOtherAdmins(excludeId: string): Promise<number> {
  const [{ c }] = (await db
    .select({ c: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.role, 'admin'), ne(users.id, excludeId)))) as Array<{ c: number }>;
  return c;
}

const roleSchema = z.enum(['viewer', 'editor', 'admin']);

const createSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  password: z.string().min(8).optional(),
  role: roleSchema.default('editor'),
});

const updateSchema = z.object({
  name: z.string().optional(),
  password: z.string().min(8).optional(),
  role: roleSchema.optional(),
});

function publicView(row: typeof users.$inferSelect) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    ssoProvider: row.ssoProvider,
    createdAt: row.createdAt?.toISOString?.() ?? null,
  };
}

export async function userRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/users
  app.get('/api/users', async () => {
    const rows = await db.select().from(users);
    return { users: rows.map(publicView) };
  });

  // POST /api/users  (admin)
  app.post('/api/users', async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten() });
    }
    const { email, name, password, role } = parsed.data;

    const existing = await db.select().from(users).where(eq(users.email, email));
    if (existing.length > 0) {
      return reply.code(409).send({ error: 'email_taken' });
    }

    const passwordHash = password ? await hashPassword(password) : null;
    const [created] = await db
      .insert(users)
      .values({ email, name: name ?? null, passwordHash, role })
      .returning();
    return reply.code(201).send(publicView(created));
  });

  // PUT /api/users/:id  (admin, self-guard for demotion)
  app.put<{ Params: { id: string } }>('/api/users/:id', async (request, reply) => {
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten() });
    }
    const { id } = request.params;
    const actor = request.user;
    if (sameId(actor?.id, id) && parsed.data.role && parsed.data.role !== 'admin') {
      return reply.code(400).send({ error: 'cannot_modify_self' });
    }

    // Zero-admin invariant: refuse to demote the last admin, even if that
    // admin is someone other than the acting user.
    if (parsed.data.role && parsed.data.role !== 'admin') {
      const [target] = await db.select().from(users).where(eq(users.id, id));
      if (target?.role === 'admin' && (await countOtherAdmins(id)) === 0) {
        return reply.code(400).send({ error: 'cannot_remove_last_admin' });
      }
    }

    const patch: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.role !== undefined) patch.role = parsed.data.role;
    if (parsed.data.password !== undefined) {
      patch.passwordHash = await hashPassword(parsed.data.password);
    }
    if (Object.keys(patch).length === 0) {
      return reply.code(400).send({ error: 'no_fields_to_update' });
    }

    const [updated] = await db.update(users).set(patch).where(eq(users.id, id)).returning();
    if (!updated) return reply.code(404).send({ error: 'user_not_found' });
    return publicView(updated);
  });

  // DELETE /api/users/:id  (admin, not self)
  app.delete<{ Params: { id: string } }>('/api/users/:id', async (request, reply) => {
    const { id } = request.params;
    if (sameId(request.user?.id, id)) {
      return reply.code(400).send({ error: 'cannot_modify_self' });
    }
    // Zero-admin invariant: refuse to delete the last admin.
    const [target] = await db.select().from(users).where(eq(users.id, id));
    if (target?.role === 'admin' && (await countOtherAdmins(id)) === 0) {
      return reply.code(400).send({ error: 'cannot_remove_last_admin' });
    }
    const [deleted] = await db.delete(users).where(eq(users.id, id)).returning();
    if (!deleted) return reply.code(404).send({ error: 'user_not_found' });
    return reply.code(204).send();
  });
}

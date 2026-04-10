import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { credentials } from '../../db/schema.js';
import { encrypt } from '../../crypto/aes.js';
import type { Credential } from '@flowaibuilder/shared';

interface CreateSecretBody {
  name: string;
  type: string;
  value: string;
}

interface UpdateSecretBody {
  value: string;
}

type CredentialRow = typeof credentials.$inferSelect;

function toCredential(row: CredentialRow): Credential {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    createdBy: row.createdBy,
    createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
    updatedAt: row.updatedAt?.toISOString() ?? new Date().toISOString(),
  };
}

/** Redaction sentinel — writing this back must be a no-op. */
const VALUE_REDACTED = '***';

export async function secretsRoutes(app: FastifyInstance) {
  // List all secrets — values are NEVER returned.
  app.get('/api/secrets', async () => {
    const rows = await db.select().from(credentials);
    return { secrets: rows.map(toCredential) };
  });

  // Create a secret.
  app.post<{ Body: CreateSecretBody }>('/api/secrets', async (request, reply) => {
    // Skip generic audit middleware — we write custom metadata with { name, type }.
    request.auditSkip = true;

    const { name, type, value } = request.body;
    if (!name || !type || !value) {
      return reply.code(400).send({ error: 'name, type, and value are required' });
    }
    // Validate name matches the template resolution regex ([A-Za-z0-9_-]+).
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      return reply.code(400).send({ error: 'name must contain only letters, digits, underscores, and hyphens' });
    }
    const validTypes = ['api_key', 'oauth2', 'basic', 'custom'];
    if (!validTypes.includes(type)) {
      return reply.code(400).send({ error: `type must be one of: ${validTypes.join(', ')}` });
    }

    // Check name uniqueness (case-insensitive).
    const [existing] = await db
      .select({ id: credentials.id })
      .from(credentials)
      .where(sql`lower(${credentials.name}) = lower(${name})`);
    if (existing) {
      return reply.code(409).send({ error: 'A secret with this name already exists' });
    }

    let dataEncrypted: string;
    try {
      dataEncrypted = encrypt(value);
    } catch {
      return reply.code(500).send({ error: 'Failed to encrypt secret value' });
    }

    const actor = request.user?.email ?? 'api';
    let row: CredentialRow;
    try {
      [row] = await db
        .insert(credentials)
        .values({
          name,
          type,
          dataEncrypted,
          createdBy: actor,
        })
        .returning();
    } catch (err) {
      // Handle unique constraint violation from TOCTOU race.
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('credentials_name_unique') || msg.includes('unique constraint')) {
        return reply.code(409).send({ error: 'A secret with this name already exists' });
      }
      throw err;
    }

    await app.audit?.write({
      actor,
      action: 'credential.created',
      resourceType: 'credential',
      resourceId: row.id,
      metadata: { name: row.name, type: row.type },
    }).catch(() => undefined);

    return reply.code(201).send({
      id: row.id,
      name: row.name,
      type: row.type,
      createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
    });
  });

  // Update a secret's value.
  app.put<{ Params: { id: string }; Body: UpdateSecretBody }>(
    '/api/secrets/:id',
    async (request, reply) => {
      // Skip generic audit middleware — we write custom metadata with { name, type }.
      request.auditSkip = true;

      const { id } = request.params;
      const { value } = request.body;

      const [row] = await db.select().from(credentials).where(eq(credentials.id, id));
      if (!row) {
        return reply.code(404).send({ error: 'Secret not found' });
      }

      // Sentinel no-op — mirror the gitToken pattern from settings.ts.
      if (value === VALUE_REDACTED) {
        return { id: row.id, name: row.name, type: row.type, updatedAt: row.updatedAt?.toISOString() };
      }

      if (!value) {
        return reply.code(400).send({ error: 'value is required' });
      }

      let dataEncrypted: string;
      try {
        dataEncrypted = encrypt(value);
      } catch {
        return reply.code(500).send({ error: 'Failed to encrypt secret value' });
      }

      const [updated] = await db
        .update(credentials)
        .set({ dataEncrypted, updatedAt: new Date() })
        .where(eq(credentials.id, id))
        .returning();

      const actor = request.user?.email ?? 'api';
      await app.audit?.write({
        actor,
        action: 'credential.updated',
        resourceType: 'credential',
        resourceId: id,
        metadata: { name: updated.name, type: updated.type },
      }).catch(() => undefined);

      return {
        id: updated.id,
        name: updated.name,
        type: updated.type,
        updatedAt: updated.updatedAt?.toISOString() ?? new Date().toISOString(),
      };
    },
  );

  // Delete a secret.
  app.delete<{ Params: { id: string } }>('/api/secrets/:id', async (request, reply) => {
    // Skip generic audit middleware — we write custom metadata with { name, type }.
    request.auditSkip = true;

    const { id } = request.params;
    const [row] = await db.delete(credentials).where(eq(credentials.id, id)).returning();
    if (!row) {
      return reply.code(404).send({ error: 'Secret not found' });
    }

    const actor = request.user?.email ?? 'api';
    await app.audit?.write({
      actor,
      action: 'credential.deleted',
      resourceType: 'credential',
      resourceId: id,
      metadata: { name: row.name, type: row.type },
    }).catch(() => undefined);

    return { deleted: true, id: row.id };
  });
}

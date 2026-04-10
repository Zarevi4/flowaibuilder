import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import { credentials, workflows } from '../../db/schema.js';
import { encrypt } from '../../crypto/aes.js';
import { mcpActor, getActiveMcpContext } from '../index.js';
import { assertMcpPermitted } from '../rbac.js';
import { getBroadcaster } from '../../api/ws/broadcaster.js';
import { recordSnapshot } from '../../versioning/store.js';
import type { Workflow, WorkflowNode, Connection } from '@flowaibuilder/shared';

type TextResult = { content: [{ type: 'text'; text: string }] };
const text = (o: unknown): TextResult => ({
  content: [{ type: 'text' as const, text: JSON.stringify(o) }],
});

function toWorkflow(row: typeof workflows.$inferSelect): Workflow {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    nodes: (row.nodes ?? []) as WorkflowNode[],
    connections: (row.connections ?? []) as Connection[],
    active: row.active ?? false,
    version: row.version ?? 1,
    environment: row.environment ?? 'dev',
    canvas: (row.canvas ?? {}) as Record<string, unknown>,
    settings: (row.settings ?? {}) as Record<string, unknown>,
    tags: (row.tags ?? []) as string[],
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
    updatedAt: row.updatedAt?.toISOString() ?? new Date().toISOString(),
  };
}

export function registerSecretsTools(server: McpServer, app?: FastifyInstance): void {
  // ─── manage_secrets ─────────────────────────────────────────
  server.tool(
    'flowaibuilder.manage_secrets',
    {
      action: z.enum(['set', 'list', 'delete']).describe('Action to perform'),
      name: z.string().optional().describe('Secret name (required for set/delete)'),
      type: z.enum(['api_key', 'oauth2', 'basic', 'custom']).optional().describe('Secret type (required for set)'),
      value: z.string().optional().describe('Secret value (required for set)'),
    },
    async ({ action, name, type, value }) => {
      const actor = mcpActor();

      if (action === 'list') {
        const rows = await db.select().from(credentials);
        return text({
          secrets: rows.map((r) => ({
            id: r.id,
            name: r.name,
            type: r.type,
            createdBy: r.createdBy,
            createdAt: r.createdAt?.toISOString(),
            updatedAt: r.updatedAt?.toISOString(),
          })),
        });
      }

      if (action === 'set') {
        // Runtime RBAC: set requires editor (manage_secrets is viewer at tool level for list)
        const ctx = getActiveMcpContext();
        assertMcpPermitted('flowaibuilder.manage_secrets:set', 'editor', {
          user: ctx.user ?? undefined,
          transport: ctx.transport,
        });
        if (!name || !value) throw new Error('name and value are required for set');
        const credType = type ?? 'custom';

        // Upsert: if name exists, update value.
        const [existing] = await db
          .select()
          .from(credentials)
          .where(sql`lower(${credentials.name}) = lower(${name})`);

        if (existing) {
          const dataEncrypted = encrypt(value);
          const [updated] = await db
            .update(credentials)
            .set({ dataEncrypted, updatedAt: new Date() })
            .where(eq(credentials.id, existing.id))
            .returning();

          await app?.audit?.write({
            actor,
            action: 'credential.updated',
            resourceType: 'credential',
            resourceId: updated.id,
            metadata: { name: updated.name, type: updated.type },
          }).catch((err) => app?.log?.warn({ err }, 'mcp secrets audit write failed'));

          return text({ updated: true, id: updated.id, name: updated.name, type: updated.type });
        }

        const dataEncrypted = encrypt(value);
        const [row] = await db
          .insert(credentials)
          .values({
            name,
            type: credType,
            dataEncrypted,
            createdBy: actor,
          })
          .returning();

        await app?.audit?.write({
          actor,
          action: 'credential.created',
          resourceType: 'credential',
          resourceId: row.id,
          metadata: { name: row.name, type: row.type },
        }).catch((err) => app?.log?.warn({ err }, 'mcp secrets audit write failed'));

        return text({
          created: true,
          id: row.id,
          name: row.name,
          type: row.type,
        });
      }

      if (action === 'delete') {
        // Runtime RBAC: delete requires editor
        const ctx = getActiveMcpContext();
        assertMcpPermitted('flowaibuilder.manage_secrets:delete', 'editor', {
          user: ctx.user ?? undefined,
          transport: ctx.transport,
        });
        if (!name) throw new Error('name is required for delete');
        const [existing] = await db
          .select()
          .from(credentials)
          .where(sql`lower(${credentials.name}) = lower(${name})`);
        if (!existing) throw new Error(`Secret '${name}' not found`);

        await db.delete(credentials).where(eq(credentials.id, existing.id));

        await app?.audit?.write({
          actor,
          action: 'credential.deleted',
          resourceType: 'credential',
          resourceId: existing.id,
          metadata: { name: existing.name, type: existing.type },
        }).catch((err) => app?.log?.warn({ err }, 'mcp secrets audit write failed'));

        return text({ deleted: true, id: existing.id, name: existing.name });
      }

      throw new Error(`Unknown action: ${action}`);
    },
  );

  // ─── set_environment ────────────────────────────────────────
  server.tool(
    'flowaibuilder.set_environment',
    {
      workflow_id: z.string().describe('Workflow ID'),
      env: z.enum(['dev', 'staging', 'prod']).describe('Target environment'),
    },
    async ({ workflow_id, env }) => {
      const [wf] = await db.select().from(workflows).where(eq(workflows.id, workflow_id));
      if (!wf) throw new Error(`Workflow ${workflow_id} not found`);

      const from = wf.environment ?? 'dev';
      if (from === env) {
        return text({ promoted: false, reason: 'already in target' });
      }

      const [updated] = await db
        .update(workflows)
        .set({ environment: env, updatedAt: new Date() })
        .where(eq(workflows.id, workflow_id))
        .returning();

      const actor = mcpActor();

      await recordSnapshot(workflow_id, {
        actor,
        message: `promote:${from}->${env}`,
        app,
      }).catch((err) => app?.log?.warn({ err }, 'mcp promote recordSnapshot failed'));

      await app?.audit?.write({
        actor,
        action: 'workflow.promoted',
        resourceType: 'workflow',
        resourceId: workflow_id,
        metadata: { from, to: env },
      }).catch((err) => app?.log?.warn({ err }, 'mcp promote audit write failed'));

      getBroadcaster()?.broadcast('workflow_updated', workflow_id, toWorkflow(updated));

      return text({ promoted: true, from, to: env });
    },
  );
}

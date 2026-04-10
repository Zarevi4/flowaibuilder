import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import { instanceSettings } from '../../db/schema.js';
import { isQueueMode, getQueueStatus } from '../../queue/manager.js';
import { mcpActor } from '../index.js';
import type { LogDestination } from '@flowaibuilder/shared';

type TextResult = { content: [{ type: 'text'; text: string }] };
const text = (o: unknown): TextResult => ({
  content: [{ type: 'text' as const, text: JSON.stringify(o) }],
});

export function registerQueueTools(server: McpServer, app?: FastifyInstance) {
  // ─── get_queue_status ─────────────────────────────────────
  server.tool(
    'flowaibuilder.get_queue_status',
    {},
    async () => {
      if (!isQueueMode()) {
        return text({ enabled: false });
      }
      const status = await getQueueStatus();
      return text(status);
    },
  );

  // ─── configure_log_streaming ──────────────────────────────
  server.tool(
    'flowaibuilder.configure_log_streaming',
    {
      destinations: z.array(z.object({
        type: z.enum(['stdout', 'webhook', 's3']),
        url: z.string().optional(),
        bucket: z.string().optional(),
        region: z.string().optional(),
        prefix: z.string().optional(),
        enabled: z.boolean(),
      })).describe('Log stream destinations'),
    },
    async ({ destinations }) => {
      // Validate destinations
      for (const dest of destinations) {
        if (dest.type === 'webhook' && (!dest.url || !dest.url.startsWith('https://'))) {
          throw new Error('Webhook destination requires an https:// URL');
        }
        if (dest.type === 's3' && !dest.bucket) {
          throw new Error('S3 destination requires a bucket name');
        }
      }

      // Upsert: ensure singleton row exists, then update atomically
      await db
        .insert(instanceSettings)
        .values({ id: 'singleton', updatedAt: new Date() })
        .onConflictDoNothing({ target: instanceSettings.id });
      await db
        .update(instanceSettings)
        .set({ logStreamDestinations: destinations, updatedAt: new Date() })
        .where(eq(instanceSettings.id, 'singleton'));

      // Audit entry
      if ((app as any)?.audit?.write) {
        await (app as any).audit.write({
          actor: mcpActor(),
          action: 'log_streaming.configured',
          resourceType: 'settings',
          resourceId: 'singleton',
          metadata: {
            destinations: destinations.map((d: LogDestination) => ({
              type: d.type,
              ...(d.url ? { url: d.url } : {}),
              ...(d.bucket ? { bucket: d.bucket } : {}),
            })),
          },
        });
      }

      return text({ success: true, destinations });
    },
  );
}

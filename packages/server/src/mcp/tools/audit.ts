import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import { executions } from '../../db/schema.js';
import { queryAuditLog } from '../../audit/query.js';
import { redactSecrets } from '../../audit/logger.js';

function text(obj: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }] };
}

export function registerAuditTools(server: McpServer, app?: FastifyInstance) {
  // ─── get_audit_log ────────────────────────────────────────
  server.tool(
    'flowaibuilder.get_audit_log',
    {
      workflow_id: z.string().optional().describe('Filter by workflow ID'),
      user: z.string().optional().describe('Filter by actor (user email or mcp:claude-code)'),
      action: z.string().optional().describe('Filter by action string'),
      since: z.string().optional().describe('ISO timestamp — only entries newer than this'),
      limit: z.number().int().min(1).max(500).optional().describe('Max results (default 100, max 500)'),
    },
    async ({ workflow_id, user, action, since, limit }) => {
      const entries = await queryAuditLog({
        workflowId: workflow_id,
        actor: user,
        action,
        since,
        limit: limit ?? 100,
      });
      return text({ entries });
    },
  );

  // ─── get_execution_log ────────────────────────────────────
  server.tool(
    'flowaibuilder.get_execution_log',
    {
      execution_id: z.string().describe('Execution ID'),
      detail_level: z
        .enum(['summary', 'full', 'debug'])
        .optional()
        .describe('summary | full | debug (default summary)'),
    },
    async ({ execution_id, detail_level }) => {
      const level = detail_level ?? 'summary';
      const [row] = await db.select().from(executions).where(eq(executions.id, execution_id));
      if (!row) throw new Error(`Execution ${execution_id} not found`);

      const nodeExecs = ((row.nodeExecutions ?? []) as Array<Record<string, unknown>>).map((n) => ({
        nodeId: (n.nodeId ?? n.node_id) as string | undefined,
        nodeName: (n.nodeName ?? n.node_name) as string | undefined,
        status: n.status,
        input: redactSecrets(n.input ?? null),
        output: redactSecrets(n.output ?? null),
        duration_ms: (n.durationMs ?? n.duration_ms) as number | undefined,
        error: n.error ?? undefined,
      }));

      const summary = {
        id: row.id,
        workflow_id: row.workflowId,
        status: row.status,
        started_at: row.startedAt?.toISOString() ?? null,
        finished_at: row.finishedAt?.toISOString() ?? null,
        duration_ms: row.durationMs ?? null,
        node_count: nodeExecs.length,
        error: row.error ?? null,
      };

      let payload: Record<string, unknown> = summary;
      if (level === 'full') {
        payload = { ...summary, node_executions: nodeExecs };
      } else if (level === 'debug') {
        payload = {
          ...summary,
          node_executions: nodeExecs,
          trigger_data: redactSecrets(row.triggerData ?? null),
          result_data: redactSecrets(row.resultData ?? null),
          mode: row.mode,
          triggered_by: row.triggeredBy,
        };
      }

      // Emit an audit entry for debugging-read access
      await app?.audit
        ?.write({
          actor: 'mcp:claude-code',
          action: 'execution.log.read',
          resourceType: 'execution',
          resourceId: execution_id,
          metadata: { detail_level: level },
        })
        .catch(() => undefined);

      return text(payload);
    },
  );
}

import type { FastifyInstance } from 'fastify';
import { queryAuditLog, InvalidAuditQueryError } from '../../audit/query.js';

interface AuditQuery {
  actor?: string;
  user?: string; // alias for actor (parity with MCP tool)
  action?: string;
  resourceType?: string;
  workflow_id?: string;
  since?: string;
  limit?: string;
}

export async function auditRoutes(app: FastifyInstance) {
  app.get<{ Querystring: AuditQuery }>('/api/audit-log', async (request, reply) => {
    const { actor, user, action, resourceType, workflow_id, since, limit } = request.query ?? {};
    const parsedLimit = Math.min(Math.max(parseInt(limit ?? '100', 10) || 100, 1), 500);

    try {
      const entries = await queryAuditLog({
        actor: actor ?? user,
        action,
        resourceType,
        workflowId: workflow_id,
        since,
        limit: parsedLimit,
      });
      return { entries };
    } catch (err) {
      if (err instanceof InvalidAuditQueryError) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }
  });
}

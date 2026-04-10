import type { FastifyInstance, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { workflows } from '../../db/schema.js';

interface ActionMap {
  action: string;
  resourceType?: string;
  /** Whether we should capture a before-snapshot for mutations. */
  captureBefore?: boolean;
}

/**
 * Map (method, routeUrl) to an action string + resource metadata.
 * routeUrl is the Fastify-normalised route (e.g. `/api/workflows/:id`).
 */
export function resolveAction(method: string, routeUrl: string | undefined): ActionMap | null {
  if (!routeUrl) return null;

  // Internal/ignored routes
  if (routeUrl.startsWith('/api/audit-log')) return null;
  if (routeUrl === '/api/health') return null;
  if (routeUrl.startsWith('/mcp/')) return null;

  const m = method.toUpperCase();

  // Workflows
  if (routeUrl === '/api/workflows' && m === 'POST') {
    return { action: 'workflow.created', resourceType: 'workflow' };
  }
  if (routeUrl === '/api/workflows/:id') {
    if (m === 'PUT' || m === 'PATCH')
      return { action: 'workflow.updated', resourceType: 'workflow', captureBefore: true };
    if (m === 'DELETE')
      return { action: 'workflow.deleted', resourceType: 'workflow', captureBefore: true };
  }
  if (routeUrl === '/api/workflows/:id/execute' && m === 'POST') {
    return { action: 'execution.started', resourceType: 'workflow' };
  }
  if (routeUrl === '/api/workflows/:id/nodes' && m === 'POST') {
    return { action: 'node.created', resourceType: 'workflow' };
  }
  if (routeUrl === '/api/workflows/:id/nodes/:nodeId') {
    if (m === 'PUT' || m === 'PATCH') return { action: 'node.updated', resourceType: 'node' };
    if (m === 'DELETE') return { action: 'node.deleted', resourceType: 'node' };
  }
  if (routeUrl === '/api/workflows/:id/connections' && m === 'POST') {
    return { action: 'connection.created', resourceType: 'workflow' };
  }
  if (routeUrl.startsWith('/api/workflows/:id/zones')) {
    if (m === 'POST') return { action: 'zone.created', resourceType: 'zone' };
    if (m === 'PUT' || m === 'PATCH') return { action: 'zone.updated', resourceType: 'zone' };
    if (m === 'DELETE') return { action: 'zone.deleted', resourceType: 'zone' };
  }

  // Users (Story 5.2)
  if (routeUrl === '/api/users' && m === 'POST') {
    return { action: 'user.created', resourceType: 'user' };
  }
  if (routeUrl === '/api/users/:id') {
    if (m === 'PUT' || m === 'PATCH')
      return { action: 'user.updated', resourceType: 'user', captureBefore: true };
    if (m === 'DELETE')
      return { action: 'user.deleted', resourceType: 'user', captureBefore: true };
  }

  // Settings
  if (routeUrl === '/api/settings' && (m === 'PUT' || m === 'PATCH')) {
    return { action: 'settings.updated', resourceType: 'settings' };
  }

  // Versioning + Git (Story 5.3)
  if (routeUrl === '/api/workflows/:id/revert' && m === 'POST') {
    return { action: 'workflow.reverted', resourceType: 'workflow' };
  }
  if (routeUrl === '/api/workflows/:id/promote' && m === 'POST') {
    return { action: 'workflow.promoted', resourceType: 'workflow' };
  }
  if (routeUrl === '/api/workflows/:id/git/push' && m === 'POST') {
    return { action: 'workflow.git.pushed', resourceType: 'workflow' };
  }

  // Secrets (Story 5.4)
  if (routeUrl === '/api/secrets' && m === 'POST') {
    return { action: 'credential.created', resourceType: 'credential' };
  }
  if (routeUrl === '/api/secrets/:id') {
    if (m === 'PUT' || m === 'PATCH')
      return { action: 'credential.updated', resourceType: 'credential' };
    if (m === 'DELETE')
      return { action: 'credential.deleted', resourceType: 'credential' };
  }

  // Fallback — derive from the first path segment after /api/
  if (routeUrl.startsWith('/api/')) {
    const seg = routeUrl.split('/')[2] ?? 'unknown';
    return { action: `api.${m.toLowerCase()}.${seg}` };
  }

  return null;
}

/** Extract a resource id from request.params.id-like fields. */
function extractResourceId(request: FastifyRequest): string | undefined {
  const params = (request.params ?? {}) as Record<string, unknown>;
  return (
    (typeof params.id === 'string' && params.id) ||
    (typeof params.workflowId === 'string' && params.workflowId) ||
    (typeof params.nodeId === 'string' && params.nodeId) ||
    undefined
  );
}

/**
 * Fastify plugin that auto-logs successful API mutations to the audit log.
 * MUST be registered AFTER routes so routeOptions.url is populated.
 */
export async function registerAuditMiddleware(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (request) => {
    const routeUrl = request.routeOptions?.url;
    const mapped = resolveAction(request.method, routeUrl);
    if (!mapped) {
      request.auditSkip = true;
      return;
    }

    const resourceId = extractResourceId(request);
    request.auditMeta = { resourceType: mapped.resourceType, resourceId };

    // Capture a before snapshot for mutations that request it.
    if (mapped.captureBefore && resourceId) {
      try {
        if (routeUrl?.startsWith('/api/workflows/:id')) {
          const [row] = await db.select().from(workflows).where(eq(workflows.id, resourceId));
          if (row) request.auditBefore = row;
        }
        // Other entity types (users, etc.) can be added here as needed.
      } catch {
        // Non-fatal; swallowed to avoid breaking the request.
      }
    }
  });

  app.addHook('onSend', async (request, reply, payload) => {
    // Capture the response JSON payload on the request so onResponse can use it as `after`.
    if (request.auditSkip) return payload;
    const ct = reply.getHeader('content-type');
    if (typeof ct === 'string' && ct.includes('application/json') && typeof payload === 'string') {
      try {
        (request as FastifyRequest & { auditAfter?: unknown }).auditAfter = JSON.parse(payload);
      } catch {
        // ignore
      }
    }
    return payload;
  });

  app.addHook('onResponse', async (request, reply) => {
    if (request.auditSkip) return;
    if (request.method.toUpperCase() === 'GET') return;
    if (reply.statusCode >= 400) return;

    const routeUrl = request.routeOptions?.url;
    const mapped = resolveAction(request.method, routeUrl);
    if (!mapped) return;

    // Story 5.3 AC #12: discriminate a git-only settings update so the audit
    // trail can surface `settings.git.updated` separately from other tweaks.
    if (mapped.action === 'settings.updated' && routeUrl === '/api/settings') {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const keys = Object.keys(body);
      if (keys.length > 0 && keys.every((k) => k.startsWith('git'))) {
        mapped.action = 'settings.git.updated';
      }
    }

    const meta = request.auditMeta ?? {};
    const after = (request as FastifyRequest & { auditAfter?: unknown }).auditAfter ?? null;

    // Collect workflow_id metadata hint: if the route is under /api/workflows/:id, store it.
    const params = (request.params ?? {}) as Record<string, unknown>;
    const workflowIdHint =
      typeof params.id === 'string' && routeUrl?.startsWith('/api/workflows/:id')
        ? params.id
        : typeof params.workflowId === 'string'
          ? params.workflowId
          : undefined;

    // Build changes envelope
    let changes: { before?: unknown; after?: unknown } | null = null;
    if (mapped.captureBefore) {
      changes = { before: request.auditBefore ?? null, after };
    } else if (request.method.toUpperCase() === 'POST') {
      changes = { after };
    }

    // Authenticated user email (lands in Story 5.2)
    const user = (request as FastifyRequest & { user?: { email?: string } }).user;
    const actor = user?.email ?? 'anonymous';

    const metadata: Record<string, unknown> = {
      ip: request.ip,
      user_agent: request.headers['user-agent'],
      route: routeUrl,
    };
    if (workflowIdHint) metadata.workflow_id = workflowIdHint;

    // Fire and forget — errors swallowed by AuditLogger.
    await app.audit?.write({
      actor,
      action: mapped.action,
      resourceType: meta.resourceType ?? null,
      resourceId: meta.resourceId ?? null,
      changes,
      metadata,
    });
  });
}


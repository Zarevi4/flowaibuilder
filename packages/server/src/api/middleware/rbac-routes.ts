import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { UserRole } from '@flowaibuilder/shared';
import { requireRole } from './rbac.js';

/**
 * Resolve the minimum role required for a (method, url) pair.
 *
 * Hierarchy:
 *   - admin-only:  /api/users/*, PUT /api/settings
 *   - editor:      all workflow/node/zone/annotation/execution/import mutations
 *   - viewer:      all GET routes
 *   - public:      /api/auth/*, /api/health, /mcp/sse handshake (skipped in auth middleware)
 *
 * Returns null when the route should not be guarded (public/skip).
 */
export function requiredRoleForRoute(
  method: string,
  url: string,
): UserRole | null {
  const m = method.toUpperCase();

  // Auth routes are public — auth middleware already allows/rejects them.
  if (url.startsWith('/api/auth/')) return null;
  if (url === '/api/health') return null;
  if (url.startsWith('/mcp/')) return null;
  // Internal/non-API routes.
  if (!url.startsWith('/api/')) return null;

  // Admin-only.
  if (url.startsWith('/api/users')) return 'admin';
  if (url === '/api/settings' && (m === 'PUT' || m === 'PATCH')) return 'admin';

  // Secrets: GET = viewer, mutations = editor (not admin-only).
  if (url.startsWith('/api/secrets')) {
    return m === 'GET' ? 'viewer' : 'editor';
  }

  // Viewer: all GETs.
  if (m === 'GET') return 'viewer';

  // Everything else mutating → editor.
  return 'editor';
}

/**
 * Installs an onRoute hook that wraps each registered route with an RBAC
 * preHandler based on the matrix above. MUST be called AFTER all routes
 * are registered (same constraint as the audit middleware).
 */
export async function applyRouteRbac(app: FastifyInstance): Promise<void> {
  // onRoute fires during registration — we register this hook after routes,
  // so walk the already-registered routes instead. Fastify exposes this via
  // app.addHook('onRoute'), but for post-hoc wiring we use a preHandler hook
  // that consults the matrix on every request.
  app.addHook('preHandler', async (request, reply) => {
    const url = request.routeOptions?.url;
    if (!url) return;
    const min = requiredRoleForRoute(request.method, url);
    if (!min) return;
    const guard = requireRole(min) as preHandlerHookHandler;
    await guard.call(app, request, reply, () => undefined);
    // If the guard replied (401/403), short-circuit so no downstream
    // preHandler or route handler runs (avoids double-send).
    if (reply.sent) return reply;
  });
}

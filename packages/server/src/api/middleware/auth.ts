import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getSessionByToken, touchSession } from '../../auth/sessions.js';

/**
 * Routes that are public — do not require authentication.
 *
 * Per Story 5.2 AC #5. Logout is NOT public: it requires a session so
 * the audit log records the real actor and session deletion is authenticated.
 * MCP SSE is NOT public either: the handshake is authenticated and binds
 * the session user onto the transport for per-tool RBAC enforcement.
 */
const PUBLIC_ROUTES: Array<{ method: string; url: string }> = [
  { method: 'GET', url: '/api/health' },
  { method: 'POST', url: '/api/auth/register' },
  { method: 'POST', url: '/api/auth/login' },
  { method: 'GET', url: '/api/auth/sso/login' },
  { method: 'POST', url: '/api/auth/sso/login' },
  { method: 'POST', url: '/api/auth/sso/callback' },
];

function isPublic(method: string, url: string | undefined): boolean {
  if (!url) return false;
  const m = method.toUpperCase();
  // HEAD mirrors GET for public routes (uptime probes / browser prefetch).
  const matchMethod = m === 'HEAD' ? 'GET' : m;
  return PUBLIC_ROUTES.some((r) => r.method === matchMethod && r.url === url);
}

function extractToken(request: FastifyRequest): string | null {
  const auth = request.headers.authorization;
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    const bearer = auth.slice(7).trim();
    if (bearer) return bearer;
    // Empty bearer ("Bearer " with no token) — fall through to cookie.
  }
  // @fastify/cookie decorates request.cookies
  const cookies = (request as unknown as { cookies?: Record<string, string | undefined> }).cookies;
  if (cookies && typeof cookies.flowai_session === 'string' && cookies.flowai_session) {
    return cookies.flowai_session;
  }
  return null;
}

/**
 * Cookie options for clearCookie must match the attributes used when
 * setting the cookie or strict browsers (RFC 6265bis) ignore the clear.
 */
function clearOpts() {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
  };
}

/**
 * Registers an onRequest hook that resolves the session token to request.user.
 *
 * Runs BEFORE the audit middleware's preHandler, so by the time audit reads
 * request.user?.email, this hook has already populated it.
 *
 * Must be registered AFTER routes so request.routeOptions.url is populated.
 */
export async function registerAuthMiddleware(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const url = request.routeOptions?.url ?? request.url?.split('?')[0];
    if (isPublic(request.method, url)) return;

    const token = extractToken(request);
    if (!token) {
      (reply as unknown as { clearCookie?: (n: string, o?: unknown) => void }).clearCookie?.(
      'flowai_session',
      clearOpts(),
    );
      return reply.code(401).send({ error: 'unauthenticated' });
    }

    const resolved = await getSessionByToken(token).catch(() => null);
    if (!resolved) {
      (reply as unknown as { clearCookie?: (n: string, o?: unknown) => void }).clearCookie?.(
      'flowai_session',
      clearOpts(),
    );
      return reply.code(401).send({ error: 'unauthenticated' });
    }

    request.user = resolved.user;
    // Fire-and-forget touch — never await.
    void touchSession(token, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    }).catch(() => undefined);
    return;
  });
}

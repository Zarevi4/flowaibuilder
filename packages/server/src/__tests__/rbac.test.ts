import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { rolePermits, requireRole } from '../api/middleware/rbac.js';
import { requiredRoleForRoute, applyRouteRbac } from '../api/middleware/rbac-routes.js';
import type { AuthUser } from '@flowaibuilder/shared';

describe('AC #6: role hierarchy', () => {
  it('admin > editor > viewer', () => {
    expect(rolePermits('admin', 'editor')).toBe(true);
    expect(rolePermits('admin', 'admin')).toBe(true);
    expect(rolePermits('editor', 'viewer')).toBe(true);
    expect(rolePermits('editor', 'admin')).toBe(false);
    expect(rolePermits('viewer', 'editor')).toBe(false);
    expect(rolePermits(undefined, 'viewer')).toBe(false);
  });
});

describe('AC #6, #7: route → role matrix', () => {
  it('GETs require viewer', () => {
    expect(requiredRoleForRoute('GET', '/api/workflows')).toBe('viewer');
    expect(requiredRoleForRoute('GET', '/api/workflows/:id')).toBe('viewer');
  });
  it('workflow mutations require editor', () => {
    expect(requiredRoleForRoute('POST', '/api/workflows')).toBe('editor');
    expect(requiredRoleForRoute('DELETE', '/api/workflows/:id')).toBe('editor');
  });
  it('user management requires admin', () => {
    expect(requiredRoleForRoute('POST', '/api/users')).toBe('admin');
    expect(requiredRoleForRoute('DELETE', '/api/users/:id')).toBe('admin');
    expect(requiredRoleForRoute('GET', '/api/users')).toBe('admin');
  });
  it('PUT /api/settings requires admin', () => {
    expect(requiredRoleForRoute('PUT', '/api/settings')).toBe('admin');
  });
  it('auth and health are unguarded (public)', () => {
    expect(requiredRoleForRoute('POST', '/api/auth/login')).toBeNull();
    expect(requiredRoleForRoute('GET', '/api/health')).toBeNull();
    expect(requiredRoleForRoute('GET', '/mcp/sse')).toBeNull();
  });
});

describe('AC #6: Fastify integration', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify();
    // Fake routes — we bypass the auth middleware entirely and set request.user manually.
    app.addHook('onRequest', async (request: FastifyRequest) => {
      const header = request.headers['x-test-role'];
      if (typeof header === 'string') {
        request.user = {
          id: 'u1',
          email: 'test@example.com',
          name: 'T',
          role: header as AuthUser['role'],
        };
      }
    });
    app.get('/api/workflows', async () => ({ workflows: [] }));
    app.post('/api/workflows', async () => ({ id: 'wf-1' }));
    app.post('/api/users', async () => ({ id: 'u-new' }));
    await applyRouteRbac(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('viewer can GET /api/workflows', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/workflows',
      headers: { 'x-test-role': 'viewer' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('viewer cannot POST /api/workflows → 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/workflows',
      headers: { 'x-test-role': 'viewer' },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).required_role).toBe('editor');
  });

  it('editor can POST /api/workflows', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/workflows',
      headers: { 'x-test-role': 'editor' },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
  });

  it('editor cannot POST /api/users → 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { 'x-test-role': 'editor' },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).required_role).toBe('admin');
  });

  it('admin can POST /api/users', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { 'x-test-role': 'admin' },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
  });

  it('requireRole factory rejects unauthenticated with 401', async () => {
    const guard = requireRole('editor');
    const localApp = Fastify();
    localApp.get('/guarded', { preHandler: guard }, async () => ({ ok: true }));
    const res = await localApp.inject({ method: 'GET', url: '/guarded' });
    expect(res.statusCode).toBe(401);
    await localApp.close();
  });
});

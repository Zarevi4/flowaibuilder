import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';

vi.mock('../db/index.js', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([{ id: 'wf-1', name: 'before-name' }])),
      })),
    })),
    insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) })),
  },
}));

vi.mock('../db/schema.js', () => ({
  workflows: { _: { name: 'workflows' }, id: 'id' },
  auditLog: { _: { name: 'audit_log' } },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
}));

import { registerAuditMiddleware, resolveAction } from '../api/middleware/audit.js';
import { AuditLogger } from '../audit/logger.js';

describe('resolveAction', () => {
  it('maps workflow CRUD routes', () => {
    expect(resolveAction('POST', '/api/workflows')?.action).toBe('workflow.created');
    expect(resolveAction('PUT', '/api/workflows/:id')?.action).toBe('workflow.updated');
    expect(resolveAction('DELETE', '/api/workflows/:id')?.action).toBe('workflow.deleted');
    expect(resolveAction('POST', '/api/workflows/:id/execute')?.action).toBe('execution.started');
  });

  it('skips audit-log route and health', () => {
    expect(resolveAction('GET', '/api/audit-log')).toBeNull();
    expect(resolveAction('GET', '/api/health')).toBeNull();
  });

  it('unknown /api routes get fallback action', () => {
    expect(resolveAction('POST', '/api/custom-thing')?.action).toBe('api.post.custom-thing');
  });
});

describe('Audit middleware plugin', () => {
  let app: ReturnType<typeof Fastify>;
  const writes: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    app = Fastify();
    // Inject a fake audit logger that captures writes
    app.decorate('audit', {
      write: async (entry: Record<string, unknown>) => {
        writes.push(entry);
      },
    } as unknown as AuditLogger);

    // Fake /api/workflows POST
    app.post('/api/workflows', async () => ({ id: 'wf-new', name: 'new' }));
    // Fake /api/workflows/:id DELETE
    app.delete('/api/workflows/:id', async () => ({ deleted: true }));
    // Fake GET that should be ignored
    app.get('/api/workflows', async () => ({ workflows: [] }));
    // Fake route that 400s
    app.post('/api/workflows-fail', async (_req, reply) => reply.code(400).send({ error: 'bad' }));

    await registerAuditMiddleware(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('logs a successful POST /api/workflows as workflow.created', async () => {
    writes.length = 0;
    const res = await app.inject({ method: 'POST', url: '/api/workflows', payload: { name: 'x' } });
    expect(res.statusCode).toBe(200);
    expect(writes).toHaveLength(1);
    expect(writes[0].action).toBe('workflow.created');
    expect(writes[0].resourceType).toBe('workflow');
    const changes = writes[0].changes as { after: Record<string, unknown> };
    expect(changes.after.id).toBe('wf-new');
  });

  it('logs DELETE with before snapshot', async () => {
    writes.length = 0;
    const res = await app.inject({ method: 'DELETE', url: '/api/workflows/wf-1' });
    expect(res.statusCode).toBe(200);
    expect(writes).toHaveLength(1);
    expect(writes[0].action).toBe('workflow.deleted');
    expect(writes[0].resourceId).toBe('wf-1');
    const changes = writes[0].changes as { before: Record<string, unknown> };
    expect(changes.before.id).toBe('wf-1');
  });

  it('does NOT log GET requests', async () => {
    writes.length = 0;
    await app.inject({ method: 'GET', url: '/api/workflows' });
    expect(writes).toHaveLength(0);
  });

  it('does NOT log failed (4xx) mutations', async () => {
    writes.length = 0;
    const res = await app.inject({ method: 'POST', url: '/api/workflows-fail' });
    expect(res.statusCode).toBe(400);
    expect(writes).toHaveLength(0);
  });
});

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';

type Row = Record<string, unknown>;
const state: { workflows: Row[] } = { workflows: [] };

vi.mock('drizzle-orm', () => ({
  eq: (col: { _col: string }, val: unknown) => ({ kind: 'eq', col: col._col, val }),
  and: (...conds: unknown[]) => ({ kind: 'and', conds }),
  desc: (col: { _col: string }) => ({ kind: 'desc', col: col._col }),
}));

vi.mock('../db/schema.js', () => {
  const mk = (table: string, cols: string[]) => {
    const out: Record<string, unknown> = { _table: table, $inferSelect: {} };
    for (const c of cols) out[c] = { _col: c, _table: table };
    return out;
  };
  return {
    workflows: mk('workflows', ['id']),
    executions: mk('executions', ['id', 'workflowId', 'startedAt']),
    taskNodeLinks: mk('task_node_links', ['id', 'workflowId']),
  };
});

vi.mock('../db/index.js', () => {
  function selectChain() {
    let filter: { col: string; val: unknown } | null = null;
    const chain: Record<string, unknown> = {
      where: vi.fn((f: { col: string; val: unknown }) => {
        filter = f;
        return chain;
      }),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(() => Promise.resolve(state.workflows.filter((r) => !filter || r[filter.col] === filter.val))),
      then: (resolve: (v: Row[]) => void) =>
        resolve(state.workflows.filter((r) => !filter || r[filter.col] === filter.val)),
    };
    return chain;
  }
  return {
    db: {
      select: vi.fn(() => ({ from: vi.fn(() => selectChain()) })),
      insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([])) })) })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([])) })) })) })),
      delete: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })),
    },
  };
});

// Stub side-effecting modules pulled in by workflowRoutes
vi.mock('../api/ws/broadcaster.js', () => ({ getBroadcaster: () => null }));
vi.mock('../agent-teams/index.js', () => ({ getTeamWatcher: () => null }));
vi.mock('../review/triggers.js', () => ({ maybeEmitAutoReview: vi.fn() }));
vi.mock('../review/store.js', () => ({ annotationStore: { list: vi.fn(() => []), clear: vi.fn() } }));
vi.mock('../zones/enforcer.js', () => ({
  assertNodeNotPinned: vi.fn(),
  assertConnectionEndpointsNotPinned: vi.fn(),
}));
vi.mock('../zones/service.js', () => ({
  createZoneCore: vi.fn(),
  deleteZoneCore: vi.fn(),
  updateZoneCore: vi.fn(),
  addToZoneCore: vi.fn(),
  removeFromZoneCore: vi.fn(),
  getZonesCore: vi.fn(async () => []),
  ZoneServiceError: class ZoneServiceError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

describe('Workflow export route (real plugin)', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    state.workflows.push({
      id: 'wf-1',
      name: 'Demo Flow',
      description: 'demo',
      nodes: [
        { id: 'n1', type: 'webhook', name: 'Webhook', position: { x: 0, y: 0 }, data: { label: 'Webhook', config: {} }, createdAt: 't', updatedAt: 't' },
        { id: 'n2', type: 'respond-webhook', name: 'Respond', position: { x: 100, y: 0 }, data: { label: 'Respond', config: {} }, createdAt: 't', updatedAt: 't' },
      ],
      connections: [{ id: 'c1', sourceNodeId: 'n1', targetNodeId: 'n2' }],
      active: false,
      version: 1,
      environment: 'dev',
      canvas: {},
      settings: {},
      tags: [],
      createdBy: 'test',
      updatedBy: 'test',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    app = Fastify();
    const { workflowRoutes } = await import('../api/routes/workflows.js');
    await workflowRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns mermaid JSON envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/workflows/wf-1/export?format=mermaid' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.format).toBe('mermaid');
    expect(body.content.startsWith('flowchart LR')).toBe(true);
  });

  it('?download=1 returns raw text + Content-Disposition', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/workflows/wf-1/export?format=mermaid&download=1',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.body.startsWith('flowchart LR')).toBe(true);
  });

  it('unknown format → 400 with descriptive error', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/workflows/wf-1/export?format=bogus' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('Valid: prompt, typescript, python, mermaid, json');
  });

  it('unknown id → 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/workflows/nope/export?format=json' });
    expect(res.statusCode).toBe(404);
  });
});

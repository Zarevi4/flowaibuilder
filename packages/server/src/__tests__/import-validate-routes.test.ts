import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';

type Row = Record<string, unknown>;
const state: { workflows: Row[] } = { workflows: [] };
let nextInsertId = 1;

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
      insert: vi.fn(() => ({
        values: vi.fn((vals: Record<string, unknown>) => ({
          returning: vi.fn(() => {
            const row: Row = {
              id: `wf-new-${nextInsertId++}`,
              name: vals.name ?? '',
              description: vals.description ?? '',
              nodes: vals.nodes ?? [],
              connections: vals.connections ?? [],
              active: false,
              version: 1,
              environment: 'dev',
              canvas: {},
              settings: {},
              tags: [],
              createdBy: vals.createdBy ?? 'test',
              updatedBy: vals.updatedBy ?? 'test',
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            state.workflows.push(row);
            return Promise.resolve([row]);
          }),
        })),
      })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([])) })) })) })),
      delete: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })),
    },
  };
});

vi.mock('../api/ws/broadcaster.js', () => ({ getBroadcaster: () => ({ broadcast: vi.fn(), broadcastToWorkflow: vi.fn() }) }));
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

describe('Import + Validate REST routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    state.workflows.push({
      id: 'bad-wf',
      name: 'bad',
      description: '',
      nodes: [
        { id: 'h', type: 'http-request', name: 'H', position: { x: 0, y: 0 }, data: { label: 'H', config: { url: '' } }, createdAt: 't', updatedAt: 't' },
      ],
      connections: [],
      active: false,
      version: 1,
      environment: 'dev',
      canvas: {},
      settings: {},
      tags: [],
      createdBy: 't',
      updatedBy: 't',
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

  it('POST /api/workflows/import-n8n with valid payload → 200 + workflow + warnings', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/workflows/import-n8n',
      payload: {
        n8n_workflow_json: {
          name: 'Imp',
          nodes: [
            { id: 'w', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: { path: 'p' } },
          ],
          connections: {},
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.workflow).toBeDefined();
    expect(body.warnings).toEqual([]);
    expect(body.workflow.nodes).toHaveLength(1);
    expect(state.workflows.some((r) => r.id === body.workflow.id)).toBe(true);
  });

  it('POST /api/workflows/import-n8n with null payload → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/workflows/import-n8n',
      payload: { n8n_workflow_json: null },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('Invalid n8n export');
  });

  it('POST /api/workflows/:id/validate → 200 with error issues', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/workflows/bad-wf/validate' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.valid).toBe(false);
    expect(body.issues.some((i: { code: string }) => i.code === 'missing-required-config')).toBe(true);
  });

  it('POST /api/workflows/unknown/validate → 404', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/workflows/unknown/validate' });
    expect(res.statusCode).toBe(404);
  });
});

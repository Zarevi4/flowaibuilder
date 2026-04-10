import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

// ─── In-memory DB mock (mirrors zone-enforcer.test.ts) ────────
type Row = Record<string, unknown>;
const state: {
  workflows: Row[];
  protectedZones: Row[];
} = {
  workflows: [],
  protectedZones: [],
};

function resetState() {
  state.workflows = [];
  state.protectedZones = [];
}

vi.mock('drizzle-orm', () => ({
  eq: (col: { _col: string; _table: string }, val: unknown) => ({ kind: 'eq', col: col._col, table: col._table, val }),
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
    protectedZones: mk('protectedZones', ['id', 'workflowId']),
    executions: mk('executions', ['id', 'workflowId']),
    annotations: mk('annotations', ['id', 'workflowId']),
    workflowReviews: mk('workflowReviews', ['id', 'workflowId']),
    taskNodeLinks: mk('taskNodeLinks', ['id', 'workflowId']),
    instanceSettings: mk('instanceSettings', ['id']),
  };
});

function tableNameFromArg(arg: unknown): string {
  return (arg as { _table?: string })?._table ?? '';
}

function matchesFilter(row: Row, filter: unknown): boolean {
  if (!filter) return true;
  const f = filter as { kind: string; conds?: unknown[]; col?: string; val?: unknown };
  if (f.kind === 'and') return (f.conds ?? []).every(c => matchesFilter(row, c));
  if (f.kind === 'eq') return row[f.col as string] === f.val;
  return true;
}

let nextId = 1;
function genId(prefix: string) { return `${prefix}-${nextId++}`; }

vi.mock('../db/index.js', () => {
  function selectChain(pool: () => Row[]) {
    let filter: unknown;
    const chain: Record<string, unknown> = {
      where: vi.fn((f: unknown) => { filter = f; return chain; }),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(async (n: number) => pool().filter(r => matchesFilter(r, filter)).slice(0, n)),
      then: (resolve: (v: Row[]) => void) => resolve(pool().filter(r => matchesFilter(r, filter))),
    };
    return chain;
  }
  const db = {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => {
        const name = tableNameFromArg(table);
        const pool = () => (state[name as keyof typeof state] as Row[]) ?? [];
        return selectChain(pool);
      }),
    })),
    insert: vi.fn((table: unknown) => {
      const name = tableNameFromArg(table);
      return {
        values: vi.fn((vals: Row | Row[]) => ({
          returning: vi.fn(async () => {
            const list = Array.isArray(vals) ? vals : [vals];
            const stamped = list.map(v => ({ id: v.id ?? genId(name), pinnedAt: new Date(), ...v }));
            (state[name as keyof typeof state] as Row[]).push(...stamped);
            return stamped;
          }),
        })),
      };
    }),
    update: vi.fn((table: unknown) => {
      const name = tableNameFromArg(table);
      return {
        set: vi.fn((patch: Row) => ({
          where: vi.fn((filter: unknown) => {
            const apply = () => {
              const rows = (state[name as keyof typeof state] as Row[]).filter(r => matchesFilter(r, filter));
              for (const r of rows) Object.assign(r, patch);
              return rows;
            };
            return {
              returning: vi.fn(async () => apply()),
              then: (resolve: (v: Row[]) => void) => resolve(apply()),
            };
          }),
        })),
      };
    }),
    delete: vi.fn((table: unknown) => {
      const name = tableNameFromArg(table);
      return {
        where: vi.fn((filter: unknown) => {
          const apply = () => {
            const list = state[name as keyof typeof state] as Row[];
            const removed: Row[] = [];
            for (let i = list.length - 1; i >= 0; i--) {
              if (matchesFilter(list[i], filter)) {
                removed.push(list[i]);
                list.splice(i, 1);
              }
            }
            return removed;
          };
          return { returning: vi.fn(async () => apply()) };
        }),
      };
    }),
  };
  return { db };
});

const broadcastToWorkflowSpy = vi.fn();
vi.mock('../api/ws/broadcaster.js', () => ({
  getBroadcaster: () => ({
    broadcast: vi.fn(),
    broadcastToWorkflow: broadcastToWorkflowSpy,
  }),
}));

vi.mock('../review/triggers.js', () => ({
  maybeEmitAutoReview: vi.fn(async () => undefined),
}));

vi.mock('../agent-teams/index.js', () => ({
  getTeamWatcher: () => ({
    isWatching: () => false,
    getSnapshot: async () => ({ tasks: [] }),
  }),
}));

vi.mock('../review/store.js', () => ({
  annotationStore: { getLatestReview: async () => null },
}));

const WF = 'wf-zone-rest';

function seedWorkflow(nodes: Array<{ id: string }>, connections: Array<{ id: string; sourceNodeId: string; targetNodeId: string }> = []) {
  state.workflows.push({
    id: WF,
    name: 'wf',
    description: '',
    nodes: nodes.map(n => ({ id: n.id, type: 'set', name: n.id, position: { x: 0, y: 0 }, data: { label: n.id, config: {} }, createdAt: '', updatedAt: '' })),
    connections,
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
}

function pin(zoneName: string, nodeIds: string[], zoneId = `zone-${zoneName}`) {
  state.protectedZones.push({
    id: zoneId,
    workflowId: WF,
    name: zoneName,
    nodeIds,
    color: '#378ADD',
    pinnedBy: 'ui:user',
    pinnedAt: new Date(),
  });
  return zoneId;
}

async function buildApp() {
  const app = Fastify();
  const { workflowRoutes } = await import('../api/routes/workflows.js');
  await workflowRoutes(app);
  await app.ready();
  return app;
}

beforeEach(() => {
  resetState();
  broadcastToWorkflowSpy.mockClear();
  nextId = 1;
});

describe('Zones REST routes', () => {
  it('GET /zones returns empty array when none', async () => {
    seedWorkflow([{ id: 'n1' }]);
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/api/workflows/${WF}/zones` });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ zones: [] });
    await app.close();
  });

  it('POST /zones creates a zone with pinnedBy=ui:user and broadcasts zone_created', async () => {
    seedWorkflow([{ id: 'n1' }, { id: 'n2' }]);
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/${WF}/zones`,
      payload: { name: 'crit', node_ids: ['n1', 'n2'] },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.zone.name).toBe('crit');
    expect(body.zone.nodeIds).toEqual(['n1', 'n2']);
    expect(body.zone.pinnedBy).toBe('ui:user');
    expect(broadcastToWorkflowSpy.mock.calls.find(c => c[1] === 'zone_created')).toBeDefined();
    await app.close();
  });

  it('PATCH /zones/:zoneId renames and broadcasts zone_updated', async () => {
    seedWorkflow([{ id: 'n1' }]);
    const zoneId = pin('old', ['n1']);
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/workflows/${WF}/zones/${zoneId}`,
      payload: { name: 'new' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.zone.name).toBe('new');
    expect(broadcastToWorkflowSpy.mock.calls.find(c => c[1] === 'zone_updated')).toBeDefined();
    await app.close();
  });

  it('DELETE /zones/:zoneId removes and broadcasts zone_deleted', async () => {
    seedWorkflow([{ id: 'n1' }]);
    const zoneId = pin('crit', ['n1']);
    const app = await buildApp();
    const res = await app.inject({ method: 'DELETE', url: `/api/workflows/${WF}/zones/${zoneId}` });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ deleted: true, zone_id: zoneId });
    expect(state.protectedZones).toHaveLength(0);
    expect(broadcastToWorkflowSpy.mock.calls.find(c => c[1] === 'zone_deleted')).toBeDefined();
    await app.close();
  });

  it('POST /zones/:zoneId/add adds nodes', async () => {
    seedWorkflow([{ id: 'n1' }, { id: 'n2' }]);
    const zoneId = pin('crit', ['n1']);
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/${WF}/zones/${zoneId}/add`,
      payload: { node_ids: ['n2'] },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).zone.nodeIds).toEqual(['n1', 'n2']);
    await app.close();
  });

  it('POST /zones/:zoneId/remove deletes zone when last node removed', async () => {
    seedWorkflow([{ id: 'n1' }]);
    const zoneId = pin('crit', ['n1']);
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/${WF}/zones/${zoneId}/remove`,
      payload: { node_ids: ['n1'] },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ deleted: true, zone_id: zoneId });
    expect(state.protectedZones).toHaveLength(0);
    await app.close();
  });
});

describe('REST node-mutation enforcement (Story 3.1 gap closed)', () => {
  it('PATCH node returns 409 when node is pinned', async () => {
    seedWorkflow([{ id: 'n1' }]);
    pin('crit', ['n1']);
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/workflows/${WF}/nodes/n1`,
      payload: { name: 'renamed' },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toMatch(/^PROTECTED ZONE:/);
    await app.close();
  });

  it('PATCH node succeeds when node is not pinned', async () => {
    seedWorkflow([{ id: 'n1' }, { id: 'n2' }]);
    pin('crit', ['n1']);
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/workflows/${WF}/nodes/n2`,
      payload: { name: 'ok' },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('DELETE node returns 409 when node is pinned', async () => {
    seedWorkflow([{ id: 'n1' }]);
    pin('crit', ['n1']);
    const app = await buildApp();
    const res = await app.inject({ method: 'DELETE', url: `/api/workflows/${WF}/nodes/n1` });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toMatch(/^PROTECTED ZONE:/);
    await app.close();
  });

  it('DELETE connection returns 409 when an endpoint is pinned', async () => {
    seedWorkflow(
      [{ id: 'n1' }, { id: 'n2' }],
      [{ id: 'c1', sourceNodeId: 'n1', targetNodeId: 'n2' }],
    );
    pin('crit', ['n1']);
    const app = await buildApp();
    const res = await app.inject({ method: 'DELETE', url: `/api/workflows/${WF}/connections/c1` });
    expect(res.statusCode).toBe(409);
    await app.close();
  });

  it('DELETE connection succeeds when neither endpoint pinned', async () => {
    seedWorkflow(
      [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }],
      [
        { id: 'c1', sourceNodeId: 'n1', targetNodeId: 'n2' },
        { id: 'c2', sourceNodeId: 'n2', targetNodeId: 'n3' },
      ],
    );
    pin('crit', ['n3']);
    const app = await buildApp();
    const res = await app.inject({ method: 'DELETE', url: `/api/workflows/${WF}/connections/c1` });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

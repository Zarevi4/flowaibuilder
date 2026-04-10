import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';

type Row = Record<string, unknown>;
const state: {
  workflows: Row[];
  workflowVersions: Row[];
  instanceSettings: Row[];
} = { workflows: [], workflowVersions: [], instanceSettings: [] };
let nextVersionRowId = 1;

vi.mock('drizzle-orm', () => ({
  eq: (col: { _col: string }, val: unknown) => ({ kind: 'eq', col: col._col, val }),
  and: (...conds: unknown[]) => ({ kind: 'and', conds }),
  or: (...conds: unknown[]) => ({ kind: 'or', conds }),
  desc: (col: { _col: string }) => ({ kind: 'desc', col: col._col }),
  isNotNull: (col: { _col: string }) => ({ kind: 'notnull', col: col._col }),
  sql: Object.assign(vi.fn(() => ({})), { raw: vi.fn(() => ({})) }),
}));

vi.mock('../db/schema.js', () => {
  const mk = (table: string, cols: string[]) => {
    const out: Record<string, unknown> = { _table: table, $inferSelect: {} };
    for (const c of cols) out[c] = { _col: c, _table: table };
    return out;
  };
  return {
    workflows: mk('workflows', ['id', 'version', 'name']),
    workflowVersions: mk('workflow_versions', ['id', 'workflowId', 'version', 'gitSha']),
    instanceSettings: mk('instance_settings', ['id']),
    executions: mk('executions', ['id', 'workflowId', 'startedAt']),
    taskNodeLinks: mk('task_node_links', ['id', 'workflowId']),
  };
});

// Conditions evaluated from the stub filter.
type Cond = { kind: string; col?: string; val?: unknown; conds?: Cond[] };
function applyFilter(rows: Row[], cond: Cond | null | undefined): Row[] {
  if (!cond) return rows;
  if (cond.kind === 'eq') return rows.filter((r) => r[cond.col!] === cond.val);
  if (cond.kind === 'and') return cond.conds!.reduce((acc: Row[], c) => applyFilter(acc, c), rows);
  if (cond.kind === 'notnull') return rows.filter((r) => r[cond.col!] != null);
  return rows;
}

function poolFor(table: unknown): Row[] {
  const name = (table as { _table?: string })._table ?? '';
  if (name === 'workflow_versions') return state.workflowVersions;
  if (name === 'instance_settings') return state.instanceSettings;
  return state.workflows;
}

vi.mock('../db/index.js', () => {
  function selectChain(pool: Row[], projection?: Record<string, unknown>) {
    let filter: Cond | null = null;
    const materialize = () => {
      let out = applyFilter(pool, filter);
      // Shallow clone so `before` vs `after` references are distinct, but
      // preserve Date objects (JSON round-trip would stringify them).
      out = out.map((r) => {
        const copy: Row = {};
        for (const [k, v] of Object.entries(r)) {
          if (Array.isArray(v)) copy[k] = [...v];
          else if (v && typeof v === 'object' && !(v instanceof Date)) copy[k] = { ...(v as object) };
          else copy[k] = v;
        }
        return copy;
      });
      if (projection) {
        const keys = Object.keys(projection);
        out = out.map((r) => {
          const p: Row = {};
          for (const k of keys) p[k] = r[k];
          return p;
        });
      }
      return out;
    };
    const chain: Record<string, unknown> = {
      where: vi.fn((f: Cond) => { filter = f; return chain; }),
      orderBy: vi.fn(() => chain),
      limit: vi.fn((_n: number) => Promise.resolve(materialize())),
      then: (resolve: (v: Row[]) => void) => resolve(materialize()),
    };
    return chain;
  }
  return {
    db: {
      select: vi.fn((projection?: Record<string, unknown>) => ({
        from: vi.fn((table: unknown) => selectChain(poolFor(table), projection)),
      })),
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((vals: Record<string, unknown>) => {
          const pool = poolFor(table);
          const doInsert = () => {
            let row: Row;
            if (pool === state.workflowVersions) {
              row = { id: `v-${nextVersionRowId++}`, ...vals, createdAt: new Date() };
            } else if (pool === state.instanceSettings) {
              row = { id: 'singleton', ...vals, updatedAt: new Date() };
            } else {
              row = {
                id: `wf-${Math.random().toString(36).slice(2, 8)}`,
                name: vals.name ?? '',
                description: vals.description ?? '',
                nodes: [],
                connections: [],
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
            }
            pool.push(row);
            return [row];
          };
          return {
            returning: vi.fn(() => Promise.resolve(doInsert())),
            onConflictDoNothing: vi.fn(() => Promise.resolve().then(() => {
              if (!pool.find((r) => r.id === 'singleton')) doInsert();
            })),
          };
        }),
      })),
      update: vi.fn((table: unknown) => ({
        set: vi.fn((patch: Row) => ({
          where: vi.fn((f: Cond) => {
            const affected = applyFilter(poolFor(table), f);
            for (const r of affected) Object.assign(r, patch);
            return {
              returning: vi.fn(() => Promise.resolve(affected)),
              then: (resolve: (v: Row[]) => void) => resolve(affected),
            };
          }),
        })),
      })),
      delete: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })),
      transaction: undefined, // exercises the non-txn fallback path in store.ts
    },
  };
});

vi.mock('../api/ws/broadcaster.js', () => ({
  getBroadcaster: () => ({ broadcast: vi.fn(), broadcastToWorkflow: vi.fn() }),
}));
vi.mock('../agent-teams/index.js', () => ({ getTeamWatcher: () => null }));
vi.mock('../review/triggers.js', () => ({ maybeEmitAutoReview: vi.fn(async () => undefined) }));
vi.mock('../review/store.js', () => ({ annotationStore: { list: vi.fn(() => []), clear: vi.fn(), getLatestReview: vi.fn(async () => null) } }));
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
    constructor(code: string, message: string) { super(message); this.code = code; }
  },
}));
vi.mock('../versioning/git.js', () => ({
  pushWorkflow: vi.fn(async (wfId: string) => ({ sha: 'abc123sha', file: `workflows/${wfId}.json` })),
  defaultRepoPath: vi.fn(() => '/tmp/flowai-git-test'),
}));

describe('Versioning REST routes (Story 5.3)', () => {
  let app: ReturnType<typeof Fastify>;
  let wfId: string;

  beforeAll(async () => {
    app = Fastify({ logger: { level: 'error' } });
    const { workflowRoutes } = await import('../api/routes/workflows.js');
    await workflowRoutes(app);
    await app.ready();

    // Create a workflow — should auto-create v1.
    const res = await app.inject({
      method: 'POST',
      url: '/api/workflows',
      payload: { name: 'test wf' },
    });
    wfId = JSON.parse(res.body).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates an initial version v1 on workflow create (AC #2)', () => {
    const rows = state.workflowVersions.filter((r) => r.workflowId === wfId);
    expect(rows.length).toBe(1);
    expect(rows[0].version).toBe(1);
    expect(rows[0].message).toBe('initial');
  });

  it('PUT /api/workflows/:id with graph change → v2 (AC #1)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/workflows/${wfId}`,
      payload: { nodes: [{ id: 'n1', type: 'code-js', name: 'N1', position: { x: 0, y: 0 }, data: { label: 'N1', config: {} }, createdAt: 't', updatedAt: 't' }] },
    });
    expect(res.statusCode).toBe(200);
    const versions = state.workflowVersions.filter((r) => r.workflowId === wfId);
    expect(versions.length).toBe(2);
    expect(versions[versions.length - 1].version).toBe(2);
  });

  it('PUT with cosmetic-only payload does NOT create a new version (AC #1)', async () => {
    // Seed the workflow with a known graph, then re-PUT the identical graph.
    // This exercises the real cosmetic-touch path: shouldVersion sees the
    // same nodes/connections on both sides and must return false.
    const canonicalNodes = [{
      id: 'n-cosmetic',
      type: 'code-js',
      name: 'Cosmetic',
      position: { x: 0, y: 0 },
      data: { label: 'Cosmetic', config: { foo: 'bar' } },
      createdAt: 't', updatedAt: 't',
    }];
    await app.inject({
      method: 'PUT',
      url: `/api/workflows/${wfId}`,
      payload: { nodes: canonicalNodes },
    });
    const before = state.workflowVersions.filter((r) => r.workflowId === wfId).length;

    // Re-PUT with the byte-identical graph — only updatedAt would change in
    // a real DB. shouldVersion must return false and suppress the snapshot.
    const res = await app.inject({
      method: 'PUT',
      url: `/api/workflows/${wfId}`,
      payload: { nodes: canonicalNodes },
    });
    expect(res.statusCode).toBe(200);
    const after = state.workflowVersions.filter((r) => r.workflowId === wfId).length;
    expect(after).toBe(before);
  });

  it('GET /api/workflows/:id/versions returns meta without snapshot payload (AC #3)', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/workflows/${wfId}/versions` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.versions)).toBe(true);
    expect(body.versions[0]).not.toHaveProperty('snapshot');
    expect(body.versions[0]).toHaveProperty('version');
  });

  it('GET /api/workflows/:id/versions/:version returns full snapshot (AC #4)', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/workflows/${wfId}/versions/1` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.version).toBe(1);
    expect(body.snapshot).toBeDefined();
  });

  it('GET /api/workflows/:id/diff computes a diff (AC #5)', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/workflows/${wfId}/diff?from=1&to=2` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.from).toBe(1);
    expect(body.to).toBe(2);
    expect(Array.isArray(body.nodes.added)).toBe(true);
  });

  it('POST /api/workflows/:id/revert creates a new version (AC #6)', async () => {
    const before = state.workflowVersions.filter((r) => r.workflowId === wfId).length;
    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/${wfId}/revert`,
      payload: { version: 1 },
    });
    expect(res.statusCode).toBe(200);
    const after = state.workflowVersions.filter((r) => r.workflowId === wfId).length;
    expect(after).toBe(before + 1);
  });

  it('POST /api/workflows/:id/git/push returns 501 when git sync disabled (AC #8)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/${wfId}/git/push`,
      payload: { message: 'test' },
    });
    expect(res.statusCode).toBe(501);
  });
});

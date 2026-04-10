import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
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
    workflows: mk('workflows', ['id', 'version', 'name', 'environment']),
    workflowVersions: mk('workflow_versions', ['id', 'workflowId', 'version', 'gitSha']),
    instanceSettings: mk('instance_settings', ['id']),
    executions: mk('executions', ['id', 'workflowId', 'startedAt']),
    taskNodeLinks: mk('task_node_links', ['id', 'workflowId']),
  };
});

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
      from: vi.fn(() => chain),
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
            } else {
              row = {
                id: `wf-${Math.random().toString(36).slice(2, 8)}`,
                name: vals.name ?? '',
                description: vals.description ?? '',
                nodes: [], connections: [], active: false, version: 1,
                environment: 'dev', canvas: {}, settings: {}, tags: [],
                createdBy: vals.createdBy ?? 'test',
                updatedBy: vals.updatedBy ?? 'test',
                createdAt: new Date(), updatedAt: new Date(),
              };
            }
            pool.push(row);
            return [row];
          };
          return {
            returning: vi.fn(() => Promise.resolve(doInsert())),
            onConflictDoNothing: vi.fn(() => Promise.resolve()),
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
      delete: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([])) })) })),
    },
  };
});

vi.mock('../api/ws/broadcaster.js', () => ({
  getBroadcaster: () => ({ broadcast: vi.fn(), broadcastToWorkflow: vi.fn() }),
}));
vi.mock('../agent-teams/index.js', () => ({ getTeamWatcher: () => null }));
vi.mock('../review/triggers.js', () => ({ maybeEmitAutoReview: vi.fn(async () => undefined) }));
vi.mock('../review/store.js', () => ({
  annotationStore: { list: vi.fn(() => []), clear: vi.fn(), getLatestReview: vi.fn(async () => null) },
}));
vi.mock('../zones/enforcer.js', () => ({
  assertNodeNotPinned: vi.fn(),
  assertConnectionEndpointsNotPinned: vi.fn(),
}));
vi.mock('../zones/service.js', () => ({
  createZoneCore: vi.fn(), deleteZoneCore: vi.fn(), updateZoneCore: vi.fn(),
  addToZoneCore: vi.fn(), removeFromZoneCore: vi.fn(), getZonesCore: vi.fn(async () => []),
  ZoneServiceError: class extends Error { code: string; constructor(c: string, m: string) { super(m); this.code = c; } },
}));
vi.mock('../versioning/git.js', () => ({
  pushWorkflow: vi.fn(async (wfId: string) => ({ sha: 'abc123', file: `workflows/${wfId}.json` })),
  defaultRepoPath: vi.fn(() => '/tmp/test'),
}));
vi.mock('../crypto/aes.js', () => ({
  encrypt: (val: string) => `encrypted:${val}`,
  decrypt: (val: string) => val.replace('encrypted:', ''),
}));

const auditEntries: Record<string, unknown>[] = [];

describe('Environment promotion (Story 5.4 AC #1)', () => {
  let app: ReturnType<typeof Fastify>;
  let wfId: string;

  beforeAll(async () => {
    app = Fastify({ logger: { level: 'error' } });
    app.decorateRequest('user', null);
    app.addHook('preHandler', async (req: Record<string, unknown>) => {
      req.user = { email: 'editor@test.com', role: 'editor' };
    });
    app.decorate('audit', {
      write: vi.fn(async (entry: Record<string, unknown>) => { auditEntries.push(entry); }),
    });

    const { workflowRoutes } = await import('../api/routes/workflows.js');
    await workflowRoutes(app);
    await app.ready();

    const res = await app.inject({
      method: 'POST', url: '/api/workflows',
      payload: { name: 'promote-test' },
    });
    wfId = JSON.parse(res.body).id;
  });

  afterAll(async () => { await app.close(); });
  beforeEach(() => { auditEntries.length = 0; });

  it('promotes dev -> staging (AC #1)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/${wfId}/promote`,
      payload: { environment: 'staging' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.promoted).toBe(true);
    expect(body.from).toBe('dev');
    expect(body.to).toBe('staging');
  });

  it('returns no-op for already-in-target environment', async () => {
    // wfId is now 'staging' from prior test
    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/${wfId}/promote`,
      payload: { environment: 'staging' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.promoted).toBe(false);
    expect(body.reason).toBe('already in target');
  });

  it('rejects invalid environment with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/${wfId}/promote`,
      payload: { environment: 'invalid' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('writes workflow.promoted audit entry', async () => {
    // Reset to dev first
    const wf = state.workflows.find((w) => w.id === wfId);
    if (wf) wf.environment = 'dev';

    await app.inject({
      method: 'POST',
      url: `/api/workflows/${wfId}/promote`,
      payload: { environment: 'prod' },
    });

    const promoteAudit = auditEntries.find((e) => e.action === 'workflow.promoted');
    expect(promoteAudit).toBeDefined();
    expect((promoteAudit!.metadata as Record<string, unknown>).from).toBe('dev');
    expect((promoteAudit!.metadata as Record<string, unknown>).to).toBe('prod');
  });
});

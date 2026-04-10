import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

type Row = Record<string, unknown>;
const state: { workflows: Row[]; workflowReviews: Row[] } = { workflows: [], workflowReviews: [] };

vi.mock('drizzle-orm', () => ({
  eq: (col: { _col: string }, val: unknown) => ({ kind: 'eq', col: col._col, val }),
  desc: (col: { _col: string }) => ({ kind: 'desc', col: col._col }),
  and: (...conds: unknown[]) => ({ kind: 'and', conds }),
}));

vi.mock('../db/schema.js', () => {
  const mk = (table: string, cols: string[]) => {
    const out: Record<string, unknown> = { _table: table, $inferSelect: {} };
    for (const c of cols) out[c] = { _col: c, _table: table };
    return out;
  };
  return {
    workflows: mk('workflows', ['id']),
    workflowReviews: mk('workflowReviews', ['id', 'workflowId', 'createdAt']),
    executions: mk('executions', ['id', 'workflowId']),
    taskNodeLinks: mk('taskNodeLinks', ['id']),
    annotations: mk('annotations', ['id', 'workflowId', 'status']),
  };
});

function matches(row: Row, filter: { col?: string; val?: unknown } | undefined): boolean {
  if (!filter) return true;
  if (filter.col) return row[filter.col] === filter.val;
  return true;
}

vi.mock('../db/index.js', () => {
  function selectChain(pool: () => Row[]) {
    let filter: unknown;
    const chain: Record<string, unknown> = {
      where: vi.fn((f: unknown) => {
        filter = f;
        return chain;
      }),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(async () => pool().filter((r) => matches(r, filter as { col?: string; val?: unknown }))),
      then: (resolve: (v: Row[]) => void) => resolve(pool().filter((r) => matches(r, filter as { col?: string; val?: unknown }))),
    };
    return chain;
  }
  const db = {
    select: vi.fn(() => ({
      from: vi.fn((tbl: { _table: string }) => selectChain(() => (state[tbl._table as 'workflows' | 'workflowReviews'] as Row[]) ?? [])),
    })),
    update: vi.fn((tbl: { _table: string }) => ({
      set: vi.fn((patch: Row) => ({
        where: vi.fn((filter: { col?: string; val?: unknown }) => ({
          returning: vi.fn(async () => {
            const rows = (state[tbl._table as 'workflows'] as Row[]).filter((r) => matches(r, filter));
            for (const r of rows) Object.assign(r, patch);
            return rows;
          }),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({ returning: vi.fn(async () => []) })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({ returning: vi.fn(async () => []) })),
    })),
  };
  return { db };
});

const broadcastSpy = vi.fn();
vi.mock('../api/ws/broadcaster.js', () => ({
  getBroadcaster: () => ({ broadcast: broadcastSpy, broadcastToWorkflow: vi.fn() }),
}));

vi.mock('../agent-teams/index.js', () => ({
  getTeamWatcher: () => ({ isWatching: () => false, getSnapshot: async () => ({ tasks: [] }) }),
}));

vi.mock('../review/triggers.js', () => ({
  maybeEmitAutoReview: vi.fn(async () => {}),
}));

import { workflowRoutes } from '../api/routes/workflows.js';

const WF_ID = 'wf-1';

beforeEach(() => {
  state.workflows = [];
  state.workflowReviews = [];
  broadcastSpy.mockClear();
});

async function buildApp() {
  const app = Fastify({ logger: false });
  await workflowRoutes(app);
  return app;
}

describe('POST /api/workflows/:id/activate', () => {
  it('returns 404 for unknown workflow', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/workflows/missing/activate', payload: {} });
    expect(res.statusCode).toBe(404);
  });

  it('activates when no review row exists (healthScore=null)', async () => {
    state.workflows.push({ id: WF_ID, name: 'T', active: false });
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: `/api/workflows/${WF_ID}/activate`, payload: {} });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.activated).toBe(true);
    expect(body.requiresConfirmation).toBe(false);
    expect(body.healthScore).toBeNull();
    expect(state.workflows[0].active).toBe(true);
    expect(broadcastSpy).toHaveBeenCalledWith('review_requested', WF_ID, expect.objectContaining({ trigger: 'pre-deploy' }));
    expect(broadcastSpy).toHaveBeenCalledWith('workflow_updated', WF_ID, expect.any(Object));
  });

  it('blocks activation when healthScore < 50 without force', async () => {
    state.workflows.push({ id: WF_ID, name: 'T', active: false });
    state.workflowReviews.push({ id: 'r1', workflowId: WF_ID, healthScore: 30, reviewType: 'ai', createdAt: new Date() });
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: `/api/workflows/${WF_ID}/activate`, payload: {} });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.requiresConfirmation).toBe(true);
    expect(body.activated).toBe(false);
    expect(body.healthScore).toBe(30);
    expect(state.workflows[0].active).toBe(false);
    const wfUpdated = broadcastSpy.mock.calls.filter((c) => c[0] === 'workflow_updated');
    expect(wfUpdated).toHaveLength(0);
  });

  it('activates low-score workflow when force=true', async () => {
    state.workflows.push({ id: WF_ID, name: 'T', active: false });
    state.workflowReviews.push({ id: 'r1', workflowId: WF_ID, healthScore: 30, reviewType: 'ai', createdAt: new Date() });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/${WF_ID}/activate`,
      payload: { force: true },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.activated).toBe(true);
    expect(state.workflows[0].active).toBe(true);
  });
});

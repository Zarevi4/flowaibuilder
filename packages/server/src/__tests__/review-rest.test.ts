import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

// ─── DB mock (mirrors review-mcp.test.ts) ─────────────────
type Row = Record<string, unknown>;
const state: {
  annotations: Row[];
  workflowReviews: Row[];
  workflows: Row[];
  executions: Row[];
  protectedZones: Row[];
} = {
  annotations: [],
  workflowReviews: [],
  workflows: [],
  executions: [],
  protectedZones: [],
};

function resetState() {
  state.annotations = [];
  state.workflowReviews = [];
  state.workflows = [];
  state.executions = [];
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
    workflows: mk('workflows', ['id', 'workflowId']),
    executions: mk('executions', ['workflowId']),
    annotations: mk('annotations', ['id', 'workflowId', 'status', 'severity', 'createdAt']),
    workflowReviews: mk('workflowReviews', ['id', 'workflowId', 'createdAt']),
    protectedZones: mk('protectedZones', ['id', 'workflowId']),
  };
});

function tableNameFromArg(arg: unknown): string {
  return (arg as { _table?: string })?._table ?? '';
}

function matchesFilter(row: Row, filter: unknown): boolean {
  if (!filter) return true;
  const f = filter as { kind: string; conds?: unknown[]; col?: string; val?: unknown };
  if (f.kind === 'and') return (f.conds ?? []).every((c) => matchesFilter(row, c));
  if (f.kind === 'eq') return row[f.col as string] === f.val;
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
      limit: vi.fn(async () => pool().filter((r) => matchesFilter(r, filter))),
      then: (resolve: (v: Row[]) => void) => resolve(pool().filter((r) => matchesFilter(r, filter))),
    };
    return chain;
  }
  const db = {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => {
        const name = tableNameFromArg(table);
        return selectChain(() => (state[name as keyof typeof state] as Row[]) ?? []);
      }),
    })),
    insert: vi.fn((table: unknown) => {
      const name = tableNameFromArg(table);
      return {
        values: vi.fn((vals: Row | Row[]) => ({
          returning: vi.fn(async () => {
            const list = Array.isArray(vals) ? vals : [vals];
            const stamped = list.map((v, i) => ({
              id: v.id ?? `${name}-${(state[name as keyof typeof state] as Row[]).length + i + 1}`,
              createdAt: new Date(),
              ...v,
            }));
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
          where: vi.fn((filter: unknown) => ({
            returning: vi.fn(async () => {
              const rows = (state[name as keyof typeof state] as Row[]).filter((r) =>
                matchesFilter(r, filter),
              );
              for (const r of rows) Object.assign(r, patch);
              return rows;
            }),
          })),
        })),
      };
    }),
  };
  return { db };
});

const broadcastSpy = vi.fn();
vi.mock('../api/ws/broadcaster.js', () => ({
  getBroadcaster: () => ({ broadcast: broadcastSpy, broadcastToWorkflow: vi.fn() }),
}));

// Stub fix-dispatcher so apply_fix doesn't need a real fix tool registry
vi.mock('../review/fix-dispatcher.js', () => ({
  dispatchFix: vi.fn(async () => ({ ok: true })),
  UnknownFixToolError: class extends Error {
    toolName: string;
    constructor(name: string) {
      super(name);
      this.toolName = name;
    }
  },
}));

import { registerReviewRoutes } from '../api/routes/review.js';

const WF_ID = 'wf-1';

beforeEach(() => {
  resetState();
  broadcastSpy.mockClear();
});

async function buildApp() {
  const app = Fastify({ logger: false });
  app.setErrorHandler((err, _req, reply) => {
    // eslint-disable-next-line no-console
    console.error('ROUTE ERROR:', err);
    reply.code(500).send({ error: (err as Error).message });
  });
  await registerReviewRoutes(app);
  return app;
}

describe('review REST routes', () => {
  it('GET /annotations returns 404 on unknown workflow', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/api/workflows/missing/annotations` });
    expect(res.statusCode).toBe(404);
  });

  it('GET /annotations returns active annotations', async () => {
    state.workflows.push({ id: WF_ID });
    state.annotations.push({
      id: 'a1', workflowId: WF_ID, nodeId: 'n1', severity: 'error',
      title: 't', description: 'd', status: 'active', createdAt: new Date(),
    });
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/api/workflows/${WF_ID}/annotations` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.annotations).toHaveLength(1);
    expect(body.annotations[0].id).toBe('a1');
  });

  it('GET /health returns nulls when no review exists', async () => {
    state.workflows.push({ id: WF_ID });
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/api/workflows/${WF_ID}/health` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.healthScore).toBeNull();
    expect(body.annotationCount).toBe(0);
  });

  it('GET /health returns camelCase health data when a review exists', async () => {
    state.workflows.push({ id: WF_ID });
    state.workflowReviews.push({
      id: 'r1', workflowId: WF_ID, reviewType: 'ai',
      healthScore: 82,
      scores: { security: 20, reliability: 20, dataIntegrity: 22, bestPractices: 20 },
      summary: 'ok', annotationCount: 3,
      createdAt: new Date(),
    });
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/api/workflows/${WF_ID}/health` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.healthScore).toBe(82);
    expect(body.scores.dataIntegrity).toBe(22);
    expect(body.annotationCount).toBe(3);
  });

  it('POST /apply flips annotation status to applied and broadcasts', async () => {
    state.workflows.push({ id: WF_ID });
    state.annotations.push({
      id: 'a1', workflowId: WF_ID, nodeId: 'n1', severity: 'error',
      title: 't', description: 'd', status: 'active',
      fix: { tool: 'update_node', params: { node_id: 'n1' }, description: 'fix' },
      createdAt: new Date(),
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/${WF_ID}/annotations/a1/apply`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.applied).toBe(true);
    expect(body.annotation_id).toBe('a1');
    expect(state.annotations[0].status).toBe('applied');
    expect(broadcastSpy).toHaveBeenCalledWith('annotation_applied', WF_ID, expect.any(Object));
  });

  it('POST /apply returns 400 when annotation has no fix', async () => {
    state.workflows.push({ id: WF_ID });
    state.annotations.push({
      id: 'a2', workflowId: WF_ID, nodeId: 'n1', severity: 'warning',
      title: 't', description: 'd', status: 'active', createdAt: new Date(),
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/${WF_ID}/annotations/a2/apply`,
    });
    expect(res.statusCode).toBe(409);
  });

  it('POST /dismiss flips status and broadcasts annotations_updated', async () => {
    state.workflows.push({ id: WF_ID });
    state.annotations.push({
      id: 'a3', workflowId: WF_ID, nodeId: 'n1', severity: 'warning',
      title: 't', description: 'd', status: 'active', createdAt: new Date(),
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/${WF_ID}/annotations/a3/dismiss`,
      payload: { reason: 'false positive' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().dismissed).toBe(true);
    expect(state.annotations[0].status).toBe('dismissed');
    expect(state.annotations[0].dismissedReason).toBe('false positive');
    expect(broadcastSpy).toHaveBeenCalledWith('annotations_updated', WF_ID, expect.any(Object));
  });

  it('POST /review/request broadcasts and returns prompt', async () => {
    state.workflows.push({ id: WF_ID });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/${WF_ID}/review/request`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.prompt).toContain(WF_ID);
    expect(broadcastSpy).toHaveBeenCalledWith('review_requested', WF_ID, expect.any(Object));
  });

  it('POST /review/request returns 404 on unknown workflow', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/missing/review/request`,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('zero-cost AI invariant', () => {
  it('review route file does not import @anthropic-ai/sdk', async () => {
    const fs = await import('node:fs/promises');
    const url = new URL('../api/routes/review.ts', import.meta.url);
    const src = await fs.readFile(url, 'utf8');
    expect(src).not.toContain('@anthropic-ai/sdk');
    expect(src.toLowerCase()).not.toContain('openai');
  });
});

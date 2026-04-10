import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Workflow } from '@flowaibuilder/shared';

// ─── DB mock with in-memory tables ────────────────────────
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

// Track which table/filter is being queried via a tiny tagged-object approach.
// eq/and/desc return filter descriptors the mock interprets.
vi.mock('drizzle-orm', () => {
  return {
    eq: (col: { _col: string; _table: string }, val: unknown) => ({ kind: 'eq', col: col._col, table: col._table, val }),
    and: (...conds: unknown[]) => ({ kind: 'and', conds }),
    desc: (col: { _col: string }) => ({ kind: 'desc', col: col._col }),
  };
});

vi.mock('../db/schema.js', () => {
  const mk = (table: string, cols: string[]) => {
    const out: Record<string, unknown> = { _table: table, $inferSelect: {} };
    for (const c of cols) out[c] = { _col: c, _table: table };
    return out;
  };
  return {
    workflows: mk('workflows', ['id', 'workflowId']),
    executions: mk('executions', ['workflowId', 'startedAt']),
    annotations: mk('annotations', ['id', 'workflowId', 'status', 'severity', 'createdAt']),
    workflowReviews: mk('workflowReviews', ['id', 'workflowId']),
    protectedZones: mk('protectedZones', ['id', 'workflowId']),
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

vi.mock('../db/index.js', () => {
  function selectChain(pool: () => Row[]) {
    let filter: unknown;
    const chain: Record<string, unknown> = {
      where: vi.fn((f: unknown) => {
        filter = f;
        return chain;
      }),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(async (_n: number) => pool().filter(r => matchesFilter(r, filter))),
      then: (resolve: (v: Row[]) => void) => resolve(pool().filter(r => matchesFilter(r, filter))),
    };
    return chain;
  }

  const db = {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => {
        const name = tableNameFromArg(table);
        const pool = () =>
          (state[name as keyof typeof state] as Row[]) ?? [];
        return selectChain(pool);
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
              const rows = (state[name as keyof typeof state] as Row[]).filter(r =>
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

// Broadcaster spy
const broadcastSpy = vi.fn();
vi.mock('../api/ws/broadcaster.js', () => ({
  getBroadcaster: () => ({ broadcast: broadcastSpy, broadcastToWorkflow: vi.fn() }),
}));

// Imports after mocks
import { buildReviewContext, detectPattern, extractCredentialTypes } from '../review/context-builder.js';
import { annotationStore } from '../review/store.js';

const WF_ID = 'wf-1';

function makeWorkflow(partial?: Partial<Workflow>): Workflow {
  return {
    id: WF_ID,
    name: 'Test',
    description: 'd',
    nodes: [],
    connections: [],
    active: false,
    version: 1,
    environment: 'dev',
    canvas: {},
    settings: {},
    tags: [],
    createdBy: 't',
    updatedBy: 't',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...partial,
  };
}

beforeEach(() => {
  resetState();
  broadcastSpy.mockClear();
});

describe('context-builder', () => {
  it('builds a ReviewContext for a 3-node webhook → http → respond workflow', () => {
    const wf = makeWorkflow({
      nodes: [
        { id: 'n1', type: 'webhook', name: 'In', position: { x: 0, y: 0 }, data: { label: 'In', config: { credentialType: 'basic-auth', outputFields: ['payload'] } }, createdAt: '', updatedAt: '' },
        { id: 'n2', type: 'http-request', name: 'Call', position: { x: 0, y: 0 }, data: { label: 'Call', config: { outputFields: ['status', 'body'] } }, createdAt: '', updatedAt: '' },
        { id: 'n3', type: 'respond-webhook', name: 'Out', position: { x: 0, y: 0 }, data: { label: 'Out', config: {} }, createdAt: '', updatedAt: '' },
      ],
      connections: [
        { id: 'c1', sourceNodeId: 'n1', targetNodeId: 'n2' },
        { id: 'c2', sourceNodeId: 'n2', targetNodeId: 'n3' },
      ],
    });
    const ctx = buildReviewContext(wf, [], [], []);
    expect(ctx.detected_pattern).toBe('webhook_processing');
    expect(ctx.workflow.id).toBe(WF_ID);
    expect(ctx.nodes).toHaveLength(3);
    expect(ctx.nodes[1].incoming_data_fields).toEqual(['payload']);
    expect(ctx.nodes[1].outgoing_data_fields).toEqual(['status', 'body']);
    expect(ctx.credentials_used).toEqual(['basic-auth']);
  });

  it('detectPattern branches', () => {
    expect(detectPattern(makeWorkflow({ nodes: [{ id: 'a', type: 'ai-agent' } as never] }))).toBe('ai_agent');
    expect(
      detectPattern(
        makeWorkflow({
          nodes: [
            { id: 'a', type: 'http-request' } as never,
            { id: 'b', type: 'http-request' } as never,
          ],
        }),
      ),
    ).toBe('http_api_chain');
    expect(detectPattern(makeWorkflow({ nodes: [{ id: 'a', type: 'schedule' } as never] }))).toBe('scheduled_batch');
    expect(detectPattern(makeWorkflow())).toBe('general');
  });

  it('extractCredentialTypes dedupes', () => {
    const wf = makeWorkflow({
      nodes: [
        { id: 'a', type: 'http-request', name: 'a', position: { x: 0, y: 0 }, data: { label: 'a', config: { credentialType: 'oauth2' } }, createdAt: '', updatedAt: '' },
        { id: 'b', type: 'http-request', name: 'b', position: { x: 0, y: 0 }, data: { label: 'b', config: { credentialType: 'oauth2' } }, createdAt: '', updatedAt: '' },
      ],
    });
    expect(extractCredentialTypes(wf)).toEqual(['oauth2']);
  });
});

describe('annotationStore', () => {
  it('saveAnnotations inserts rows + one review row with matching annotationCount', async () => {
    const res = await annotationStore.saveAnnotations(
      WF_ID,
      [
        { node_id: 'n1', severity: 'error', title: 'bad', description: 'thing' },
        { node_id: 'n2', severity: 'warning', title: 'eh', description: 'thing' },
      ],
      { healthScore: 72, summary: 's' },
    );
    expect(res.saved).toBe(2);
    expect(res.healthScore).toBe(72);
    expect(state.annotations).toHaveLength(2);
    expect(state.workflowReviews).toHaveLength(1);
    expect(state.workflowReviews[0].annotationCount).toBe(2);
    expect(state.workflowReviews[0].reviewType).toBe('ai');
  });

  it('getAnnotations defaults to active and filters by severity', async () => {
    state.annotations.push(
      { id: 'a1', workflowId: WF_ID, nodeId: 'n1', severity: 'error', title: 't', description: 'd', status: 'active', createdAt: new Date() },
      { id: 'a2', workflowId: WF_ID, nodeId: 'n1', severity: 'warning', title: 't', description: 'd', status: 'active', createdAt: new Date() },
      { id: 'a3', workflowId: WF_ID, nodeId: 'n1', severity: 'error', title: 't', description: 'd', status: 'dismissed', createdAt: new Date() },
    );
    const all = await annotationStore.getAnnotations(WF_ID);
    expect(all).toHaveLength(2);
    const errs = await annotationStore.getAnnotations(WF_ID, { severity: 'error' });
    expect(errs).toHaveLength(1);
    const dismissed = await annotationStore.getAnnotations(WF_ID, { status: 'dismissed' });
    expect(dismissed).toHaveLength(1);
  });

  it('dismissAnnotation flips status and rejects wrong workflow', async () => {
    state.annotations.push({
      id: 'a1',
      workflowId: WF_ID,
      nodeId: 'n1',
      severity: 'error',
      title: 't',
      description: 'd',
      status: 'active',
      createdAt: new Date(),
    });
    const wrong = await annotationStore.dismissAnnotation('other-wf', 'a1', 'nope');
    expect(wrong).toBeNull();
    expect(state.annotations[0].status).toBe('active');

    const ok = await annotationStore.dismissAnnotation(WF_ID, 'a1', 'fixed it');
    expect(ok).not.toBeNull();
    expect(state.annotations[0].status).toBe('dismissed');
    expect(state.annotations[0].dismissedReason).toBe('fixed it');
  });
});

describe('zero-cost AI principle', () => {
  it('server package.json has no @anthropic-ai/sdk runtime dep', async () => {
    const pkg = await import('../../package.json');
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) } as Record<string, string>;
    expect(deps['@anthropic-ai/sdk']).toBeUndefined();
  });
});

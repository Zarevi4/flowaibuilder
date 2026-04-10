import { describe, it, expect, vi, beforeEach } from 'vitest';

type Row = Record<string, unknown>;
const state: { workflows: Row[]; executions: Row[]; annotations: Row[]; protectedZones: Row[] } = {
  workflows: [],
  executions: [],
  annotations: [],
  protectedZones: [],
};

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
    executions: mk('executions', ['id', 'workflowId', 'startedAt']),
    annotations: mk('annotations', ['id', 'workflowId', 'status', 'severity']),
    workflowReviews: mk('workflowReviews', ['id', 'workflowId']),
    protectedZones: mk('protectedZones', ['id', 'workflowId']),
  };
});

function matches(row: Row, filter: unknown): boolean {
  if (!filter) return true;
  const f = filter as { kind: string; col?: string; val?: unknown; conds?: unknown[] };
  if (f.kind === 'and') return (f.conds ?? []).every((c) => matches(row, c));
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
      limit: vi.fn(async () => pool().filter((r) => matches(r, filter))),
      then: (resolve: (v: Row[]) => void) => resolve(pool().filter((r) => matches(r, filter))),
    };
    return chain;
  }
  const db = {
    select: vi.fn(() => ({
      from: vi.fn((tbl: { _table: string }) => selectChain(() => (state[tbl._table as keyof typeof state] as Row[]) ?? [])),
    })),
  };
  return { db };
});

vi.mock('../api/ws/broadcaster.js', () => ({
  getBroadcaster: () => ({ broadcast: vi.fn(), broadcastToWorkflow: vi.fn() }),
}));

vi.mock('../review/store.js', () => ({
  annotationStore: {
    getAnnotations: vi.fn(async () => []),
  },
}));

import { handleGetReviewContext, ReviewNotFoundError } from '../mcp/tools/review.js';

const WF_ID = 'wf-1';
const EXEC_ID = 'exec-1';

beforeEach(() => {
  state.workflows = [{ id: WF_ID, name: 'T', description: '', nodes: [], connections: [], settings: {}, tags: [] }];
  state.executions = [];
  state.annotations = [];
  state.protectedZones = [];
});

describe('handleGetReviewContext post-execution mode', () => {
  it('returns failed_execution with bottleneck_node_id from slowest non-success node', async () => {
    state.executions.push({
      id: EXEC_ID,
      workflowId: WF_ID,
      status: 'error',
      error: 'boom',
      durationMs: 500,
      startedAt: new Date(),
      nodeExecutions: [
        { nodeId: 'n1', status: 'success', duration: 300 },
        { nodeId: 'n2', status: 'error', duration: 100 },
        { nodeId: 'n3', status: 'error', duration: 50 },
      ],
    });
    const ctx = await handleGetReviewContext({
      workflow_id: WF_ID,
      execution_id: EXEC_ID,
      context_type: 'post-execution',
    });
    expect(ctx.failed_execution).toBeDefined();
    expect(ctx.failed_execution!.execution_id).toBe(EXEC_ID);
    expect(ctx.failed_execution!.bottleneck_node_id).toBe('n2');
    expect(ctx.review_request_context?.type).toBe('post-execution');
  });

  it('throws ReviewNotFoundError for unknown execution_id', async () => {
    await expect(
      handleGetReviewContext({
        workflow_id: WF_ID,
        execution_id: 'bogus',
        context_type: 'post-execution',
      }),
    ).rejects.toBeInstanceOf(ReviewNotFoundError);
  });

  it('omits failed_execution for general context', async () => {
    const ctx = await handleGetReviewContext({ workflow_id: WF_ID });
    expect(ctx.failed_execution).toBeUndefined();
    expect(ctx.review_request_context).toBeUndefined();
  });
});

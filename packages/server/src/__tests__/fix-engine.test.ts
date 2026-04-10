import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── In-memory DB mock (mirrors review-mcp.test.ts harness) ──
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
  if (f.kind === 'and') return (f.conds ?? []).every(c => matchesFilter(row, c));
  if (f.kind === 'eq') return row[f.col as string] === f.val;
  return true;
}

vi.mock('../db/index.js', () => {
  function selectChain(pool: () => Row[]) {
    let filter: unknown;
    let orderCol: string | null = null;
    const chain: Record<string, unknown> = {
      where: vi.fn((f: unknown) => {
        filter = f;
        return chain;
      }),
      orderBy: vi.fn((o: unknown) => {
        orderCol = (o as { col?: string })?.col ?? null;
        return chain;
      }),
      limit: vi.fn(async (n: number) => {
        let rows = pool().filter(r => matchesFilter(r, filter));
        if (orderCol) {
          rows = [...rows].sort((a, b) => {
            const av = a[orderCol as string];
            const bv = b[orderCol as string];
            if (av instanceof Date && bv instanceof Date) return bv.getTime() - av.getTime();
            return 0;
          });
        }
        return rows.slice(0, n);
      }),
      then: (resolve: (v: Row[]) => void) =>
        resolve(pool().filter(r => matchesFilter(r, filter))),
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
          where: vi.fn((filter: unknown) => {
            const applyAndReturn = () => {
              const rows = (state[name as keyof typeof state] as Row[]).filter(r =>
                matchesFilter(r, filter),
              );
              for (const r of rows) Object.assign(r, patch);
              return rows;
            };
            const result: Record<string, unknown> = {
              returning: vi.fn(async () => applyAndReturn()),
              then: (resolve: (v: Row[]) => void) => resolve(applyAndReturn()),
            };
            return result;
          }),
        })),
      };
    }),
    delete: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn(async () => []) })) })),
  };
  return { db };
});

// Broadcaster spy
const broadcastSpy = vi.fn();
vi.mock('../api/ws/broadcaster.js', () => ({
  getBroadcaster: () => ({ broadcast: broadcastSpy, broadcastToWorkflow: vi.fn() }),
}));

// Imports after mocks
import { annotationStore } from '../review/store.js';
import {
  dispatchFix,
  registerFixHandler,
  clearFixHandlers,
  UnknownFixToolError,
} from '../review/fix-dispatcher.js';
import { handleUpdateNode } from '../mcp/index.js';
import { registerReviewTools } from '../mcp/tools/review.js';

// Minimal fake McpServer that captures registered tools by name so we can
// invoke them directly — no SDK transport, no mocking of the SDK itself.
type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}>;
function makeFakeServer() {
  const tools = new Map<string, ToolHandler>();
  return {
    tool: (name: string, _schema: unknown, handler: ToolHandler) => {
      tools.set(name, handler);
    },
    call: (name: string, params: Record<string, unknown>) => {
      const h = tools.get(name);
      if (!h) throw new Error(`tool ${name} not registered`);
      return h(params);
    },
    tools,
  };
}

const WF_ID = 'wf-fix-1';

beforeEach(() => {
  resetState();
  broadcastSpy.mockClear();
  clearFixHandlers();
});

describe('annotationStore.applyAnnotation', () => {
  it('sets status=applied and appliedAt on active annotation with fix', async () => {
    state.annotations.push({
      id: 'a1',
      workflowId: WF_ID,
      nodeId: 'n1',
      severity: 'warning',
      title: 't',
      description: 'd',
      fix: { description: 'fix it', tool: 'flowaibuilder.update_node', params: { node_id: 'n1', config: { x: 1 } } },
      status: 'active',
      createdAt: new Date(),
    });

    const res = await annotationStore.applyAnnotation(WF_ID, 'a1');
    expect(res).not.toBeNull();
    expect(state.annotations[0].status).toBe('applied');
    expect(state.annotations[0].appliedAt).toBeInstanceOf(Date);
  });

  it('returns null for unknown id, wrong workflow, already-applied, dismissed, or no-fix', async () => {
    state.annotations.push(
      { id: 'a-applied', workflowId: WF_ID, nodeId: 'n1', severity: 'warning', title: 't', description: 'd', fix: { description: 'x', tool: 'flowaibuilder.update_node', params: {} }, status: 'applied', createdAt: new Date() },
      { id: 'a-dismissed', workflowId: WF_ID, nodeId: 'n1', severity: 'warning', title: 't', description: 'd', fix: { description: 'x', tool: 'flowaibuilder.update_node', params: {} }, status: 'dismissed', createdAt: new Date() },
      { id: 'a-nofix', workflowId: WF_ID, nodeId: 'n1', severity: 'warning', title: 't', description: 'd', status: 'active', createdAt: new Date() },
      { id: 'a-wrong', workflowId: 'other-wf', nodeId: 'n1', severity: 'warning', title: 't', description: 'd', fix: { description: 'x', tool: 'flowaibuilder.update_node', params: {} }, status: 'active', createdAt: new Date() },
    );

    expect(await annotationStore.applyAnnotation(WF_ID, 'does-not-exist')).toBeNull();
    expect(await annotationStore.applyAnnotation(WF_ID, 'a-applied')).toBeNull();
    expect(await annotationStore.applyAnnotation(WF_ID, 'a-dismissed')).toBeNull();
    expect(await annotationStore.applyAnnotation(WF_ID, 'a-nofix')).toBeNull();
    expect(await annotationStore.applyAnnotation(WF_ID, 'a-wrong')).toBeNull();

    // No rows mutated
    expect(state.annotations.find(a => a.id === 'a-nofix')!.status).toBe('active');
    expect(state.annotations.find(a => a.id === 'a-wrong')!.status).toBe('active');
  });
});

describe('fix-dispatcher', () => {
  it('dispatchFix invokes registered handler', async () => {
    const spy = vi.fn(async (p: Record<string, unknown>) => ({ ok: true, p }));
    registerFixHandler('flowaibuilder.update_node', spy);

    const res = await dispatchFix('flowaibuilder.update_node', { workflow_id: 'w', node_id: 'n' });
    expect(spy).toHaveBeenCalledWith({ workflow_id: 'w', node_id: 'n' });
    expect(res).toEqual({ ok: true, p: { workflow_id: 'w', node_id: 'n' } });
  });

  it('dispatchFix throws UnknownFixToolError for unregistered tool', async () => {
    await expect(dispatchFix('flowaibuilder.unknown', {})).rejects.toBeInstanceOf(UnknownFixToolError);
  });

  it('dispatchFix to real handleUpdateNode mutates the workflow row', async () => {
    state.workflows.push({
      id: WF_ID,
      name: 'wf',
      nodes: [{ id: 'n1', type: 'set', name: 'N', position: { x: 0, y: 0 }, data: { label: 'N', config: { old: true } }, createdAt: '', updatedAt: '' }],
      connections: [],
    });
    registerFixHandler('flowaibuilder.update_node', handleUpdateNode);

    await dispatchFix('flowaibuilder.update_node', {
      workflow_id: WF_ID,
      node_id: 'n1',
      config: { newField: 42 },
    });

    const wf = state.workflows[0] as { nodes: Array<{ id: string; data: { config: Record<string, unknown> } }> };
    expect(wf.nodes[0].data.config).toMatchObject({ old: true, newField: 42 });
  });
});

describe('annotationStore.getLatestReview', () => {
  it('returns the most recent review by createdAt', async () => {
    state.workflowReviews.push(
      { id: 'r1', workflowId: WF_ID, reviewType: 'ai', healthScore: 50, scores: null, summary: 'old', annotationCount: 1, createdAt: new Date(2020, 0, 1) },
      { id: 'r2', workflowId: WF_ID, reviewType: 'ai', healthScore: 80, scores: { security: 20, reliability: 20, dataIntegrity: 20, bestPractices: 20 }, summary: 'new', annotationCount: 3, createdAt: new Date(2022, 0, 1) },
    );

    const latest = await annotationStore.getLatestReview(WF_ID);
    expect(latest).not.toBeNull();
    expect(latest!.reviewId).toBe('r2');
    expect(latest!.healthScore).toBe(80);
    expect(latest!.annotationCount).toBe(3);
    expect(latest!.scores?.dataIntegrity).toBe(20);
  });

  it('returns null when there are no reviews', async () => {
    const latest = await annotationStore.getLatestReview(WF_ID);
    expect(latest).toBeNull();
  });
});

describe('save_annotations scores round-trip', () => {
  it('saves camelCase scores and exposes them in the result', async () => {
    const res = await annotationStore.saveAnnotations(
      WF_ID,
      [{ node_id: 'n1', severity: 'error', title: 't', description: 'd' }],
      {
        healthScore: 88,
        scores: { security: 22, reliability: 22, dataIntegrity: 22, bestPractices: 22 },
        summary: 's',
      },
    );
    expect(res.saved).toBe(1);
    expect(res.healthScore).toBe(88);
    const stored = state.workflowReviews[0] as { scores: { dataIntegrity: number; bestPractices: number } };
    expect(stored.scores.dataIntegrity).toBe(22);
    expect(stored.scores.bestPractices).toBe(22);
  });

  it('save_annotations broadcast payload includes scores in snake_case', async () => {
    const fake = makeFakeServer();
    registerReviewTools(fake as unknown as Parameters<typeof registerReviewTools>[0]);
    state.workflows.push({ id: WF_ID, name: 'wf', nodes: [], connections: [] });

    await fake.call('flowaibuilder.save_annotations', {
      workflow_id: WF_ID,
      annotations: [{ node_id: 'n1', severity: 'error', title: 't', description: 'd' }],
      health_score: 88,
      scores: { security: 22, reliability: 22, data_integrity: 22, best_practices: 22 },
      summary: 's',
    });

    expect(broadcastSpy).toHaveBeenCalled();
    const [eventType, wfId, payload] = broadcastSpy.mock.calls[0];
    expect(eventType).toBe('annotations_updated');
    expect(wfId).toBe(WF_ID);
    expect(payload).toMatchObject({
      health_score: 88,
      scores: {
        security: 22,
        reliability: 22,
        data_integrity: 22,
        best_practices: 22,
      },
    });
  });
});

describe('apply_fix MCP tool', () => {
  it('happy path: dispatches handler, marks annotation applied, emits annotation_applied broadcast', async () => {
    const fake = makeFakeServer();
    // Shared handler registration (mirrors createMcpServer() order)
    registerFixHandler('flowaibuilder.update_node', handleUpdateNode);
    registerReviewTools(fake as unknown as Parameters<typeof registerReviewTools>[0]);

    state.workflows.push({
      id: WF_ID,
      name: 'wf',
      nodes: [
        {
          id: 'n1',
          type: 'set',
          name: 'N',
          position: { x: 0, y: 0 },
          data: { label: 'N', config: { old: true } },
          createdAt: '',
          updatedAt: '',
        },
      ],
      connections: [],
    });
    state.annotations.push({
      id: 'ann-happy',
      workflowId: WF_ID,
      nodeId: 'n1',
      severity: 'warning',
      title: 't',
      description: 'd',
      fix: {
        description: 'apply new config',
        tool: 'flowaibuilder.update_node',
        params: { node_id: 'n1', config: { newField: 42 } },
      },
      status: 'active',
      createdAt: new Date(),
    });

    const res = await fake.call('flowaibuilder.apply_fix', {
      workflow_id: WF_ID,
      annotation_id: 'ann-happy',
    });
    expect(res.isError).toBeFalsy();
    const body = JSON.parse(res.content[0].text);
    expect(body.applied).toBe(true);
    expect(body.annotation_id).toBe('ann-happy');
    expect(body.tool).toBe('flowaibuilder.update_node');

    // DB state: annotation applied, node config merged
    const ann = state.annotations.find(a => a.id === 'ann-happy') as Row;
    expect(ann.status).toBe('applied');
    expect(ann.appliedAt).toBeInstanceOf(Date);
    const wf = state.workflows[0] as { nodes: Array<{ data: { config: Record<string, unknown> } }> };
    expect(wf.nodes[0].data.config).toMatchObject({ old: true, newField: 42 });

    // Broadcast: annotation_applied emitted with correct payload
    const appliedCall = broadcastSpy.mock.calls.find(c => c[0] === 'annotation_applied');
    expect(appliedCall).toBeDefined();
    expect(appliedCall![1]).toBe(WF_ID);
    expect(appliedCall![2]).toMatchObject({
      annotation_id: 'ann-happy',
      workflow_id: WF_ID,
      node_id: 'n1',
      tool: 'flowaibuilder.update_node',
    });
  });

  it('failure path: when fix handler throws, annotation stays active and no broadcast is emitted', async () => {
    const fake = makeFakeServer();
    const throwingHandler = vi.fn(async () => {
      throw new Error('node not found');
    });
    registerFixHandler('flowaibuilder.update_node', throwingHandler);
    registerReviewTools(fake as unknown as Parameters<typeof registerReviewTools>[0]);

    state.workflows.push({ id: WF_ID, name: 'wf', nodes: [], connections: [] });
    state.annotations.push({
      id: 'ann-fail',
      workflowId: WF_ID,
      nodeId: 'gone',
      severity: 'warning',
      title: 't',
      description: 'd',
      fix: {
        description: 'apply',
        tool: 'flowaibuilder.update_node',
        params: { node_id: 'gone', config: {} },
      },
      status: 'active',
      createdAt: new Date(),
    });

    const res = await fake.call('flowaibuilder.apply_fix', {
      workflow_id: WF_ID,
      annotation_id: 'ann-fail',
    });
    expect(res.isError).toBe(true);
    expect(throwingHandler).toHaveBeenCalled();

    // Annotation NOT mutated
    const ann = state.annotations.find(a => a.id === 'ann-fail') as Row;
    expect(ann.status).toBe('active');
    expect(ann.appliedAt).toBeUndefined();

    // No annotation_applied broadcast
    const appliedCall = broadcastSpy.mock.calls.find(c => c[0] === 'annotation_applied');
    expect(appliedCall).toBeUndefined();
  });
});

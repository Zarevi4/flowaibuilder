import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Workflow } from '@flowaibuilder/shared';

// ─── DB mock ──────────────────────────────────────────────
let nextExecId = 0;
const insertedExecs: Array<Record<string, unknown>> = [];

vi.mock('drizzle-orm', () => ({
  eq: () => ({ kind: 'eq' }),
}));

vi.mock('../db/schema.js', () => ({
  executions: { _table: 'executions' },
}));

vi.mock('../db/index.js', () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn((vals: Record<string, unknown>) => ({
        returning: vi.fn(async () => {
          const id = `exec-${++nextExecId}`;
          const row = { id, ...vals };
          insertedExecs.push(row);
          return [row];
        }),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((patch: Record<string, unknown>) => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => {
            const last = insertedExecs[insertedExecs.length - 1];
            Object.assign(last, patch);
            return [last];
          }),
        })),
      })),
    })),
  },
}));

// Stub node-runner — first call returns success, second throws (we don't actually call twice)
const runNodeMock = vi.fn();
vi.mock('../engine/node-runner.js', () => ({
  runNode: (...args: unknown[]) => runNodeMock(...args),
}));

vi.mock('../engine/context.js', () => ({
  createNodeContext: vi.fn(() => ({})),
}));

const broadcastSpy = vi.fn();
const broadcastToWorkflowSpy = vi.fn();
vi.mock('../api/ws/broadcaster.js', () => ({
  getBroadcaster: () => ({ broadcast: broadcastSpy, broadcastToWorkflow: broadcastToWorkflowSpy }),
}));

import { WorkflowExecutor } from '../engine/executor.js';

function makeWorkflow(): Workflow {
  return {
    id: 'wf-1',
    name: 'T',
    description: '',
    nodes: [
      { id: 'n1', type: 'manual', name: 'Start', position: { x: 0, y: 0 }, data: { label: 'Start', config: {} }, createdAt: '', updatedAt: '' },
      { id: 'n2', type: 'code-js', name: 'Throw', position: { x: 0, y: 0 }, data: { label: 'Throw', config: {} }, createdAt: '', updatedAt: '' },
    ],
    connections: [{ id: 'c1', sourceNodeId: 'n1', targetNodeId: 'n2' }],
    active: false,
    version: 1,
    environment: 'dev',
    canvas: {},
    settings: {},
    tags: [],
    createdBy: 't',
    updatedBy: 't',
    createdAt: '',
    updatedAt: '',
  };
}

beforeEach(() => {
  insertedExecs.length = 0;
  nextExecId = 0;
  broadcastSpy.mockClear();
  broadcastToWorkflowSpy.mockClear();
  runNodeMock.mockReset();
});

describe('post-execution review trigger', () => {
  it('emits review_requested with trigger=post-execution on failed execution', async () => {
    runNodeMock
      .mockResolvedValueOnce({ nodeId: 'n1', nodeName: 'Start', nodeType: 'manual', status: 'success', output: {}, duration: 1 })
      .mockResolvedValueOnce({ nodeId: 'n2', nodeName: 'Throw', nodeType: 'code-js', status: 'error', error: 'boom', duration: 1 });

    const exec = await new WorkflowExecutor().execute(makeWorkflow());
    expect(exec.status).toBe('error');

    const reviewCalls = broadcastSpy.mock.calls.filter((c) => c[0] === 'review_requested');
    expect(reviewCalls).toHaveLength(1);
    const payload = reviewCalls[0][2] as { trigger: string; execution_id: string; context_type: string };
    expect(payload.trigger).toBe('post-execution');
    expect(payload.context_type).toBe('post-execution');
    expect(payload.execution_id).toBe(exec.id);
  });

  it('does NOT emit review_requested for successful execution', async () => {
    runNodeMock
      .mockResolvedValueOnce({ nodeId: 'n1', nodeName: 'Start', nodeType: 'manual', status: 'success', output: {}, duration: 1 })
      .mockResolvedValueOnce({ nodeId: 'n2', nodeName: 'OK', nodeType: 'code-js', status: 'success', output: { ok: true }, duration: 1 });

    const exec = await new WorkflowExecutor().execute(makeWorkflow());
    expect(exec.status).toBe('success');

    const reviewCalls = broadcastSpy.mock.calls.filter((c) => c[0] === 'review_requested');
    expect(reviewCalls).toHaveLength(0);
  });
});

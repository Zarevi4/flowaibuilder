import { describe, it, expect, vi, beforeEach } from 'vitest';

const { processorRef, mockExecute, mockBroadcaster, mockDbSelect, mockDbUpdate } = vi.hoisted(() => ({
  processorRef: { current: null as ((job: unknown) => Promise<void>) | null },
  mockExecute: vi.fn(),
  mockBroadcaster: { broadcastToWorkflow: vi.fn() },
  mockDbSelect: vi.fn(),
  mockDbUpdate: vi.fn(),
}));

vi.mock('bullmq', () => ({
  Worker: class MockWorker {
    constructor(_name: string, processor: (job: unknown) => Promise<void>) {
      processorRef.current = processor;
    }
    close = vi.fn().mockResolvedValue(undefined);
  },
  Queue: class MockQueue {
    add = vi.fn();
    close = vi.fn();
  },
}));

vi.mock('ioredis', () => ({
  default: class MockRedis { disconnect = vi.fn(); },
}));

vi.mock('../engine/executor.js', () => ({
  workflowExecutor: { execute: mockExecute },
}));

vi.mock('../api/ws/broadcaster.js', () => ({
  getBroadcaster: () => mockBroadcaster,
}));

vi.mock('../nodes/index.js', () => ({
  registerAllNodes: vi.fn(),
}));

vi.mock('../db/index.js', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: mockDbSelect,
      }),
    }),
    update: () => ({
      set: () => ({
        where: mockDbUpdate,
      }),
    }),
  },
}));

vi.mock('../db/schema.js', () => ({
  workflows: { id: { _col: 'id' } },
  executions: { id: { _col: 'id' } },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
}));

vi.mock('../logging/index.js', () => ({
  getLogStreamer: () => ({ emit: vi.fn() }),
}));

describe('Queue Worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    processorRef.current = null;
  });

  it('processor calls workflowExecutor.execute with correct args', async () => {
    vi.resetModules();
    const workerModule = await import('../queue/worker.js');
    workerModule.startWorker();

    expect(processorRef.current).toBeTruthy();

    mockDbSelect.mockResolvedValueOnce([{
      id: 'wf-1', name: 'Test', description: '', active: false,
      version: 1, nodes: [], connections: [], canvas: {}, settings: {},
      tags: [], createdBy: 'test', updatedBy: 'test',
      createdAt: new Date(), updatedAt: new Date(),
    }]);
    mockDbUpdate.mockResolvedValueOnce([{}]);
    mockExecute.mockResolvedValueOnce({ id: 'exec-1', status: 'success' });

    await processorRef.current!({
      data: {
        workflowId: 'wf-1',
        executionId: 'exec-1',
        triggerData: null,
        mode: 'manual',
        triggeredBy: 'api',
      },
    });

    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'wf-1', name: 'Test' }),
      null,          // triggerData
      'manual',      // mode
      'api',         // triggeredBy
      'exec-1',      // existingExecutionId
    );
  });

  it('processor broadcasts error on executor failure', async () => {
    vi.resetModules();
    const workerModule = await import('../queue/worker.js');
    workerModule.startWorker();

    expect(processorRef.current).toBeTruthy();

    mockDbSelect.mockResolvedValueOnce([{
      id: 'wf-1', name: 'Test', description: '', active: false,
      version: 1, nodes: [], connections: [], canvas: {}, settings: {},
      tags: [], createdBy: 'test', updatedBy: 'test',
      createdAt: new Date(), updatedAt: new Date(),
    }]);
    mockDbUpdate.mockResolvedValue([{}]);
    mockExecute.mockRejectedValueOnce(new Error('Node failed'));

    await expect(
      processorRef.current!({
        data: {
          workflowId: 'wf-1',
          executionId: 'exec-1',
          triggerData: null,
          mode: 'manual',
          triggeredBy: 'api',
        },
      }),
    ).rejects.toThrow('Node failed');

    expect(mockBroadcaster.broadcastToWorkflow).toHaveBeenCalledWith(
      'wf-1',
      'execution_completed',
      expect.objectContaining({ status: 'error' }),
    );
  });
});

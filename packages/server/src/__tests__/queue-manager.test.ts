import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockAdd, mockGetJobCounts, mockGetWorkersCount, mockClose } = vi.hoisted(() => ({
  mockAdd: vi.fn().mockResolvedValue({ id: 'job-1' }),
  mockGetJobCounts: vi.fn().mockResolvedValue({
    waiting: 2, active: 1, completed: 10, failed: 0, delayed: 0,
  }),
  mockGetWorkersCount: vi.fn().mockResolvedValue(3),
  mockClose: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('bullmq', () => {
  return {
    Queue: class MockQueue {
      add = mockAdd;
      getJobCounts = mockGetJobCounts;
      getWorkersCount = mockGetWorkersCount;
      close = mockClose;
    },
  };
});

vi.mock('ioredis', () => {
  return {
    default: class MockRedis {
      disconnect = vi.fn();
    },
  };
});

describe('Queue Manager', () => {
  let manager: typeof import('../queue/manager.js');

  beforeEach(async () => {
    vi.resetModules();
    manager = await import('../queue/manager.js');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('isQueueMode returns false when QUEUE_MODE is not set', () => {
    delete process.env.QUEUE_MODE;
    expect(manager.isQueueMode()).toBe(false);
  });

  it('isQueueMode returns true when QUEUE_MODE is "true"', () => {
    process.env.QUEUE_MODE = 'true';
    expect(manager.isQueueMode()).toBe(true);
  });

  it('isQueueMode returns false when QUEUE_MODE is "false"', () => {
    process.env.QUEUE_MODE = 'false';
    expect(manager.isQueueMode()).toBe(false);
  });

  it('enqueueExecution creates a job with correct data', async () => {
    const jobData = {
      workflowId: 'wf-1',
      executionId: 'exec-1',
      triggerData: { foo: 'bar' },
      mode: 'manual' as const,
      triggeredBy: 'api',
    };

    await manager.enqueueExecution(jobData);

    expect(mockAdd).toHaveBeenCalledWith('execute', jobData, {
      removeOnComplete: 1000,
      removeOnFail: 500,
    });
  });

  it('getQueueStatus returns counts from BullMQ', async () => {
    process.env.QUEUE_CONCURRENCY = '10';
    const status = await manager.getQueueStatus();

    expect(status).toEqual({
      enabled: true,
      concurrency: 10,
      waiting: 2,
      active: 1,
      completed: 10,
      failed: 0,
      delayed: 0,
      workers: 3,
    });
  });
});

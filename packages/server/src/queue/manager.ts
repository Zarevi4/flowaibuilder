import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import type { QueueStatus } from '@flowaibuilder/shared';
import type { ExecutionMode } from '@flowaibuilder/shared';

export interface QueueJobData {
  workflowId: string;
  executionId: string;
  triggerData?: unknown;
  mode: ExecutionMode;
  triggeredBy: string;
}

let queue: Queue<QueueJobData> | null = null;
let redis: IORedis | null = null;

function getRedis(): IORedis {
  if (!redis) {
    redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });
  }
  return redis;
}

function getQueue(): Queue<QueueJobData> {
  if (!queue) {
    queue = new Queue<QueueJobData>('workflow-executions', {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: parseInt(process.env.QUEUE_RETRY_ATTEMPTS || '2', 10),
        backoff: {
          type: 'exponential',
          delay: parseInt(process.env.QUEUE_RETRY_BACKOFF_MS || '5000', 10),
        },
      },
    });
  }
  return queue;
}

export function isQueueMode(): boolean {
  return process.env.QUEUE_MODE === 'true';
}

export async function enqueueExecution(job: QueueJobData) {
  const q = getQueue();
  return q.add('execute', job, {
    removeOnComplete: 1000,
    removeOnFail: 500,
  });
}

export async function getQueueStatus(): Promise<QueueStatus> {
  const q = getQueue();
  const counts = await q.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
  const workers = await q.getWorkersCount();
  return {
    enabled: true,
    concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '5', 10),
    waiting: counts.waiting,
    active: counts.active,
    completed: counts.completed,
    failed: counts.failed,
    delayed: counts.delayed,
    workers,
  };
}

export async function closeQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
  if (redis) {
    redis.disconnect();
    redis = null;
  }
}

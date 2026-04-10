import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { workflows, executions } from '../db/schema.js';
import { workflowExecutor } from '../engine/executor.js';
import { getBroadcaster } from '../api/ws/broadcaster.js';
import { registerAllNodes } from '../nodes/index.js';
import type { Workflow, ExecutionMode } from '@flowaibuilder/shared';
import type { QueueJobData } from './manager.js';

// Ensure node handlers are available in the worker context
registerAllNodes();

let worker: Worker<QueueJobData> | null = null;
let redis: IORedis | null = null;

export function startWorker(): Worker<QueueJobData> {
  if (worker) return worker;

  redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });

  const concurrency = parseInt(process.env.QUEUE_CONCURRENCY || '5', 10);

  worker = new Worker<QueueJobData>(
    'workflow-executions',
    async (job) => {
      const { workflowId, executionId, triggerData, mode, triggeredBy } = job.data;

      // Load workflow from DB
      const [wf] = await db.select().from(workflows).where(eq(workflows.id, workflowId));
      if (!wf) {
        throw new Error(`Workflow ${workflowId} not found`);
      }

      const workflow: Workflow = {
        id: wf.id,
        name: wf.name,
        description: wf.description ?? '',
        active: wf.active ?? false,
        version: wf.version ?? 1,
        nodes: (wf.nodes as Workflow['nodes']) ?? [],
        connections: (wf.connections as Workflow['connections']) ?? [],
        canvas: wf.canvas as Workflow['canvas'],
        settings: wf.settings as Workflow['settings'],
        tags: (wf.tags as string[]) ?? [],
        createdBy: wf.createdBy,
        updatedBy: wf.updatedBy,
        createdAt: wf.createdAt?.toISOString() ?? new Date().toISOString(),
        updatedAt: wf.updatedAt?.toISOString() ?? new Date().toISOString(),
      };

      try {
        // Pass existingExecutionId so executor reuses the pre-created record
        await workflowExecutor.execute(workflow, triggerData, mode as ExecutionMode, triggeredBy, executionId);
      } catch (err) {
        // On failure, ensure the execution record is marked as error
        // (executor may have already done this if it got far enough)
        try {
          await db
            .update(executions)
            .set({
              status: 'error',
              error: { message: err instanceof Error ? err.message : String(err) },
              finishedAt: new Date(),
            })
            .where(eq(executions.id, executionId));
        } catch { /* best-effort — executor may have already finalized */ }

        const errorMsg = err instanceof Error ? err.message : String(err);
        getBroadcaster()?.broadcastToWorkflow(workflowId, 'execution_completed', {
          execution_id: executionId,
          workflow_id: workflowId,
          status: 'error',
          error: errorMsg,
        });

        // Emit execution_error for log streaming (P3: flush S3 buffer)
        try {
          const { getLogStreamer } = await import('../logging/index.js');
          getLogStreamer().emit({
            timestamp: new Date().toISOString(),
            level: 'error',
            event: 'execution_error',
            workflowId,
            executionId,
            message: `Execution failed: ${errorMsg}`,
            data: { status: 'error' },
          });
        } catch { /* log streaming must not break error handling */ }

        throw err; // Re-throw so BullMQ can handle retries
      }
    },
    {
      connection: redis,
      concurrency,
    },
  );

  return worker;
}

export async function closeWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (redis) {
    redis.disconnect();
    redis = null;
  }
}

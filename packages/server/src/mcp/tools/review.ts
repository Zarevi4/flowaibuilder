import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import type { ReviewContext } from '@flowaibuilder/shared';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  Workflow,
  WorkflowNode,
  Connection,
  AnnotationInput,
} from '@flowaibuilder/shared';
import { db } from '../../db/index.js';
import { workflows, executions, protectedZones } from '../../db/schema.js';
import { getBroadcaster } from '../../api/ws/broadcaster.js';
import { buildReviewContext } from '../../review/context-builder.js';
import { annotationStore } from '../../review/store.js';
import { dispatchFix, UnknownFixToolError } from '../../review/fix-dispatcher.js';

function mcpError(message: string, extra?: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message, ...extra }) }],
    isError: true,
  };
}

function toWorkflow(row: typeof workflows.$inferSelect): Workflow {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    nodes: (row.nodes ?? []) as WorkflowNode[],
    connections: (row.connections ?? []) as Connection[],
    active: row.active ?? false,
    version: row.version ?? 1,
    environment: row.environment ?? 'dev',
    canvas: (row.canvas ?? {}) as Record<string, unknown>,
    settings: (row.settings ?? {}) as Record<string, unknown>,
    tags: (row.tags ?? []) as string[],
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
    updatedAt: row.updatedAt?.toISOString() ?? new Date().toISOString(),
  };
}

const annotationInputSchema = z.object({
  node_id: z.string().describe('Target node id'),
  severity: z.enum(['error', 'warning', 'suggestion']).describe('Annotation severity'),
  title: z.string().describe('Short headline shown on the canvas card'),
  description: z.string().describe('Full explanation of the issue'),
  fix: z
    .object({
      description: z.string(),
      tool: z.string(),
      params: z.record(z.unknown()),
    })
    .optional()
    .describe('Optional suggested one-click fix'),
  related_nodes: z.array(z.string()).optional().describe('Other node ids this annotation references'),
  knowledge_source: z.string().optional().describe('Knowledge-base rule id or source URL'),
});

/**
 * Extracted module-level handlers so Fastify REST routes can call the same
 * code path as the MCP tool callbacks (Story 2.3 Task 7). These return plain
 * objects (NOT the MCP `{ content: [...] }` wrapper); the MCP callbacks wrap
 * results + translate thrown errors into mcpError, while the REST layer
 * maps `ReviewNotFoundError` → 404, `ReviewConflictError` → 409, and any
 * other thrown error → 500.
 */
export class ReviewNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewNotFoundError';
  }
}
export class ReviewConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewConflictError';
  }
}

export async function handleApplyFix(params: { workflow_id: string; annotation_id: string }): Promise<{
  applied: true;
  annotation_id: string;
  tool: string;
  result: unknown;
}> {
  const { workflow_id, annotation_id } = params;
  const annotation = await annotationStore.getAnnotationById(annotation_id);
  if (!annotation) throw new ReviewNotFoundError(`Annotation ${annotation_id} not found`);
  if (annotation.workflowId !== workflow_id) {
    throw new ReviewNotFoundError(`Annotation ${annotation_id} does not belong to workflow ${workflow_id}`);
  }
  if (annotation.status !== 'active') {
    throw new ReviewConflictError(`Annotation ${annotation_id} is ${annotation.status} and cannot be applied`);
  }
  if (!annotation.fix) {
    throw new ReviewConflictError(`Annotation ${annotation_id} has no fix`);
  }

  let result: unknown;
  try {
    result = await dispatchFix(annotation.fix.tool, {
      ...annotation.fix.params,
      workflow_id,
    });
  } catch (err) {
    if (err instanceof UnknownFixToolError) {
      throw new Error(`Unknown fix tool: ${err.toolName}`);
    }
    throw new Error(`Fix failed: ${(err as Error).message}`);
  }

  const applied = await annotationStore.applyAnnotation(workflow_id, annotation_id);
  if (!applied) {
    // Raced with another apply/dismiss; fix has already been dispatched so the
    // workflow may now be mutated even though we lost the CAS. Surface as
    // conflict so REST maps to 409.
    throw new ReviewConflictError(`Annotation ${annotation_id} was already applied or dismissed concurrently`);
  }

  getBroadcaster()?.broadcast('annotation_applied', workflow_id, {
    annotation_id,
    workflow_id,
    node_id: annotation.nodeId,
    tool: annotation.fix.tool,
    result,
  });

  return { applied: true, annotation_id, tool: annotation.fix.tool, result };
}

export async function handleDismissAnnotation(params: {
  workflow_id: string;
  annotation_id: string;
  reason?: string;
}): Promise<{ dismissed: true; annotation_id: string }> {
  const { workflow_id, annotation_id, reason } = params;
  const updated = await annotationStore.dismissAnnotation(workflow_id, annotation_id, reason);
  if (!updated) {
    throw new ReviewNotFoundError(`Annotation ${annotation_id} not found for workflow ${workflow_id}`);
  }
  const remaining = await annotationStore.getAnnotations(workflow_id, { status: 'active' });
  getBroadcaster()?.broadcast('annotations_updated', workflow_id, {
    annotations: remaining,
    health_score: null,
  });
  return { dismissed: true, annotation_id };
}

export type GetReviewContextInput = {
  workflow_id: string;
  execution_id?: string;
  context_type?: 'general' | 'on-save' | 'on-edit' | 'post-execution' | 'pre-deploy';
};

export async function handleGetReviewContext(
  params: GetReviewContextInput,
): Promise<ReviewContext> {
  const { workflow_id, execution_id, context_type } = params;
  const [wf] = await db.select().from(workflows).where(eq(workflows.id, workflow_id));
  if (!wf) throw new ReviewNotFoundError(`Workflow ${workflow_id} not found`);

  const workflow = toWorkflow(wf);
  const execs = await db
    .select()
    .from(executions)
    .where(eq(executions.workflowId, workflow_id))
    .orderBy(desc(executions.startedAt))
    .limit(5);
  const current = await annotationStore.getAnnotations(workflow_id, { status: 'active' });
  const zones = await db
    .select()
    .from(protectedZones)
    .where(eq(protectedZones.workflowId, workflow_id));

  let failed_execution: ReviewContext['failed_execution'] | undefined;
  if (context_type === 'post-execution' && execution_id) {
    const [exec] = await db
      .select()
      .from(executions)
      .where(and(eq(executions.id, execution_id), eq(executions.workflowId, workflow_id)));
    if (!exec) throw new ReviewNotFoundError(`Execution ${execution_id} not found`);
    const nodeExecs = (exec.nodeExecutions ?? []) as Array<{ nodeId?: string; status?: string; duration?: number }>;
    let bottleneck_node_id: string | null = null;
    let maxDuration = -1;
    for (const ne of nodeExecs) {
      if (ne && ne.status !== 'success' && (ne.duration ?? 0) > maxDuration) {
        maxDuration = ne.duration ?? 0;
        bottleneck_node_id = ne.nodeId ?? null;
      }
    }
    const failedNodeExecs = nodeExecs.filter((ne) => ne && ne.status !== 'success');
    failed_execution = {
      execution_id,
      status: exec.status,
      error: exec.error,
      node_errors: failedNodeExecs,
      duration_ms: exec.durationMs ?? null,
      started_at: exec.startedAt ? exec.startedAt.toISOString() : null,
      bottleneck_node_id,
    };
  }

  const review_request_context =
    context_type && context_type !== 'general'
      ? { type: context_type, ...(execution_id ? { execution_id } : {}) }
      : undefined;

  return buildReviewContext(workflow, execs, current, zones, failed_execution, review_request_context);
}

export function registerReviewTools(server: McpServer) {
  // ─── get_review_context ───────────────────────────────────
  server.tool(
    'flowaibuilder.get_review_context',
    {
      workflow_id: z.string().describe('Workflow id to build review context for'),
      execution_id: z.string().optional().describe('Execution id (for post-execution reviews)'),
      context_type: z
        .enum(['general', 'on-save', 'on-edit', 'post-execution', 'pre-deploy'])
        .optional()
        .describe('Review trigger context'),
    },
    async ({ workflow_id, execution_id, context_type }) => {
      try {
        const context = await handleGetReviewContext({ workflow_id, execution_id, context_type });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(context) }],
        };
      } catch (err) {
        return mcpError((err as Error).message);
      }
    },
  );

  // ─── save_annotations ─────────────────────────────────────
  server.tool(
    'flowaibuilder.save_annotations',
    {
      workflow_id: z.string().describe('Workflow id'),
      annotations: z.array(annotationInputSchema).describe('Annotations to persist'),
      health_score: z
        .number()
        .min(0)
        .max(100)
        .optional()
        .describe('Overall workflow health score 0-100'),
      scores: z
        .object({
          security: z.number().min(0).max(25),
          reliability: z.number().min(0).max(25),
          data_integrity: z.number().min(0).max(25),
          best_practices: z.number().min(0).max(25),
        })
        .optional()
        .describe('Per-dimension scores, each 0-25 (sum 0-100)'),
      summary: z.string().optional().describe('One-paragraph review summary'),
    },
    async ({ workflow_id, annotations: inputs, health_score, scores, summary }) => {
      const [wf] = await db.select().from(workflows).where(eq(workflows.id, workflow_id));
      if (!wf) return mcpError(`Workflow ${workflow_id} not found`);

      const result = await annotationStore.saveAnnotations(
        workflow_id,
        inputs as AnnotationInput[],
        {
          healthScore: health_score,
          scores: scores
            ? {
                security: scores.security,
                reliability: scores.reliability,
                dataIntegrity: scores.data_integrity,
                bestPractices: scores.best_practices,
              }
            : undefined,
          summary,
        },
      );

      getBroadcaster()?.broadcast('annotations_updated', workflow_id, {
        annotations: result.annotations,
        health_score: result.healthScore,
        scores: scores
          ? {
              security: scores.security,
              reliability: scores.reliability,
              data_integrity: scores.data_integrity,
              best_practices: scores.best_practices,
            }
          : null,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              saved: result.saved,
              review_id: result.reviewId,
              health_score: result.healthScore,
            }),
          },
        ],
      };
    },
  );

  // ─── get_annotations ──────────────────────────────────────
  server.tool(
    'flowaibuilder.get_annotations',
    {
      workflow_id: z.string().describe('Workflow id'),
      severity: z
        .enum(['error', 'warning', 'suggestion'])
        .optional()
        .describe('Filter by severity'),
      status: z
        .enum(['active', 'applied', 'dismissed'])
        .optional()
        .describe('Filter by status (default: active)'),
    },
    async ({ workflow_id, severity, status }) => {
      const list = await annotationStore.getAnnotations(workflow_id, { severity, status });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ annotations: list }) }],
      };
    },
  );

  // ─── dismiss_annotation ───────────────────────────────────
  server.tool(
    'flowaibuilder.dismiss_annotation',
    {
      workflow_id: z.string().describe('Workflow id the annotation belongs to'),
      annotation_id: z.string().describe('Annotation id to dismiss'),
      reason: z.string().optional().describe('Optional dismiss reason'),
    },
    async ({ workflow_id, annotation_id, reason }) => {
      try {
        const result = await handleDismissAnnotation({ workflow_id, annotation_id, reason });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        return mcpError((err as Error).message);
      }
    },
  );

  // ─── apply_fix ────────────────────────────────────────────
  server.tool(
    'flowaibuilder.apply_fix',
    {
      workflow_id: z.string().describe('Workflow id the annotation belongs to'),
      annotation_id: z.string().describe('Annotation id whose fix should be applied'),
    },
    async ({ workflow_id, annotation_id }) => {
      try {
        const result = await handleApplyFix({ workflow_id, annotation_id });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        return mcpError((err as Error).message);
      }
    },
  );

  // ─── get_health_score ─────────────────────────────────────
  server.tool(
    'flowaibuilder.get_health_score',
    {
      workflow_id: z.string().describe('Workflow id to read the latest health score for'),
    },
    async ({ workflow_id }) => {
      const [wf] = await db.select().from(workflows).where(eq(workflows.id, workflow_id));
      if (!wf) return mcpError(`Workflow ${workflow_id} not found`);

      const latest = await annotationStore.getLatestReview(workflow_id);
      if (!latest) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                health_score: null,
                scores: null,
                summary: null,
                review_id: null,
                review_type: null,
                annotation_count: 0,
                created_at: null,
              }),
            },
          ],
        };
      }

      const scores = latest.scores
        ? {
            security: latest.scores.security,
            reliability: latest.scores.reliability,
            data_integrity: latest.scores.dataIntegrity,
            best_practices: latest.scores.bestPractices,
          }
        : null;

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              health_score: latest.healthScore,
              scores,
              summary: latest.summary,
              review_id: latest.reviewId,
              review_type: latest.reviewType,
              annotation_count: latest.annotationCount,
              created_at: latest.createdAt,
            }),
          },
        ],
      };
    },
  );
}

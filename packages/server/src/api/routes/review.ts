/**
 * Review REST endpoints — thin wrappers over annotationStore + extracted MCP
 * handlers (handleApplyFix / handleDismissAnnotation). All mutation logic
 * lives in packages/server/src/mcp/tools/review.ts; this module adds browser
 * callable paths only.
 *
 * Wire-shape note: these endpoints return **camelCase** shapes matching
 * `annotationStore.getLatestReview` and `Annotation`, NOT the snake_case wire
 * shape returned by `flowaibuilder.get_health_score`. The UI consumes
 * camelCase consistently.
 *
 * Zero-cost AI: no Anthropic SDK, no direct AI calls. `review/request` simply
 * emits a WebSocket event and returns a prompt string for Claude Code.
 */
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { workflows } from '../../db/schema.js';
import { annotationStore } from '../../review/store.js';
import {
  handleApplyFix,
  handleDismissAnnotation,
  ReviewNotFoundError,
  ReviewConflictError,
} from '../../mcp/tools/review.js';

function reviewErrorStatus(err: unknown): number {
  if (err instanceof ReviewNotFoundError) return 404;
  if (err instanceof ReviewConflictError) return 409;
  return 500;
}
import { getBroadcaster } from '../ws/broadcaster.js';

async function workflowExists(id: string): Promise<boolean> {
  const [row] = await db.select().from(workflows).where(eq(workflows.id, id));
  return !!row;
}

export async function registerReviewRoutes(app: FastifyInstance) {
  // List active annotations
  app.get<{ Params: { id: string } }>('/api/workflows/:id/annotations', async (request, reply) => {
    if (!(await workflowExists(request.params.id))) {
      return reply.code(404).send({ error: 'Workflow not found' });
    }
    const annotations = await annotationStore.getAnnotations(request.params.id, { status: 'active' });
    return { annotations };
  });

  // Latest health score
  app.get<{ Params: { id: string } }>('/api/workflows/:id/health', async (request, reply) => {
    if (!(await workflowExists(request.params.id))) {
      return reply.code(404).send({ error: 'Workflow not found' });
    }
    const latest = await annotationStore.getLatestReview(request.params.id);
    if (!latest) {
      return {
        healthScore: null,
        scores: null,
        summary: null,
        reviewId: null,
        reviewType: null,
        annotationCount: 0,
        createdAt: null,
      };
    }
    return {
      healthScore: latest.healthScore,
      scores: latest.scores,
      summary: latest.summary,
      reviewId: latest.reviewId,
      reviewType: latest.reviewType,
      annotationCount: latest.annotationCount,
      createdAt: latest.createdAt,
    };
  });

  // Apply fix
  app.post<{ Params: { id: string; annotationId: string } }>(
    '/api/workflows/:id/annotations/:annotationId/apply',
    async (request, reply) => {
      if (!(await workflowExists(request.params.id))) {
        return reply.code(404).send({ error: 'Workflow not found' });
      }
      try {
        const result = await handleApplyFix({
          workflow_id: request.params.id,
          annotation_id: request.params.annotationId,
        });
        return result;
      } catch (err) {
        return reply.code(reviewErrorStatus(err)).send({ error: (err as Error).message });
      }
    },
  );

  // Dismiss annotation
  app.post<{ Params: { id: string; annotationId: string }; Body: { reason?: string } }>(
    '/api/workflows/:id/annotations/:annotationId/dismiss',
    async (request, reply) => {
      if (!(await workflowExists(request.params.id))) {
        return reply.code(404).send({ error: 'Workflow not found' });
      }
      try {
        const result = await handleDismissAnnotation({
          workflow_id: request.params.id,
          annotation_id: request.params.annotationId,
          reason: request.body?.reason,
        });
        return result;
      } catch (err) {
        return reply.code(reviewErrorStatus(err)).send({ error: (err as Error).message });
      }
    },
  );

  // Request review — broadcasts `review_requested` + returns paste-prompt
  app.post<{ Params: { id: string }; Body?: { trigger?: string; context_type?: string } }>(
    '/api/workflows/:id/review/request',
    async (request, reply) => {
      if (!(await workflowExists(request.params.id))) {
        return reply.code(404).send({ error: 'Workflow not found' });
      }
      const id = request.params.id;
      const body = request.body ?? {};
      getBroadcaster()?.broadcast('review_requested', id, {
        workflow_id: id,
        trigger: body.trigger ?? 'manual',
        context_type: body.context_type ?? 'general',
        requested_at: new Date().toISOString(),
      });
      return {
        prompt: `Review workflow ${id}. Use flowaibuilder.get_review_context to fetch context and flowaibuilder.save_annotations to write findings.`,
      };
    },
  );
}

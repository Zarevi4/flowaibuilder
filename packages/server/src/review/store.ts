import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { annotations, workflowReviews } from '../db/schema.js';
import type {
  Annotation,
  AnnotationFix,
  AnnotationInput,
  AnnotationSeverity,
  AnnotationStatus,
  ReviewScores,
} from '@flowaibuilder/shared';

export interface SaveAnnotationsReviewMeta {
  healthScore?: number;
  scores?: ReviewScores;
  summary?: string;
  executionId?: string;
}

export interface SaveAnnotationsResult {
  saved: number;
  reviewId: string;
  healthScore: number | null;
  annotations: Annotation[];
}

export interface GetAnnotationsFilter {
  severity?: AnnotationSeverity;
  status?: AnnotationStatus;
}

type AnnotationRow = typeof annotations.$inferSelect;

function rowToAnnotation(row: AnnotationRow): Annotation {
  return {
    id: row.id,
    workflowId: row.workflowId ?? '',
    nodeId: row.nodeId,
    severity: row.severity as AnnotationSeverity,
    title: row.title,
    description: row.description,
    fix: (row.fix ?? undefined) as AnnotationFix | undefined,
    relatedNodes: (row.relatedNodes ?? undefined) as string[] | undefined,
    knowledgeSource: row.knowledgeSource ?? undefined,
    status: (row.status ?? 'active') as AnnotationStatus,
    dismissedReason: row.dismissedReason ?? undefined,
    createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
    appliedAt: row.appliedAt?.toISOString(),
  };
}

export const annotationStore = {
  async saveAnnotations(
    workflowId: string,
    inputs: AnnotationInput[],
    meta: SaveAnnotationsReviewMeta,
  ): Promise<SaveAnnotationsResult> {
    const run = async (tx: typeof db) => {
      const rows = inputs.length
        ? await tx
            .insert(annotations)
            .values(
              inputs.map(a => ({
                workflowId,
                nodeId: a.node_id,
                severity: a.severity,
                title: a.title,
                description: a.description,
                fix: a.fix ?? null,
                relatedNodes: a.related_nodes ?? null,
                knowledgeSource: a.knowledge_source ?? null,
                status: 'active' as const,
              })),
            )
            .returning()
        : [];

      const [review] = await tx
        .insert(workflowReviews)
        .values({
          workflowId,
          executionId: meta.executionId ?? null,
          reviewType: 'ai',
          healthScore: meta.healthScore ?? null,
          scores: meta.scores ?? null,
          summary: meta.summary ?? null,
          annotationCount: rows.length,
        })
        .returning();

      return {
        saved: rows.length,
        reviewId: review.id,
        healthScore: review.healthScore ?? null,
        annotations: rows.map(rowToAnnotation),
      };
    };

    // Use transaction when available (real db); tests may mock without .transaction
    const maybeTx = (db as unknown as { transaction?: (fn: (tx: typeof db) => Promise<SaveAnnotationsResult>) => Promise<SaveAnnotationsResult> }).transaction;
    if (typeof maybeTx === 'function') {
      return maybeTx.call(db, run);
    }
    return run(db);
  },

  async getAnnotations(
    workflowId: string,
    filter: GetAnnotationsFilter = {},
  ): Promise<Annotation[]> {
    const status = filter.status ?? 'active';
    const conds = [eq(annotations.workflowId, workflowId), eq(annotations.status, status)];
    if (filter.severity) conds.push(eq(annotations.severity, filter.severity));
    const rows = await db
      .select()
      .from(annotations)
      .where(and(...conds))
      .orderBy(desc(annotations.createdAt));
    return rows.map(rowToAnnotation);
  },

  async getAnnotationById(annotationId: string): Promise<Annotation | null> {
    const [row] = await db
      .select()
      .from(annotations)
      .where(eq(annotations.id, annotationId));
    return row ? rowToAnnotation(row) : null;
  },

  async applyAnnotation(
    workflowId: string,
    annotationId: string,
  ): Promise<Annotation | null> {
    // Pre-check `fix` presence (immutable once written, so no race) —
    // we must NOT flip status on a no-fix row.
    const [existing] = await db
      .select()
      .from(annotations)
      .where(eq(annotations.id, annotationId));
    if (!existing || existing.workflowId !== workflowId || !existing.fix) return null;

    // Single atomic conditional UPDATE — `status='active'` in the WHERE clause
    // makes this a compare-and-set so concurrent apply_fix calls can't both win.
    // Zero rows returned = already applied/dismissed by a racing call.
    const [updated] = await db
      .update(annotations)
      .set({ status: 'applied', appliedAt: new Date() })
      .where(
        and(
          eq(annotations.id, annotationId),
          eq(annotations.workflowId, workflowId),
          eq(annotations.status, 'active'),
        ),
      )
      .returning();
    return updated ? rowToAnnotation(updated) : null;
  },

  async getLatestReview(workflowId: string): Promise<{
    reviewId: string;
    healthScore: number | null;
    scores: ReviewScores | null;
    summary: string | null;
    reviewType: string;
    annotationCount: number;
    createdAt: string;
  } | null> {
    const rows = await db
      .select()
      .from(workflowReviews)
      .where(eq(workflowReviews.workflowId, workflowId))
      .orderBy(desc(workflowReviews.createdAt))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      reviewId: row.id,
      healthScore: (row.healthScore ?? null) as number | null,
      scores: (row.scores ?? null) as ReviewScores | null,
      summary: row.summary ?? null,
      reviewType: row.reviewType,
      annotationCount: row.annotationCount ?? 0,
      createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
    };
  },

  async dismissAnnotation(
    workflowId: string,
    annotationId: string,
    reason?: string,
  ): Promise<Annotation | null> {
    const [existing] = await db
      .select()
      .from(annotations)
      .where(eq(annotations.id, annotationId));
    if (!existing || existing.workflowId !== workflowId) return null;

    const [updated] = await db
      .update(annotations)
      .set({ status: 'dismissed', dismissedReason: reason ?? null })
      .where(and(eq(annotations.id, annotationId), eq(annotations.workflowId, workflowId)))
      .returning();
    return updated ? rowToAnnotation(updated) : null;
  },
};

export type AnnotationStore = typeof annotationStore;

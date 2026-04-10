/**
 * Auto-review trigger helper (Story 2.4 AC#1).
 *
 * Reads the singleton instanceSettings row on every call (no caching) and, if
 * `autoReviewEnabled === true`, emits a `review_requested` WebSocket broadcast
 * with `trigger: 'auto-save'`. Errors are swallowed so workflow mutations are
 * never blocked by a review-trigger failure.
 *
 * Zero-cost AI: this helper does NOT call any AI service — it merely emits a
 * WS signal that MCP-connected Claude sessions react to.
 */
import { eq } from 'drizzle-orm';
import type { ReviewRequestedPayload } from '@flowaibuilder/shared';
import { db } from '../db/index.js';
import { instanceSettings } from '../db/schema.js';
import { getBroadcaster } from '../api/ws/broadcaster.js';

export async function maybeEmitAutoReview(workflowId: string): Promise<void> {
  try {
    const [row] = await db
      .select()
      .from(instanceSettings)
      .where(eq(instanceSettings.id, 'singleton'));
    if (!row || row.autoReviewEnabled !== true) return;
    const payload: ReviewRequestedPayload = {
      workflow_id: workflowId,
      trigger: 'auto-save',
      context_type: 'on-save',
      requested_at: new Date().toISOString(),
    };
    getBroadcaster()?.broadcast('review_requested', workflowId, payload);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[auto-review] failed:', err);
  }
}

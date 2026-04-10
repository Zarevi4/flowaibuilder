import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory state used by the db mock
const state: { instanceSettings: Array<Record<string, unknown>> } = { instanceSettings: [] };

vi.mock('drizzle-orm', () => ({
  eq: (col: { _col: string }, val: unknown) => ({ kind: 'eq', col: col._col, val }),
}));

vi.mock('../db/schema.js', () => {
  const mk = (cols: string[]) => {
    const out: Record<string, unknown> = { _table: 'instanceSettings' };
    for (const c of cols) out[c] = { _col: c };
    return out;
  };
  return {
    instanceSettings: mk(['id', 'autoReviewEnabled']),
  };
});

vi.mock('../db/index.js', () => {
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async (filter: { col: string; val: unknown }) =>
          state.instanceSettings.filter((r) => r[filter.col] === filter.val),
        ),
      })),
    })),
  };
  return { db };
});

const broadcastSpy = vi.fn();
vi.mock('../api/ws/broadcaster.js', () => ({
  getBroadcaster: () => ({ broadcast: broadcastSpy, broadcastToWorkflow: vi.fn() }),
}));

import { maybeEmitAutoReview } from '../review/triggers.js';

beforeEach(() => {
  state.instanceSettings = [];
  broadcastSpy.mockClear();
});

describe('maybeEmitAutoReview', () => {
  it('does NOT broadcast when autoReviewEnabled=false', async () => {
    state.instanceSettings.push({ id: 'singleton', autoReviewEnabled: false });
    await maybeEmitAutoReview('wf-1');
    expect(broadcastSpy).not.toHaveBeenCalled();
  });

  it('does NOT broadcast when no settings row exists', async () => {
    await maybeEmitAutoReview('wf-1');
    expect(broadcastSpy).not.toHaveBeenCalled();
  });

  it('broadcasts review_requested with trigger=auto-save when enabled', async () => {
    state.instanceSettings.push({ id: 'singleton', autoReviewEnabled: true });
    await maybeEmitAutoReview('wf-1');
    expect(broadcastSpy).toHaveBeenCalledTimes(1);
    const [evt, wfId, payload] = broadcastSpy.mock.calls[0];
    expect(evt).toBe('review_requested');
    expect(wfId).toBe('wf-1');
    expect((payload as { trigger: string }).trigger).toBe('auto-save');
    expect((payload as { context_type: string }).context_type).toBe('on-save');
  });

  it('reads settings on every call (no caching)', async () => {
    state.instanceSettings.push({ id: 'singleton', autoReviewEnabled: false });
    await maybeEmitAutoReview('wf-1');
    expect(broadcastSpy).not.toHaveBeenCalled();
    state.instanceSettings[0].autoReviewEnabled = true;
    await maybeEmitAutoReview('wf-1');
    expect(broadcastSpy).toHaveBeenCalledTimes(1);
  });
});

describe('zero-cost AI invariant for triggers helper', () => {
  it('triggers.ts does not import @anthropic-ai/sdk or openai', async () => {
    const fs = await import('node:fs/promises');
    const url = new URL('../review/triggers.ts', import.meta.url);
    const src = await fs.readFile(url, 'utf8');
    expect(src).not.toContain('@anthropic-ai/sdk');
    expect(src.toLowerCase()).not.toContain('openai');
  });
});

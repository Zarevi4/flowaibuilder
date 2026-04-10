import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../lib/api', () => ({
  requestReview: vi.fn(async () => ({ prompt: 'ok' })),
  getWorkflow: vi.fn(),
  updateWorkflow: vi.fn(async () => ({})),
  updateNode: vi.fn(async () => ({})),
  addNode: vi.fn(async () => ({})),
  deleteNode: vi.fn(async () => ({})),
  addConnection: vi.fn(async () => ({})),
  getTaskLinks: vi.fn(async () => ({ links: [] })),
}));

import { scheduleContinuousReview, cancelContinuousReview, continuousReviewDebounceMs } from '../store/workflow';
import { requestReview } from '../lib/api';

describe('continuous review debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (requestReview as unknown as { mockClear: () => void }).mockClear();
  });
  afterEach(() => {
    cancelContinuousReview();
    vi.useRealTimers();
  });

  it('coalesces three rapid edits into a single request after debounce window', () => {
    scheduleContinuousReview('wf-1');
    scheduleContinuousReview('wf-1');
    scheduleContinuousReview('wf-1');

    vi.advanceTimersByTime(continuousReviewDebounceMs - 100);
    expect(requestReview).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    expect(requestReview).toHaveBeenCalledTimes(1);
    expect(requestReview).toHaveBeenCalledWith('wf-1', { trigger: 'continuous', context_type: 'on-edit' });
  });

  it('cancelContinuousReview prevents the pending call', () => {
    scheduleContinuousReview('wf-1');
    cancelContinuousReview();
    vi.advanceTimersByTime(continuousReviewDebounceMs + 100);
    expect(requestReview).not.toHaveBeenCalled();
  });
});

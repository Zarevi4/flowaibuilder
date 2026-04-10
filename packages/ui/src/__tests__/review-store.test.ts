import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Annotation } from '@flowaibuilder/shared';

vi.mock('../lib/api', () => ({
  getAnnotations: vi.fn(),
  getHealth: vi.fn(),
  applyAnnotationFix: vi.fn(),
  dismissAnnotation: vi.fn(),
}));

import * as api from '../lib/api';
import { useReviewStore } from '../store/review';

const WF_ID = 'wf-1';

function makeAnnotation(id: string, overrides: Partial<Annotation> = {}): Annotation {
  return {
    id,
    workflowId: WF_ID,
    nodeId: 'n1',
    severity: 'error',
    title: `title-${id}`,
    description: 'desc',
    status: 'active',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useReviewStore.getState().clear();
});

describe('useReviewStore', () => {
  it('loadForWorkflow populates annotations and health in parallel', async () => {
    (api.getAnnotations as ReturnType<typeof vi.fn>).mockResolvedValue({
      annotations: [makeAnnotation('a1'), makeAnnotation('a2')],
    });
    (api.getHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
      healthScore: 82, scores: null, summary: null,
      reviewId: 'r1', reviewType: 'ai', annotationCount: 2, createdAt: null,
    });
    await useReviewStore.getState().loadForWorkflow(WF_ID);
    const s = useReviewStore.getState();
    expect(s.annotations).toHaveLength(2);
    expect(s.healthScore).toBe(82);
    expect(s.annotationCount).toBe(2);
    expect(s.loading).toBe(false);
  });

  it('loadForWorkflow sets error on failure', async () => {
    (api.getAnnotations as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    (api.getHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
      healthScore: null, scores: null, summary: null,
      reviewId: null, reviewType: null, annotationCount: 0, createdAt: null,
    });
    await useReviewStore.getState().loadForWorkflow(WF_ID);
    expect(useReviewStore.getState().error).toBe('boom');
  });

  it('applyFix optimistically flips status and reverts on error', async () => {
    (api.getAnnotations as ReturnType<typeof vi.fn>).mockResolvedValue({
      annotations: [makeAnnotation('a1')],
    });
    (api.getHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
      healthScore: null, scores: null, summary: null,
      reviewId: null, reviewType: null, annotationCount: 1, createdAt: null,
    });
    await useReviewStore.getState().loadForWorkflow(WF_ID);

    (api.applyAnnotationFix as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no'));
    await expect(useReviewStore.getState().applyFix('a1')).rejects.toThrow('no');
    const s = useReviewStore.getState();
    expect(s.annotations[0].status).toBe('active'); // reverted
    expect(s.error).toBe('no');
  });

  it('applyWsMessage handles annotation_added', () => {
    useReviewStore.setState({ workflowId: WF_ID, annotations: [] });
    useReviewStore.getState().applyWsMessage({
      type: 'annotation_added',
      workflowId: WF_ID,
      data: { annotation: makeAnnotation('a9') },
      timestamp: new Date().toISOString(),
    });
    expect(useReviewStore.getState().annotations).toHaveLength(1);
  });

  it('applyWsMessage ignores events for other workflows', () => {
    useReviewStore.setState({ workflowId: WF_ID, annotations: [] });
    useReviewStore.getState().applyWsMessage({
      type: 'annotation_added',
      workflowId: 'other',
      data: { annotation: makeAnnotation('a9') },
      timestamp: new Date().toISOString(),
    });
    expect(useReviewStore.getState().annotations).toHaveLength(0);
  });

  it('applyWsMessage on annotation_applied marks status=applied', () => {
    useReviewStore.setState({ workflowId: WF_ID, annotations: [makeAnnotation('a1')] });
    useReviewStore.getState().applyWsMessage({
      type: 'annotation_applied',
      workflowId: WF_ID,
      data: { annotation_id: 'a1' },
      timestamp: new Date().toISOString(),
    });
    expect(useReviewStore.getState().annotations[0].status).toBe('applied');
  });
});

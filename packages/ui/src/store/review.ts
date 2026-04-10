import { create } from 'zustand';
import type { Annotation, ReviewScores, WebSocketMessage } from '@flowaibuilder/shared';
import {
  getAnnotations,
  getHealth,
  applyAnnotationFix,
  dismissAnnotation as apiDismissAnnotation,
} from '../lib/api';

interface ReviewState {
  workflowId: string | null;
  annotations: Annotation[];
  healthScore: number | null;
  scores: ReviewScores | null;
  annotationCount: number;
  loading: boolean;
  error: string | null;
  expandedAnnotationId: string | null;
  panelOpen: boolean;

  loadForWorkflow: (id: string) => Promise<void>;
  clear: () => void;
  applyFix: (annotationId: string) => Promise<void>;
  dismiss: (annotationId: string, reason?: string) => Promise<void>;
  setExpanded: (id: string | null) => void;
  togglePanel: () => void;
  applyWsMessage: (msg: WebSocketMessage) => void;
}

export const useReviewStore = create<ReviewState>()((set, get) => ({
  workflowId: null,
  annotations: [],
  healthScore: null,
  scores: null,
  annotationCount: 0,
  loading: false,
  error: null,
  expandedAnnotationId: null,
  panelOpen: false,

  loadForWorkflow: async (id: string) => {
    set({ workflowId: id, loading: true, error: null });
    try {
      const [{ annotations }, health] = await Promise.all([
        getAnnotations(id),
        getHealth(id),
      ]);
      set({
        annotations,
        healthScore: health.healthScore,
        scores: health.scores,
        annotationCount: annotations.length,
        loading: false,
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to load review data',
        loading: false,
      });
    }
  },

  clear: () => {
    set({
      workflowId: null,
      annotations: [],
      healthScore: null,
      scores: null,
      annotationCount: 0,
      loading: false,
      error: null,
      expandedAnnotationId: null,
      panelOpen: false,
    });
  },

  applyFix: async (annotationId: string) => {
    const { workflowId } = get();
    if (!workflowId) return;
    // Optimistic: flip just this annotation's status. Use a functional
    // updater on commit + revert so concurrent WS events that arrive mid-flight
    // are not clobbered by a stale snapshot.
    set({ error: null, loading: true });
    const snapshot = get().annotations.find((a) => a.id === annotationId);
    const prevStatus = snapshot?.status;
    set((s) => ({
      annotations: s.annotations.map((a) =>
        a.id === annotationId ? { ...a, status: 'applied' as const } : a,
      ),
    }));
    try {
      await applyAnnotationFix(workflowId, annotationId);
      set({ loading: false });
      // The server will also re-broadcast the applied status via
      // `annotation_applied`; refresh the health score because that broadcast
      // doesn't include one.
      try {
        const health = await getHealth(workflowId);
        set({ healthScore: health.healthScore, scores: health.scores });
      } catch {
        /* ignore health refresh failures */
      }
    } catch (err) {
      // Revert ONLY this annotation's status, leaving concurrent mutations alone.
      set((s) => ({
        annotations: s.annotations.map((a) =>
          a.id === annotationId && prevStatus ? { ...a, status: prevStatus } : a,
        ),
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to apply fix',
      }));
      throw err;
    }
  },

  dismiss: async (annotationId: string, reason?: string) => {
    const { workflowId } = get();
    if (!workflowId) return;
    const snapshot = get().annotations.find((a) => a.id === annotationId);
    set({ error: null });
    set((s) => {
      const next = s.annotations.filter((a) => a.id !== annotationId);
      return { annotations: next, annotationCount: next.length };
    });
    try {
      await apiDismissAnnotation(workflowId, annotationId, reason);
    } catch (err) {
      // Re-insert ONLY the dismissed annotation, preserving any concurrent
      // additions/removals from WS events.
      set((s) => {
        if (!snapshot) return s;
        if (s.annotations.some((a) => a.id === annotationId)) return s;
        const next = [snapshot, ...s.annotations];
        return {
          annotations: next,
          annotationCount: next.length,
          error: err instanceof Error ? err.message : 'Failed to dismiss',
        };
      });
      throw err;
    }
  },

  setExpanded: (id) => set({ expandedAnnotationId: id }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),

  applyWsMessage: (msg: WebSocketMessage) => {
    const { workflowId } = get();
    if (!workflowId) return;
    // Server broadcasts put the id inside `data.workflow_id` (snake_case);
    // the envelope `workflowId` field is not guaranteed. Require an explicit
    // match on either field and drop events with no workflow scope at all.
    const dataWorkflowId = (msg.data as { workflow_id?: string } | undefined)?.workflow_id;
    const eventWorkflowId = msg.workflowId ?? dataWorkflowId;
    if (!eventWorkflowId || eventWorkflowId !== workflowId) return;

    switch (msg.type) {
      case 'annotation_added': {
        const data = msg.data as { annotation?: Annotation };
        if (!data.annotation) return;
        const { annotations } = get();
        if (annotations.some((a) => a.id === data.annotation!.id)) return;
        const next = [data.annotation, ...annotations];
        set({ annotations: next, annotationCount: next.length });
        return;
      }
      case 'annotation_applied': {
        const data = msg.data as { annotation_id?: string };
        if (!data.annotation_id) return;
        set((s) => ({
          annotations: s.annotations.map((a) =>
            a.id === data.annotation_id ? { ...a, status: 'applied' as const } : a,
          ),
        }));
        // Refresh the health score since the broadcast does not include one.
        void getHealth(workflowId)
          .then((health) => set({ healthScore: health.healthScore, scores: health.scores }))
          .catch(() => {
            /* ignore */
          });
        return;
      }
      case 'annotations_updated':
      case 'review_completed': {
        // Refetch to avoid snake/camel wire-shape coupling
        void get().loadForWorkflow(workflowId);
        return;
      }
      default:
        return;
    }
  },
}));

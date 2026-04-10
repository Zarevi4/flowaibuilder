import { create } from 'zustand';
import type { ExecutionStatus, NodeExecutionData } from '@flowaibuilder/shared';

interface ExecutionState {
  executionId: string | null;
  status: ExecutionStatus | null;
  nodeStatuses: Record<string, NodeExecutionData>;
  startedAt: number | null;
  durationMs: number | null;
  error: unknown;

  startExecution: (executionId: string) => void;
  handleNodeExecuted: (data: {
    node_id: string;
    node_name: string;
    status: ExecutionStatus;
    duration_ms: number;
  }) => void;
  handleExecutionCompleted: (data: {
    status: ExecutionStatus;
    duration_ms: number;
  }) => void;
  setFullExecutionData: (executionId: string, nodeExecutions: NodeExecutionData[]) => void;
  clearExecution: () => void;
}

export const useExecutionStore = create<ExecutionState>()((set, get) => ({
  executionId: null,
  status: null,
  nodeStatuses: {},
  startedAt: null,
  durationMs: null,
  error: null,

  startExecution: (executionId) =>
    set({
      executionId,
      status: 'running',
      nodeStatuses: {},
      startedAt: Date.now(),
      durationMs: null,
      error: null,
    }),

  handleNodeExecuted: (data) =>
    set((state) => ({
      nodeStatuses: {
        ...state.nodeStatuses,
        [data.node_id]: {
          nodeId: data.node_id,
          nodeName: data.node_name,
          nodeType: '',
          status: data.status,
          duration: data.duration_ms,
        },
      },
    })),

  handleExecutionCompleted: (data) =>
    set({
      status: data.status,
      durationMs: data.duration_ms,
      error: (data as Record<string, unknown>).error ?? null,
    }),

  setFullExecutionData: (executionId, nodeExecutions) => {
    const current = get().executionId;
    if (current !== executionId) return; // Stale response from a different execution
    set((state) => {
      const nodeStatuses: Record<string, NodeExecutionData> = {};
      for (const ne of nodeExecutions) {
        nodeStatuses[ne.nodeId] = ne;
      }
      return { nodeStatuses: { ...state.nodeStatuses, ...nodeStatuses } };
    });
  },

  clearExecution: () =>
    set({
      executionId: null,
      status: null,
      nodeStatuses: {},
      startedAt: null,
      durationMs: null,
      error: null,
    }),
}));

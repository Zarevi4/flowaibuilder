export type ExecutionStatus = 'pending' | 'running' | 'success' | 'error' | 'cancelled';
export type ExecutionMode = 'manual' | 'trigger' | 'webhook' | 'retry' | 'mcp';

export interface NodeExecutionData {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  status: ExecutionStatus;
  startedAt?: string;
  completedAt?: string;
  duration?: number;
  input?: unknown;
  output?: unknown;
  error?: string;
}

export interface Execution {
  id: string;
  workflowId: string;
  workflowVersion?: number;
  status: ExecutionStatus;
  mode: ExecutionMode;
  triggerData?: unknown;
  resultData?: unknown;
  nodeExecutions: NodeExecutionData[];
  error?: unknown;
  triggeredBy: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
}

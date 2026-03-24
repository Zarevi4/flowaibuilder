export interface Position {
  x: number;
  y: number;
}

export interface NodeData {
  label: string;
  config: Record<string, unknown>;
  [key: string]: unknown;
}

export interface WorkflowNode {
  id: string;
  type: NodeType;
  name: string;
  position: Position;
  data: NodeData;
  disabled?: boolean;
  retryOnFail?: boolean;
  maxRetries?: number;
  retryInterval?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Connection {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  connections: Connection[];
  active: boolean;
  version: number;
  environment?: string;
  canvas?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  tags?: string[];
  healthScore?: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export type NodeType =
  | 'webhook'
  | 'schedule'
  | 'manual'
  | 'code-js'
  | 'code-python'
  | 'if'
  | 'switch'
  | 'merge'
  | 'loop'
  | 'set'
  | 'http-request'
  | 'ai-agent'
  | 'respond-webhook';

export type NodeCategory = 'trigger' | 'logic' | 'integration' | 'output';

export interface NodeTypeMetadata {
  type: NodeType;
  category: NodeCategory;
  label: string;
  description: string;
  color: string;
  icon: string;
  inputs: number;
  outputs: number;
}

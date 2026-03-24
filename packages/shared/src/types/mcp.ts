export interface McpToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export type WebSocketEventType =
  | 'workflow_created'
  | 'workflow_updated'
  | 'workflow_deleted'
  | 'node_added'
  | 'node_updated'
  | 'node_removed'
  | 'connection_added'
  | 'connection_removed'
  | 'node_executed'
  | 'execution_started'
  | 'execution_completed'
  | 'annotation_added'
  | 'annotations_updated'
  | 'zone_created'
  | 'zone_deleted';

export interface WebSocketMessage {
  type: WebSocketEventType;
  workflowId: string;
  data: unknown;
  timestamp: string;
}

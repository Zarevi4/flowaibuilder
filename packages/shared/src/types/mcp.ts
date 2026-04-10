export interface McpToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export type WebSocketEventType =
  | 'connected'
  | 'full_sync'
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
  | 'annotation_applied'
  | 'review_completed'
  | 'review_requested'
  | 'zone_created'
  | 'zone_updated'
  | 'zone_deleted'
  | 'agent_messages_updated'
  | 'team_tasks_updated'
  | 'team_watch_started'
  | 'team_watch_stopped'
  | 'task_linked_to_node'
  | 'workflow_version_created'
  | 'execution_queued';

export type ReviewTrigger = 'manual' | 'auto-save' | 'continuous' | 'post-execution' | 'pre-deploy';
export type ReviewContextType = 'general' | 'on-save' | 'on-edit' | 'post-execution' | 'pre-deploy';

export interface ReviewRequestedPayload {
  workflow_id: string;
  trigger: ReviewTrigger;
  context_type: ReviewContextType;
  execution_id?: string;
  requested_at: string;
}

export interface WebSocketMessage {
  type: WebSocketEventType;
  workflowId: string;
  data: unknown;
  timestamp: string;
}

export type AnnotationSeverity = 'error' | 'warning' | 'suggestion';
export type AnnotationStatus = 'active' | 'applied' | 'dismissed';

export interface AnnotationFix {
  description: string;
  tool: string;
  params: Record<string, unknown>;
}

export interface Annotation {
  id: string;
  workflowId: string;
  nodeId: string;
  severity: AnnotationSeverity;
  title: string;
  description: string;
  fix?: AnnotationFix;
  relatedNodes?: string[];
  knowledgeSource?: string;
  status: AnnotationStatus;
  dismissedReason?: string;
  createdAt: string;
  appliedAt?: string;
}

/**
 * Per-dimension scores. Each dimension is 0-25.
 * The four dimensions sum to an overall 0-100 health score.
 */
export interface ReviewScores {
  /** 0-25 */
  security: number;
  /** 0-25 */
  reliability: number;
  /** 0-25 */
  dataIntegrity: number;
  /** 0-25 */
  bestPractices: number;
}

/** Snake-case wire shape returned by flowaibuilder.get_health_score */
export interface HealthScoreResult {
  health_score: number | null;
  scores: {
    security: number;
    reliability: number;
    data_integrity: number;
    best_practices: number;
  } | null;
  summary: string | null;
  review_id: string | null;
  review_type: string | null;
  annotation_count: number;
  created_at: string | null;
}

export interface WorkflowReview {
  id: string;
  workflowId: string;
  executionId?: string;
  reviewType: string;
  healthScore?: number;
  scores?: ReviewScores;
  summary?: string;
  annotationCount?: number;
  createdAt: string;
}

/** Snake-case wire shape accepted by flowaibuilder.save_annotations */
export interface AnnotationInput {
  node_id: string;
  severity: AnnotationSeverity;
  title: string;
  description: string;
  fix?: AnnotationFix;
  related_nodes?: string[];
  knowledge_source?: string;
}

export interface ReviewContextNode {
  id: string;
  type: string;
  name: string;
  config: Record<string, unknown>;
  incoming_data_fields: string[];
  outgoing_data_fields: string[];
}

export interface ReviewContextConnection {
  id: string;
  source_node_id: string;
  target_node_id: string;
  source_handle?: string;
  target_handle?: string;
}

export interface ReviewContextExecution {
  status: string;
  error: unknown;
  node_errors: unknown;
  duration_ms: number | null;
  started_at: string | null;
}

export interface ReviewContextZone {
  name: string;
  node_ids: string[];
  reason: string | null;
  pinned_by: string;
}

export type DetectedPattern =
  | 'ai_agent'
  | 'webhook_processing'
  | 'http_api_chain'
  | 'scheduled_batch'
  | 'general';

export interface ReviewContext {
  workflow: { id: string; name: string; description: string };
  nodes: ReviewContextNode[];
  connections: ReviewContextConnection[];
  detected_pattern: DetectedPattern;
  credentials_used: string[];
  recent_executions: ReviewContextExecution[];
  current_annotations: Annotation[];
  protected_zones: ReviewContextZone[];
  failed_execution?: {
    execution_id: string;
    status: string;
    error: unknown;
    node_errors: unknown;
    duration_ms: number | null;
    started_at: string | null;
    bottleneck_node_id: string | null;
  };
  review_request_context?: {
    type: 'general' | 'on-save' | 'on-edit' | 'post-execution' | 'pre-deploy';
    execution_id?: string;
  };
}

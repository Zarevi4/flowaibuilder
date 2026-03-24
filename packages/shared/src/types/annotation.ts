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

export interface ReviewScores {
  security: number;
  reliability: number;
  dataIntegrity: number;
  bestPractices: number;
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

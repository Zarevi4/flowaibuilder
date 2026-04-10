import type {
  Workflow,
  WorkflowNode,
  Connection,
  Annotation,
  ReviewContext,
  ReviewContextNode,
  ReviewContextExecution,
  ReviewContextZone,
  DetectedPattern,
} from '@flowaibuilder/shared';

interface ZoneRow {
  name: string;
  nodeIds: unknown;
  reason: string | null;
  pinnedBy: string;
}

interface ExecutionRow {
  status: string;
  error: unknown;
  nodeExecutions: unknown;
  durationMs: number | null;
  startedAt: Date | null;
}

export function detectPattern(workflow: Workflow): DetectedPattern {
  const nodes = workflow.nodes ?? [];
  if (nodes.some(n => String(n.type).includes('ai-agent'))) return 'ai_agent';
  const hasWebhook = nodes.some(n => n.type === 'webhook');
  const httpCount = nodes.filter(n => n.type === 'http-request').length;
  if (hasWebhook && httpCount <= 1) return 'webhook_processing';
  if (httpCount >= 2) return 'http_api_chain';
  if (nodes.some(n => n.type === 'schedule')) return 'scheduled_batch';
  return 'general';
}

export function extractCredentialTypes(workflow: Workflow): string[] {
  const out = new Set<string>();
  for (const n of workflow.nodes ?? []) {
    const ct = (n.data?.config as Record<string, unknown> | undefined)?.credentialType;
    if (typeof ct === 'string' && ct.length > 0) out.add(ct);
  }
  return Array.from(out);
}

function extractFieldNames(config: Record<string, unknown> | undefined): string[] {
  if (!config) return [];
  const fields: string[] = [];
  // Common static shapes: { outputFields: [...] }, { fields: {k: v} }, { assign: [{name}] }
  const of = config.outputFields;
  if (Array.isArray(of)) for (const f of of) if (typeof f === 'string') fields.push(f);
  const f = config.fields;
  if (f && typeof f === 'object' && !Array.isArray(f)) fields.push(...Object.keys(f));
  const assign = config.assign;
  if (Array.isArray(assign)) {
    for (const a of assign) {
      if (a && typeof a === 'object' && 'name' in a && typeof (a as { name: unknown }).name === 'string') {
        fields.push((a as { name: string }).name);
      }
    }
  }
  return Array.from(new Set(fields));
}

function buildNode(
  node: WorkflowNode,
  nodesById: Map<string, WorkflowNode>,
  connections: Connection[],
): ReviewContextNode {
  const incoming = connections
    .filter(c => c.targetNodeId === node.id)
    .map(c => nodesById.get(c.sourceNodeId))
    .filter((n): n is WorkflowNode => !!n)
    .flatMap(n => extractFieldNames(n.data?.config as Record<string, unknown> | undefined));
  const outgoing = extractFieldNames(node.data?.config as Record<string, unknown> | undefined);
  return {
    id: node.id,
    type: String(node.type),
    name: node.name,
    config: (node.data?.config ?? {}) as Record<string, unknown>,
    incoming_data_fields: Array.from(new Set(incoming)),
    outgoing_data_fields: outgoing,
  };
}

export function buildReviewContext(
  workflow: Workflow,
  executions: ExecutionRow[],
  annotations: Annotation[],
  zones: ZoneRow[],
  failed_execution?: ReviewContext['failed_execution'],
  review_request_context?: ReviewContext['review_request_context'],
): ReviewContext {
  const nodes = workflow.nodes ?? [];
  const connections = workflow.connections ?? [];
  const nodesById = new Map(nodes.map(n => [n.id, n]));

  const recent_executions: ReviewContextExecution[] = executions.map(e => ({
    status: e.status,
    error: e.error,
    node_errors: e.nodeExecutions,
    duration_ms: e.durationMs,
    started_at: e.startedAt ? e.startedAt.toISOString() : null,
  }));

  const protected_zones: ReviewContextZone[] = zones.map(z => ({
    name: z.name,
    node_ids: Array.isArray(z.nodeIds) ? (z.nodeIds as string[]) : [],
    reason: z.reason,
    pinned_by: z.pinnedBy,
  }));

  return {
    workflow: {
      id: workflow.id,
      name: workflow.name,
      description: workflow.description ?? '',
    },
    nodes: nodes.map(n => buildNode(n, nodesById, connections)),
    connections: connections.map(c => ({
      id: c.id,
      source_node_id: c.sourceNodeId,
      target_node_id: c.targetNodeId,
      source_handle: c.sourceHandle,
      target_handle: c.targetHandle,
    })),
    detected_pattern: detectPattern(workflow),
    credentials_used: extractCredentialTypes(workflow),
    recent_executions,
    current_annotations: annotations,
    protected_zones,
    ...(failed_execution ? { failed_execution } : {}),
    ...(review_request_context ? { review_request_context } : {}),
  };
}

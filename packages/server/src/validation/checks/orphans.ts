import type { Workflow, ValidationIssue, NodeType } from '@flowaibuilder/shared';

const TRIGGER_TYPES: ReadonlySet<NodeType> = new Set<NodeType>(['webhook', 'schedule', 'manual']);

export function findOrphans(workflow: Workflow): ValidationIssue[] {
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  for (const n of workflow.nodes) {
    incoming.set(n.id, 0);
    outgoing.set(n.id, 0);
  }
  for (const c of workflow.connections) {
    outgoing.set(c.sourceNodeId, (outgoing.get(c.sourceNodeId) ?? 0) + 1);
    incoming.set(c.targetNodeId, (incoming.get(c.targetNodeId) ?? 0) + 1);
  }

  const issues: ValidationIssue[] = [];
  for (const n of workflow.nodes) {
    if (TRIGGER_TYPES.has(n.type)) continue;
    const inC = incoming.get(n.id) ?? 0;
    const outC = outgoing.get(n.id) ?? 0;
    if (inC === 0 && outC === 0) {
      issues.push({
        severity: 'warning',
        code: 'orphan-node',
        message: `Node '${n.name}' (${n.type}) has no incoming or outgoing connections`,
        nodeId: n.id,
      });
    }
  }
  return issues;
}

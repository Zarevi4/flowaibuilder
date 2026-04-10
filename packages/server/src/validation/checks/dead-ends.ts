import type { Workflow, ValidationIssue, NodeType } from '@flowaibuilder/shared';

const TRIGGER_TYPES: ReadonlySet<NodeType> = new Set<NodeType>(['webhook', 'schedule', 'manual']);

export function findDeadEnds(workflow: Workflow): ValidationIssue[] {
  const adj = new Map<string, string[]>();
  const outgoingCount = new Map<string, number>();
  const typeOf = new Map<string, NodeType>();
  for (const n of workflow.nodes) {
    adj.set(n.id, []);
    outgoingCount.set(n.id, 0);
    typeOf.set(n.id, n.type);
  }
  for (const c of workflow.connections) {
    if (adj.has(c.sourceNodeId)) {
      adj.get(c.sourceNodeId)!.push(c.targetNodeId);
      outgoingCount.set(c.sourceNodeId, (outgoingCount.get(c.sourceNodeId) ?? 0) + 1);
    }
  }

  // Anchors = respond-webhook nodes. Terminal non-trigger nodes are NOT
  // anchors — they are the dead-end candidates we flag when they can't
  // reach a respond-webhook.
  const anchors = new Set<string>();
  for (const n of workflow.nodes) {
    if (n.type === 'respond-webhook') anchors.add(n.id);
  }

  // If there are no anchors at all, skip entirely (per Dev Notes: nothing
  // to anchor against — avoid false positives on pure trigger-only flows).
  if (anchors.size === 0) return [];

  const issues: ValidationIssue[] = [];
  for (const n of workflow.nodes) {
    if (TRIGGER_TYPES.has(n.type)) continue;
    if (n.type === 'respond-webhook') continue;

    // BFS forward from n; check if any respond-webhook is reached
    const visited = new Set<string>([n.id]);
    const queue: string[] = [n.id];
    let reached = false;
    while (queue.length && !reached) {
      const cur = queue.shift()!;
      for (const next of adj.get(cur) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        if (anchors.has(next)) {
          reached = true;
          break;
        }
        queue.push(next);
      }
    }
    if (!reached) {
      issues.push({
        severity: 'warning',
        code: 'dead-end-branch',
        message: `Node '${n.name}' (${n.type}) is on a dead-end branch — no path leads to an output`,
        nodeId: n.id,
      });
    }
  }
  return issues;
}

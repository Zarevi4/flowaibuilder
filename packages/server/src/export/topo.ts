import type { WorkflowNode, Connection } from '@flowaibuilder/shared';

export interface TopoResult {
  nodes: WorkflowNode[];
  hasCycle: boolean;
}

/**
 * Kahn's algorithm. On cycles, falls back to insertion order and reports hasCycle=true.
 */
export function topoSort(nodes: WorkflowNode[], connections: Connection[]): TopoResult {
  const indegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    indegree.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const c of connections) {
    if (!indegree.has(c.sourceNodeId) || !indegree.has(c.targetNodeId)) continue;
    adj.get(c.sourceNodeId)!.push(c.targetNodeId);
    indegree.set(c.targetNodeId, (indegree.get(c.targetNodeId) ?? 0) + 1);
  }

  const queue: string[] = [];
  // Preserve insertion order among ready nodes
  for (const n of nodes) if ((indegree.get(n.id) ?? 0) === 0) queue.push(n.id);

  const orderedIds: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    orderedIds.push(id);
    for (const next of adj.get(id) ?? []) {
      const d = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }

  if (orderedIds.length !== nodes.length) {
    return { nodes: [...nodes], hasCycle: true };
  }
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  return { nodes: orderedIds.map((id) => byId.get(id)!).filter(Boolean), hasCycle: false };
}

import type { Workflow, ValidationIssue } from '@flowaibuilder/shared';

export function findCycles(workflow: Workflow): ValidationIssue[] {
  const adj = new Map<string, string[]>();
  const nameOf = new Map<string, string>();
  for (const n of workflow.nodes) {
    adj.set(n.id, []);
    nameOf.set(n.id, n.name);
  }
  for (const c of workflow.connections) {
    if (adj.has(c.sourceNodeId)) adj.get(c.sourceNodeId)!.push(c.targetNodeId);
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const n of workflow.nodes) color.set(n.id, WHITE);

  const issues: ValidationIssue[] = [];
  const seenCycles = new Set<string>();

  function dfs(node: string, stack: string[]) {
    color.set(node, GRAY);
    stack.push(node);
    for (const next of adj.get(node) ?? []) {
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) {
        // Found back-edge → cycle
        const idx = stack.indexOf(next);
        const cyclePath = stack.slice(idx).concat(next);
        const key = [...cyclePath].slice(0, -1).sort().join('|');
        if (!seenCycles.has(key)) {
          seenCycles.add(key);
          const names = cyclePath.map((id) => nameOf.get(id) ?? id);
          issues.push({
            severity: 'error',
            code: 'circular-dependency',
            message: `Circular dependency: ${names.join(' → ')} (nodes: ${cyclePath.slice(0, -1).join(', ')})`,
            nodeId: cyclePath[0],
          });
        }
      } else if (c === WHITE) {
        dfs(next, stack);
      }
    }
    stack.pop();
    color.set(node, BLACK);
  }

  for (const n of workflow.nodes) {
    if ((color.get(n.id) ?? WHITE) === WHITE) dfs(n.id, []);
  }
  return issues;
}

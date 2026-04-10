import type { Workflow, WorkflowNode } from '@flowaibuilder/shared';
import { topoSort } from '../topo.js';

function summarizeConfig(node: WorkflowNode): string {
  const cfg = node.data?.config ?? {};
  const keys = Object.keys(cfg);
  if (keys.length === 0) return 'no config';
  return `config: ${keys.join(', ')}`;
}

export function compilePrompt(workflow: Workflow): string {
  const { nodes: ordered } = topoSort(workflow.nodes, workflow.connections);
  const nameById = new Map(workflow.nodes.map((n) => [n.id, n.name] as const));

  const lines: string[] = [];
  lines.push(`# Workflow: ${workflow.name}`);
  lines.push('');
  lines.push('## Description');
  lines.push(workflow.description?.trim() ? workflow.description : '_No description._');
  lines.push('');

  lines.push('## Nodes');
  for (const n of ordered) {
    lines.push(`- **${n.name}** (${n.type}, id=${n.id}) — ${summarizeConfig(n)}`);
  }
  lines.push('');

  lines.push('## Connections');
  if (workflow.connections.length === 0) {
    lines.push('_No connections._');
  } else {
    for (const c of workflow.connections) {
      const src = nameById.get(c.sourceNodeId) ?? c.sourceNodeId;
      const tgt = nameById.get(c.targetNodeId) ?? c.targetNodeId;
      const handles =
        c.sourceHandle || c.targetHandle
          ? ` (${c.sourceHandle ?? '*'} → ${c.targetHandle ?? '*'})`
          : '';
      lines.push(`- ${src} → ${tgt}${handles}`);
    }
  }
  lines.push('');

  lines.push('## Data Flow');
  if (ordered.length === 0) {
    lines.push('_Empty workflow._');
  } else {
    const flow = ordered.map((n) => `${n.name} (${n.type})`).join(' → ');
    lines.push(
      `Execution begins at the trigger and proceeds through: ${flow}. Each node receives the output of its upstream connections and passes its result downstream.`,
    );
  }

  return lines.join('\n');
}

import type { Workflow } from '@flowaibuilder/shared';

function safeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_]/g, '_');
}

function escapeLabel(s: string): string {
  return s.replace(/"/g, '\\"');
}

function safeHandle(s: string): string {
  return s.replace(/[|"]/g, '_');
}

export function compileMermaid(workflow: Workflow): string {
  const lines: string[] = ['flowchart LR'];
  for (const n of workflow.nodes) {
    lines.push(`  ${safeId(n.id)}["${escapeLabel(n.name)}\\n(${n.type})"]`);
  }
  for (const c of workflow.connections) {
    const src = safeId(c.sourceNodeId);
    const tgt = safeId(c.targetNodeId);
    if (c.sourceHandle || c.targetHandle) {
      const lbl = `${c.sourceHandle ? safeHandle(c.sourceHandle) : '*'}→${c.targetHandle ? safeHandle(c.targetHandle) : '*'}`;
      lines.push(`  ${src} -->|${lbl}| ${tgt}`);
    } else {
      lines.push(`  ${src} --> ${tgt}`);
    }
  }
  return lines.join('\n');
}

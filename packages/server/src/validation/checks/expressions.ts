import type { Workflow, ValidationIssue } from '@flowaibuilder/shared';

function countOccurrences(str: string, sub: string): number {
  let n = 0;
  let i = 0;
  while ((i = str.indexOf(sub, i)) !== -1) {
    n++;
    i += sub.length;
  }
  return n;
}

function walk(
  value: unknown,
  path: string,
  emit: (path: string) => void,
): void {
  if (typeof value === 'string') {
    const opens = countOccurrences(value, '{{');
    const closes = countOccurrences(value, '}}');
    if (opens !== closes) emit(path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, `${path}[${i}]`, emit));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      walk(v, path ? `${path}.${k}` : k, emit);
    }
  }
}

export function findExpressionErrors(workflow: Workflow): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const n of workflow.nodes) {
    const cfg = (n.data?.config ?? {}) as Record<string, unknown>;
    walk(cfg, '', (path) => {
      issues.push({
        severity: 'warning',
        code: 'expression-syntax-error',
        message: `Node '${n.name}' has unbalanced expression braces in field '${path}'`,
        nodeId: n.id,
      });
    });
  }
  return issues;
}

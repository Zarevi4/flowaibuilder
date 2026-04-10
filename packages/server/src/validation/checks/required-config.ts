import type { Workflow, ValidationIssue } from '@flowaibuilder/shared';
import { REQUIRED_FIELDS, isMissing } from '../required-fields.js';

export function findMissingConfig(workflow: Workflow): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const n of workflow.nodes) {
    const required = REQUIRED_FIELDS[n.type];
    if (!required) continue;
    const cfg = (n.data?.config ?? {}) as Record<string, unknown>;
    for (const field of required) {
      if (isMissing(cfg[field])) {
        issues.push({
          severity: 'error',
          code: 'missing-required-config',
          message: `Node '${n.name}' (${n.type}) is missing required field: ${field}`,
          nodeId: n.id,
        });
      }
    }
  }
  return issues;
}

import type { Workflow, ValidationResult, ValidationIssue } from '@flowaibuilder/shared';
import { findOrphans } from './checks/orphans.js';
import { findCycles } from './checks/cycles.js';
import { findMissingConfig } from './checks/required-config.js';
import { findExpressionErrors } from './checks/expressions.js';
import { findDeadEnds } from './checks/dead-ends.js';

export { REQUIRED_FIELDS } from './required-fields.js';

export function validateWorkflow(workflow: Workflow): ValidationResult {
  const issues: ValidationIssue[] = [
    ...findOrphans(workflow),
    ...findCycles(workflow),
    ...findMissingConfig(workflow),
    ...findExpressionErrors(workflow),
    ...findDeadEnds(workflow),
  ];
  const valid = issues.every((i) => i.severity !== 'error');
  return { valid, issues };
}

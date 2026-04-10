import type { Workflow } from '@flowaibuilder/shared';

export function compileJson(workflow: Workflow): string {
  return JSON.stringify(workflow, null, 2);
}

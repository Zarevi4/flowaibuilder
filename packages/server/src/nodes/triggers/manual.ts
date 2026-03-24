import type { WorkflowNode } from '@flowaibuilder/shared';
import type { BaseNodeHandler } from '../../engine/node-runner.js';
import type { NodeContext } from '../../engine/context.js';

/**
 * ManualTrigger: Passes through whatever data was provided at execution time.
 * Unlike webhook, no HTTP-specific extraction — just forward the raw trigger data.
 */
export const manualHandler: BaseNodeHandler = {
  async execute(node: WorkflowNode, context: NodeContext): Promise<unknown> {
    const input = context.$input.item;
    if (!input) {
      return { triggered: true, timestamp: new Date().toISOString() };
    }
    return input;
  },
};

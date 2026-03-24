import type { WorkflowNode } from '@flowaibuilder/shared';
import type { BaseNodeHandler } from '../../engine/node-runner.js';
import type { NodeContext } from '../../engine/context.js';

/**
 * WebhookTrigger: Extracts body, headers, query from incoming HTTP request.
 * The actual Fastify route registration happens in the API layer.
 * This handler processes the trigger data passed to the executor.
 */
export const webhookHandler: BaseNodeHandler = {
  async execute(node: WorkflowNode, context: NodeContext): Promise<unknown> {
    // Trigger nodes pass through the trigger data
    const input = context.$input.item;
    if (!input) {
      return { body: {}, headers: {}, query: {}, method: 'GET', path: '/' };
    }

    const data = input as Record<string, unknown>;
    return {
      body: data.body ?? {},
      headers: data.headers ?? {},
      query: data.query ?? {},
      method: data.method ?? 'GET',
      path: data.path ?? node.data.config?.path ?? '/',
    };
  },
};

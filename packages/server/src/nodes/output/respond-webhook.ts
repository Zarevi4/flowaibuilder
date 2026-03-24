import type { WorkflowNode } from '@flowaibuilder/shared';
import type { BaseNodeHandler } from '../../engine/node-runner.js';
import type { NodeContext } from '../../engine/context.js';

/**
 * RespondWebhook: Prepares HTTP response data to return to the webhook caller.
 * The actual HTTP response is sent by the API layer after execution completes.
 */
export const respondWebhookHandler: BaseNodeHandler = {
  async execute(node: WorkflowNode, context: NodeContext): Promise<unknown> {
    const config = node.data.config as Record<string, unknown>;
    const input = context.$json;

    const statusCode = (config.statusCode as number) ?? 200;
    const headers = (config.headers as Record<string, string>) ?? {};
    const body = config.body ?? input;
    const contentType = (config.contentType as string) ?? 'application/json';

    if (!headers['content-type'] && !headers['Content-Type']) {
      headers['Content-Type'] = contentType;
    }

    return {
      statusCode,
      headers,
      body,
    };
  },
};

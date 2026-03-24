import type { WorkflowNode } from '@flowaibuilder/shared';
import type { BaseNodeHandler } from '../../engine/node-runner.js';
import type { NodeContext } from '../../engine/context.js';

/**
 * HttpRequest: Makes HTTP requests with configurable method, url, headers, body, auth.
 */
export const httpRequestHandler: BaseNodeHandler = {
  async execute(node: WorkflowNode, context: NodeContext): Promise<unknown> {
    const config = node.data.config as Record<string, unknown>;

    const url = config.url as string;
    if (!url) {
      throw new Error('HTTP Request: url is required');
    }

    const method = ((config.method as string) ?? 'GET').toUpperCase();
    const headers: Record<string, string> = { ...(config.headers as Record<string, string> ?? {}) };
    const body = config.body as unknown;
    const timeout = (config.timeout as number) ?? 30000;

    // Auth support
    const authType = config.authType as string | undefined;
    if (authType === 'bearer' && config.token) {
      headers['Authorization'] = `Bearer ${config.token as string}`;
    } else if (authType === 'basic' && config.username && config.password) {
      const encoded = Buffer.from(`${config.username}:${config.password}`).toString('base64');
      headers['Authorization'] = `Basic ${encoded}`;
    }

    // Set content-type for body
    if (body && !headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(timeout),
    };

    if (body && method !== 'GET' && method !== 'HEAD') {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);
    const contentType = response.headers.get('content-type') ?? '';

    let data: unknown;
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    return {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers),
      data,
    };
  },
};

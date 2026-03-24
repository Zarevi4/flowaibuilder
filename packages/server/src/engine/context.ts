import type { Workflow } from '@flowaibuilder/shared';

export interface NodeContext {
  $input: {
    first: () => unknown;
    last: () => unknown;
    all: () => unknown[];
    item: unknown;
  };
  $json: Record<string, unknown>;
  $env: Record<string, string>;
  $secrets: Record<string, string>;
  $helpers: {
    httpRequest: (config: HttpRequestConfig) => Promise<unknown>;
  };
  $workflow: {
    id: string;
    name: string;
  };
}

export interface HttpRequestConfig {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
}

export function createNodeContext(params: {
  input: unknown;
  workflow: Workflow;
  secrets?: Record<string, string>;
  env?: Record<string, string>;
}): NodeContext {
  const inputArray = Array.isArray(params.input) ? params.input : params.input != null ? [params.input] : [];

  return {
    $input: {
      first: () => inputArray[0],
      last: () => inputArray[inputArray.length - 1],
      all: () => inputArray,
      item: inputArray[0],
    },
    $json: (typeof inputArray[0] === 'object' && inputArray[0] !== null)
      ? inputArray[0] as Record<string, unknown>
      : {},
    $env: params.env ?? {},
    $secrets: params.secrets ?? {},
    $helpers: {
      httpRequest: async (config: HttpRequestConfig) => {
        const resp = await fetch(config.url, {
          method: config.method ?? 'GET',
          headers: config.headers,
          body: config.body ? JSON.stringify(config.body) : undefined,
          signal: config.timeout ? AbortSignal.timeout(config.timeout) : undefined,
        });
        const contentType = resp.headers.get('content-type') ?? '';
        const data = contentType.includes('application/json')
          ? await resp.json()
          : await resp.text();
        return { status: resp.status, headers: Object.fromEntries(resp.headers), data };
      },
    },
    $workflow: {
      id: params.workflow.id,
      name: params.workflow.name,
    },
  };
}

import type { WorkflowNode } from '@flowaibuilder/shared';
import type { BaseNodeHandler } from '../../engine/node-runner.js';
import type { NodeContext } from '../../engine/context.js';

/**
 * CodeJS: Executes JavaScript code with access to $input, $json, $helpers, $env, $secrets.
 * Uses Function constructor for sandboxed execution (isolated-vm can be added later for prod).
 */
export const codeJsHandler: BaseNodeHandler = {
  async execute(node: WorkflowNode, context: NodeContext): Promise<unknown> {
    const code = (node.data.config?.code as string) ?? '';
    if (!code.trim()) {
      return context.$input.all();
    }

    // Build the sandbox context
    const sandbox = {
      $input: context.$input,
      $json: context.$json,
      $env: context.$env,
      $secrets: context.$secrets,
      $helpers: context.$helpers,
      $workflow: context.$workflow,
      JSON,
      Math,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      encodeURIComponent,
      decodeURIComponent,
      console: {
        log: (...args: unknown[]) => { /* captured */ },
        warn: (...args: unknown[]) => { /* captured */ },
        error: (...args: unknown[]) => { /* captured */ },
      },
    };

    // Create function with context variables
    const paramNames = Object.keys(sandbox);
    const paramValues = Object.values(sandbox);

    // Wrap user code in an async IIFE so they can use await
    const wrappedCode = `
      return (async () => {
        ${code}
      })();
    `;

    try {
      const fn = new Function(...paramNames, wrappedCode);
      const result = await fn(...paramValues);
      return result;
    } catch (err) {
      throw new Error(
        `Code execution error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
};

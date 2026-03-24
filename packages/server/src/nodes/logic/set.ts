import type { WorkflowNode } from '@flowaibuilder/shared';
import type { BaseNodeHandler } from '../../engine/node-runner.js';
import type { NodeContext } from '../../engine/context.js';

/**
 * Set: Sets/modifies fields on the data object.
 * Config contains `fields`: array of { name, value } pairs.
 * Can also use `mode`: 'set' (default) or 'remove'.
 */
export const setHandler: BaseNodeHandler = {
  async execute(node: WorkflowNode, context: NodeContext): Promise<unknown> {
    const config = node.data.config as Record<string, unknown>;
    const fields = (config.fields as Array<{ name: string; value: unknown }>) ?? [];
    const mode = (config.mode as string) ?? 'set';
    const keepExisting = (config.keepExisting as boolean) ?? true;

    const input = context.$json;
    const result: Record<string, unknown> = keepExisting ? { ...input } : {};

    for (const field of fields) {
      if (mode === 'remove') {
        delete result[field.name];
      } else {
        // Support simple expression evaluation for values
        const value = typeof field.value === 'string' && field.value.startsWith('={{')
          ? evaluateExpression(field.value, context)
          : field.value;
        setNestedValue(result, field.name, value);
      }
    }

    return result;
  },
};

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

function evaluateExpression(expr: string, context: NodeContext): unknown {
  // Strip ={{ and }}
  const code = expr.slice(3, -2).trim();
  try {
    const fn = new Function('$input', '$json', '$env', '$secrets', `return ${code};`);
    return fn(context.$input, context.$json, context.$env, context.$secrets);
  } catch {
    return expr; // Return raw string if evaluation fails
  }
}

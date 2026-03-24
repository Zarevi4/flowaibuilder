import type { WorkflowNode } from '@flowaibuilder/shared';
import type { BaseNodeHandler } from '../../engine/node-runner.js';
import type { NodeContext } from '../../engine/context.js';

type Operator =
  | 'equals'
  | 'notEquals'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'exists'
  | 'notExists';

/**
 * IF: Evaluates a condition (field, operator, value) and returns { condition: boolean, data }.
 * The executor uses sourceHandle 'true'/'false' to route downstream.
 */
export const ifHandler: BaseNodeHandler = {
  async execute(node: WorkflowNode, context: NodeContext): Promise<unknown> {
    const config = node.data.config as Record<string, unknown>;
    const field = config.field as string;
    const operator = (config.operator as Operator) ?? 'equals';
    const compareValue = config.value;

    // Get the field value from input data
    const input = context.$json;
    const fieldValue = getNestedValue(input, field);

    const result = evaluate(fieldValue, operator, compareValue);

    return {
      condition: result,
      data: context.$input.all(),
    };
  },
};

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  if (!path) return obj;
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function evaluate(fieldValue: unknown, operator: Operator, compareValue: unknown): boolean {
  switch (operator) {
    case 'equals':
      return fieldValue == compareValue;
    case 'notEquals':
      return fieldValue != compareValue;
    case 'gt':
      return Number(fieldValue) > Number(compareValue);
    case 'gte':
      return Number(fieldValue) >= Number(compareValue);
    case 'lt':
      return Number(fieldValue) < Number(compareValue);
    case 'lte':
      return Number(fieldValue) <= Number(compareValue);
    case 'contains':
      return String(fieldValue).includes(String(compareValue));
    case 'notContains':
      return !String(fieldValue).includes(String(compareValue));
    case 'startsWith':
      return String(fieldValue).startsWith(String(compareValue));
    case 'endsWith':
      return String(fieldValue).endsWith(String(compareValue));
    case 'isEmpty':
      return fieldValue == null || fieldValue === '' || (Array.isArray(fieldValue) && fieldValue.length === 0);
    case 'isNotEmpty':
      return fieldValue != null && fieldValue !== '' && !(Array.isArray(fieldValue) && fieldValue.length === 0);
    case 'exists':
      return fieldValue !== undefined;
    case 'notExists':
      return fieldValue === undefined;
    default:
      return false;
  }
}

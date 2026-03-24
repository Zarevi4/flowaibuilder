import type { WorkflowNode, NodeExecutionData, ExecutionStatus } from '@flowaibuilder/shared';
import type { NodeContext } from './context.js';

export interface BaseNodeHandler {
  execute(node: WorkflowNode, context: NodeContext): Promise<unknown>;
}

const nodeHandlers = new Map<string, BaseNodeHandler>();

export function registerNodeHandler(type: string, handler: BaseNodeHandler) {
  nodeHandlers.set(type, handler);
}

export function getNodeHandler(type: string): BaseNodeHandler | undefined {
  return nodeHandlers.get(type);
}

export async function runNode(
  node: WorkflowNode,
  context: NodeContext,
): Promise<NodeExecutionData> {
  const handler = getNodeHandler(node.type);
  if (!handler) {
    return {
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      status: 'error' as ExecutionStatus,
      error: `No handler registered for node type: ${node.type}`,
      input: context.$input.all(),
    };
  }

  const startedAt = new Date();
  try {
    const output = await handler.execute(node, context);
    const completedAt = new Date();
    return {
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      status: 'success',
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      duration: completedAt.getTime() - startedAt.getTime(),
      input: context.$input.all(),
      output,
    };
  } catch (err) {
    const completedAt = new Date();
    return {
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      status: 'error',
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      duration: completedAt.getTime() - startedAt.getTime(),
      input: context.$input.all(),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

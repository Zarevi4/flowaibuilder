/**
 * In-process fix dispatcher.
 *
 * Registers MCP tool handler functions by their full tool name
 * (e.g. 'flowaibuilder.update_node') so that `apply_fix` can invoke
 * the exact same handler body the MCP server already exposes — no
 * HTTP hop, no AI call, no duplicated logic.
 */

export type FixHandler = (
  params: Record<string, unknown>,
) => Promise<unknown>;

export class UnknownFixToolError extends Error {
  constructor(public readonly toolName: string) {
    super(`Unknown fix tool: ${toolName}`);
    this.name = 'UnknownFixToolError';
  }
}

const handlers = new Map<string, FixHandler>();

export function registerFixHandler(toolName: string, handler: FixHandler): void {
  handlers.set(toolName, handler);
}

export function hasFixHandler(toolName: string): boolean {
  return handlers.has(toolName);
}

export function clearFixHandlers(): void {
  handlers.clear();
}

export async function dispatchFix(
  toolName: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const handler = handlers.get(toolName);
  if (!handler) {
    throw new UnknownFixToolError(toolName);
  }
  return handler(params);
}

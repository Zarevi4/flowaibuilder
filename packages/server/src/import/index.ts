import { nanoid } from 'nanoid';
import type { WorkflowNode, Connection, N8nImportWarning } from '@flowaibuilder/shared';
import { mapN8nNode, type RawN8nNode } from './n8n-mapper.js';

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

export interface ImportedWorkflowDraft {
  name: string;
  description: string;
  nodes: WorkflowNode[];
  connections: Connection[];
}

export interface ImportN8nResult {
  workflow: ImportedWorkflowDraft;
  warnings: N8nImportWarning[];
}

interface N8nConnectionTarget {
  node: string;
  type?: string;
  index?: number;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export function importN8nWorkflow(
  json: unknown,
  opts: { name?: string; description?: string } = {},
): ImportN8nResult {
  if (!isObject(json) || !Array.isArray(json.nodes) || !isObject(json.connections)) {
    throw new ImportError(
      "Invalid n8n export: expected object with 'nodes' array and 'connections' object",
    );
  }

  const rawNodes = json.nodes as RawN8nNode[];
  const rawConnections = json.connections as Record<string, unknown>;

  const warnings: N8nImportWarning[] = [];
  const nameToId = new Map<string, string>();
  const nodes: WorkflowNode[] = [];

  for (const raw of rawNodes) {
    const mapped = mapN8nNode(raw);
    nodes.push(mapped.node);
    nameToId.set(mapped.originalName, mapped.node.id);
    if (mapped.warning) warnings.push(mapped.warning);
  }

  const connections: Connection[] = [];
  for (const [sourceName, sourceConn] of Object.entries(rawConnections)) {
    if (!isObject(sourceConn)) continue;
    const main = (sourceConn as { main?: unknown }).main;
    if (!Array.isArray(main)) continue;
    const sourceId = nameToId.get(sourceName);
    if (!sourceId) continue;

    main.forEach((outputGroup, outputIdx) => {
      if (!Array.isArray(outputGroup)) return;
      for (const target of outputGroup as N8nConnectionTarget[]) {
        if (!target || typeof target.node !== 'string') continue;
        const targetId = nameToId.get(target.node);
        if (!targetId) continue;
        const inputIdx = typeof target.index === 'number' ? target.index : 0;
        const conn: Connection = {
          id: nanoid(12),
          sourceNodeId: sourceId,
          targetNodeId: targetId,
        };
        if (outputIdx > 0) conn.sourceHandle = `out-${outputIdx}`;
        if (inputIdx > 0) conn.targetHandle = `in-${inputIdx}`;
        connections.push(conn);
      }
    });
  }

  const jsonName = typeof (json as { name?: unknown }).name === 'string'
    ? ((json as { name: string }).name)
    : undefined;

  const name = opts.name ?? jsonName ?? 'Imported from n8n';
  const description = opts.description ?? `Imported from n8n on ${new Date().toISOString()}`;

  return {
    workflow: { name, description, nodes, connections },
    warnings,
  };
}

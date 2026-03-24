import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { workflows } from '../db/schema.js';
import { workflowExecutor } from '../engine/executor.js';
import { getBroadcaster } from '../api/ws/broadcaster.js';
import type { Workflow, WorkflowNode, Connection } from '@flowaibuilder/shared';
import type { FastifyInstance } from 'fastify';

function toWorkflow(row: typeof workflows.$inferSelect): Workflow {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    nodes: (row.nodes ?? []) as WorkflowNode[],
    connections: (row.connections ?? []) as Connection[],
    active: row.active ?? false,
    version: row.version ?? 1,
    environment: row.environment ?? 'dev',
    canvas: (row.canvas ?? {}) as Record<string, unknown>,
    settings: (row.settings ?? {}) as Record<string, unknown>,
    tags: (row.tags ?? []) as string[],
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
    updatedAt: row.updatedAt?.toISOString() ?? new Date().toISOString(),
  };
}

export function createMcpServer() {
  const server = new McpServer({
    name: 'flowaibuilder',
    version: '0.1.0',
  });

  // ─── create_workflow ──────────────────────────────────────
  server.tool(
    'flowaibuilder.create_workflow',
    {
      name: z.string().describe('Workflow name'),
      description: z.string().optional().describe('Workflow description'),
    },
    async ({ name, description }) => {
      const [row] = await db.insert(workflows).values({
        name,
        description: description ?? '',
        createdBy: 'mcp:claude',
        updatedBy: 'mcp:claude',
      }).returning();

      getBroadcaster()?.broadcast('workflow_created', row.id, toWorkflow(row));

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            workflow_id: row.id,
            canvas_url: `http://localhost:5173/editor/${row.id}`,
          }),
        }],
      };
    },
  );

  // ─── add_node ─────────────────────────────────────────────
  server.tool(
    'flowaibuilder.add_node',
    {
      workflow_id: z.string().describe('Workflow ID'),
      type: z.string().describe('Node type (webhook, code-js, http-request, if, set, respond-webhook, manual)'),
      name: z.string().describe('Node display name'),
      config: z.record(z.unknown()).optional().describe('Node configuration'),
      connect_after: z.string().optional().describe('Node ID to connect after'),
    },
    async ({ workflow_id, type, name, config, connect_after }) => {
      const [wf] = await db.select().from(workflows).where(eq(workflows.id, workflow_id));
      if (!wf) throw new Error(`Workflow ${workflow_id} not found`);

      const nodes = (wf.nodes ?? []) as WorkflowNode[];
      const connections = (wf.connections ?? []) as Connection[];

      const lastNode = nodes[nodes.length - 1];
      const position = lastNode
        ? { x: lastNode.position.x, y: lastNode.position.y + 150 }
        : { x: 250, y: 100 };

      const newNode: WorkflowNode = {
        id: nanoid(12),
        type: type as WorkflowNode['type'],
        name,
        position,
        data: { label: name, config: config ?? {} },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      nodes.push(newNode);

      if (connect_after) {
        connections.push({
          id: nanoid(12),
          sourceNodeId: connect_after,
          targetNodeId: newNode.id,
        });
      }

      await db.update(workflows)
        .set({ nodes, connections, updatedAt: new Date() })
        .where(eq(workflows.id, workflow_id));

      getBroadcaster()?.broadcastToWorkflow(workflow_id, 'node_added', { node: newNode, position });

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ node_id: newNode.id, position }) }],
      };
    },
  );

  // ─── update_node ──────────────────────────────────────────
  server.tool(
    'flowaibuilder.update_node',
    {
      workflow_id: z.string(),
      node_id: z.string(),
      name: z.string().optional(),
      config: z.record(z.unknown()).optional(),
      disabled: z.boolean().optional(),
    },
    async ({ workflow_id, node_id, name, config, disabled }) => {
      const [wf] = await db.select().from(workflows).where(eq(workflows.id, workflow_id));
      if (!wf) throw new Error(`Workflow ${workflow_id} not found`);

      const nodes = (wf.nodes ?? []) as WorkflowNode[];
      const node = nodes.find(n => n.id === node_id);
      if (!node) throw new Error(`Node ${node_id} not found`);

      if (name !== undefined) { node.name = name; node.data.label = name; }
      if (config !== undefined) node.data.config = config;
      if (disabled !== undefined) node.disabled = disabled;
      node.updatedAt = new Date().toISOString();

      await db.update(workflows)
        .set({ nodes, updatedAt: new Date() })
        .where(eq(workflows.id, workflow_id));

      getBroadcaster()?.broadcastToWorkflow(workflow_id, 'node_updated', { node_id, name, config, disabled });

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ updated: true, node_id }) }],
      };
    },
  );

  // ─── remove_node ──────────────────────────────────────────
  server.tool(
    'flowaibuilder.remove_node',
    {
      workflow_id: z.string(),
      node_id: z.string(),
    },
    async ({ workflow_id, node_id }) => {
      const [wf] = await db.select().from(workflows).where(eq(workflows.id, workflow_id));
      if (!wf) throw new Error(`Workflow ${workflow_id} not found`);

      const nodes = ((wf.nodes ?? []) as WorkflowNode[]).filter(n => n.id !== node_id);
      const connections = ((wf.connections ?? []) as Connection[]).filter(
        c => c.sourceNodeId !== node_id && c.targetNodeId !== node_id,
      );

      await db.update(workflows)
        .set({ nodes, connections, updatedAt: new Date() })
        .where(eq(workflows.id, workflow_id));

      getBroadcaster()?.broadcastToWorkflow(workflow_id, 'node_removed', { node_id });

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ removed: true, node_id }) }],
      };
    },
  );

  // ─── connect_nodes ────────────────────────────────────────
  server.tool(
    'flowaibuilder.connect_nodes',
    {
      workflow_id: z.string(),
      source_node_id: z.string(),
      target_node_id: z.string(),
      source_handle: z.string().optional(),
      target_handle: z.string().optional(),
    },
    async ({ workflow_id, source_node_id, target_node_id, source_handle, target_handle }) => {
      const [wf] = await db.select().from(workflows).where(eq(workflows.id, workflow_id));
      if (!wf) throw new Error(`Workflow ${workflow_id} not found`);

      const connections = (wf.connections ?? []) as Connection[];
      const newConnection: Connection = {
        id: nanoid(12),
        sourceNodeId: source_node_id,
        targetNodeId: target_node_id,
        sourceHandle: source_handle,
        targetHandle: target_handle,
      };
      connections.push(newConnection);

      await db.update(workflows)
        .set({ connections, updatedAt: new Date() })
        .where(eq(workflows.id, workflow_id));

      getBroadcaster()?.broadcastToWorkflow(workflow_id, 'connection_added', { connection: newConnection });

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ connection_id: newConnection.id }) }],
      };
    },
  );

  // ─── get_workflow ─────────────────────────────────────────
  server.tool(
    'flowaibuilder.get_workflow',
    {
      workflow_id: z.string(),
    },
    async ({ workflow_id }) => {
      const [wf] = await db.select().from(workflows).where(eq(workflows.id, workflow_id));
      if (!wf) throw new Error(`Workflow ${workflow_id} not found`);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(toWorkflow(wf), null, 2) }],
      };
    },
  );

  // ─── list_workflows ───────────────────────────────────────
  server.tool(
    'flowaibuilder.list_workflows',
    {},
    async () => {
      const rows = await db.select().from(workflows);
      const list = rows.map(r => ({
        id: r.id,
        name: r.name,
        active: r.active,
        version: r.version,
        nodeCount: ((r.nodes ?? []) as unknown[]).length,
        updatedAt: r.updatedAt?.toISOString(),
      }));

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ workflows: list }, null, 2) }],
      };
    },
  );

  // ─── execute_workflow ─────────────────────────────────────
  server.tool(
    'flowaibuilder.execute_workflow',
    {
      workflow_id: z.string(),
      input_data: z.unknown().optional().describe('Input data for trigger node'),
    },
    async ({ workflow_id, input_data }) => {
      const [wf] = await db.select().from(workflows).where(eq(workflows.id, workflow_id));
      if (!wf) throw new Error(`Workflow ${workflow_id} not found`);

      const workflow = toWorkflow(wf);
      const execution = await workflowExecutor.execute(workflow, input_data, 'mcp', 'mcp:claude');

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            execution_id: execution.id,
            status: execution.status,
            duration_ms: execution.durationMs,
            node_results: execution.nodeExecutions.map(ne => ({
              node: ne.nodeName,
              status: ne.status,
              output: ne.output,
              error: ne.error,
            })),
          }, null, 2),
        }],
      };
    },
  );

  return server;
}

/**
 * Start MCP server with stdio transport (for Claude Code local).
 */
export async function startStdioTransport(server: McpServer) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/**
 * Register SSE transport endpoints on Fastify (for remote access).
 */
export function registerSseTransport(app: FastifyInstance, server: McpServer) {
  const transports = new Map<string, SSEServerTransport>();

  app.get('/mcp/sse', async (request, reply) => {
    const transport = new SSEServerTransport('/mcp/messages', reply.raw);
    transports.set(transport.sessionId, transport);
    reply.raw.on('close', () => { transports.delete(transport.sessionId); });
    await server.connect(transport);
  });

  app.post('/mcp/messages', async (request, reply) => {
    const sessionId = request.query && typeof request.query === 'object' && 'sessionId' in request.query
      ? String((request.query as Record<string, unknown>).sessionId)
      : '';
    const transport = transports.get(sessionId);
    if (!transport) {
      return reply.code(404).send({ error: 'Session not found' });
    }
    await transport.handlePostMessage(request.body as Record<string, unknown>);
    return reply.code(200).send();
  });
}

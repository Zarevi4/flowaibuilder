import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { workflows, executions } from '../db/schema.js';
import { workflowExecutor } from '../engine/executor.js';
import { getBroadcaster } from '../api/ws/broadcaster.js';
import type { Workflow, WorkflowNode, Connection } from '@flowaibuilder/shared';
import type { FastifyInstance } from 'fastify';
import { registerAgentTeamTools } from './tools/agent-teams.js';
import { registerReviewTools } from './tools/review.js';
import { registerZoneTools } from './tools/zones.js';
import { registerExportTools } from './tools/export.js';
import { registerImportTools } from './tools/import.js';
import { registerValidateTools } from './tools/validate.js';
import { registerAuditTools } from './tools/audit.js';
import { registerVersioningTools } from './tools/versioning.js';
import { registerSecretsTools } from './tools/secrets.js';
import { registerQueueTools } from './tools/queue.js';
import { recordSnapshot } from '../versioning/store.js';
import { redactSecrets } from '../audit/logger.js';
import { assertNodeNotPinned, assertConnectionEndpointsNotPinned, getPinnedNodeIds, buildZoneError } from '../zones/enforcer.js';
import { registerFixHandler } from '../review/fix-dispatcher.js';
import { maybeEmitAutoReview } from '../review/triggers.js';
import { assertMcpPermitted, minRoleForMcpTool, MCP_STDIO_USER } from './rbac.js';
import type { AuthUser } from '@flowaibuilder/shared';

/**
 * Per-invocation context threaded through the wrapTool wrapper. The stdio
 * transport is local Claude Code (already inside the user's security
 * boundary) and uses MCP_STDIO_USER as effective admin. The SSE transport
 * attaches the authenticated user at handshake time; tool invocations
 * consult `currentMcpUser` via a per-request AsyncLocalStorage-like global
 * we set synchronously around each handlePostMessage call.
 */
let activeMcpUser: AuthUser | null = null;
let activeMcpTransport: 'stdio' | 'sse' = 'stdio';
let mcpApp: FastifyInstance | undefined;

export function mcpActor(): string {
  return activeMcpUser?.email ?? 'mcp:claude-code';
}

export function getActiveMcpContext(): { user: AuthUser | null; transport: 'stdio' | 'sse' } {
  return { user: activeMcpUser, transport: activeMcpTransport };
}

export function setActiveMcpContext(user: AuthUser | null, transport: 'stdio' | 'sse') {
  activeMcpUser = user;
  activeMcpTransport = transport;
}

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

// ─── Extracted MCP mutation handlers ─────────────────────
// These are exported as module-level functions so that both the
// MCP `server.tool` callbacks AND the in-process fix-dispatcher
// (Story 2.2 `apply_fix`) can share the exact same implementation.

type TextResult = { content: [{ type: 'text'; text: string }] };

function text(obj: unknown): TextResult {
  return { content: [{ type: 'text' as const, text: JSON.stringify(obj) }] };
}

export async function handleAddNode(
  params: Record<string, unknown>,
): Promise<TextResult> {
  const workflow_id = params.workflow_id as string;
  const type = params.type as string;
  const name = params.name as string;
  const config = params.config as Record<string, unknown> | undefined;
  const connect_after = params.connect_after as string | undefined;

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

  await db
    .update(workflows)
    .set({ nodes, connections, updatedAt: new Date() })
    .where(eq(workflows.id, workflow_id));

  getBroadcaster()?.broadcastToWorkflow(workflow_id, 'node_added', { node: newNode, position });
  await recordSnapshot(workflow_id, { actor: mcpActor(), message: 'mcp:add_node', app: mcpApp }).catch((err) => mcpApp?.log?.warn({ err }, 'mcp recordSnapshot/broadcast failure'));
  await maybeEmitAutoReview(workflow_id).catch(() => undefined);

  return text({ node_id: newNode.id, position });
}

export async function handleUpdateNode(
  params: Record<string, unknown>,
): Promise<TextResult> {
  const workflow_id = params.workflow_id as string;
  const node_id = params.node_id as string;
  const name = params.name as string | undefined;
  const config = params.config as Record<string, unknown> | undefined;
  const disabled = params.disabled as boolean | undefined;

  const [wf] = await db.select().from(workflows).where(eq(workflows.id, workflow_id));
  if (!wf) throw new Error(`Workflow ${workflow_id} not found`);

  const nodes = (wf.nodes ?? []) as WorkflowNode[];
  const node = nodes.find(n => n.id === node_id);
  if (!node) throw new Error(`Node ${node_id} not found`);

  await assertNodeNotPinned(workflow_id, node_id, 'update');

  if (name !== undefined) {
    node.name = name;
    node.data.label = name;
  }
  if (config !== undefined) node.data.config = { ...(node.data.config ?? {}), ...config };
  if (disabled !== undefined) node.disabled = disabled;
  node.updatedAt = new Date().toISOString();

  await db
    .update(workflows)
    .set({ nodes, updatedAt: new Date() })
    .where(eq(workflows.id, workflow_id));

  getBroadcaster()?.broadcastToWorkflow(workflow_id, 'node_updated', {
    node_id,
    name,
    config,
    disabled,
  });
  await recordSnapshot(workflow_id, { actor: mcpActor(), message: 'mcp:update_node', app: mcpApp }).catch((err) => mcpApp?.log?.warn({ err }, 'mcp recordSnapshot/broadcast failure'));
  await maybeEmitAutoReview(workflow_id).catch(() => undefined);

  return text({ updated: true, node_id });
}

export async function handleRemoveNode(
  params: Record<string, unknown>,
): Promise<TextResult> {
  const workflow_id = params.workflow_id as string;
  const node_id = params.node_id as string;

  const [wf] = await db.select().from(workflows).where(eq(workflows.id, workflow_id));
  if (!wf) throw new Error(`Workflow ${workflow_id} not found`);

  await assertNodeNotPinned(workflow_id, node_id, 'remove');

  const nodes = ((wf.nodes ?? []) as WorkflowNode[]).filter(n => n.id !== node_id);
  const connections = ((wf.connections ?? []) as Connection[]).filter(
    c => c.sourceNodeId !== node_id && c.targetNodeId !== node_id,
  );

  await db
    .update(workflows)
    .set({ nodes, connections, updatedAt: new Date() })
    .where(eq(workflows.id, workflow_id));

  getBroadcaster()?.broadcastToWorkflow(workflow_id, 'node_removed', { node_id });
  await recordSnapshot(workflow_id, { actor: mcpActor(), message: 'mcp:remove_node', app: mcpApp }).catch((err) => mcpApp?.log?.warn({ err }, 'mcp recordSnapshot/broadcast failure'));
  await maybeEmitAutoReview(workflow_id).catch(() => undefined);

  return text({ removed: true, node_id });
}

export async function handleConnectNodes(
  params: Record<string, unknown>,
): Promise<TextResult> {
  const workflow_id = params.workflow_id as string;
  const source_node_id = params.source_node_id as string;
  const target_node_id = params.target_node_id as string;
  const source_handle = params.source_handle as string | undefined;
  const target_handle = params.target_handle as string | undefined;

  const [wf] = await db.select().from(workflows).where(eq(workflows.id, workflow_id));
  if (!wf) throw new Error(`Workflow ${workflow_id} not found`);

  // Zone enforcement: adding a connection that touches a pinned node is a
  // protected-graph mutation per the CLAUDE.md invariant. Mirrors the check
  // already present in handleDisconnectNodes.
  await assertConnectionEndpointsNotPinned(workflow_id, {
    sourceNodeId: source_node_id,
    targetNodeId: target_node_id,
  });

  const connections = (wf.connections ?? []) as Connection[];
  const newConnection: Connection = {
    id: nanoid(12),
    sourceNodeId: source_node_id,
    targetNodeId: target_node_id,
    sourceHandle: source_handle,
    targetHandle: target_handle,
  };
  connections.push(newConnection);

  await db
    .update(workflows)
    .set({ connections, updatedAt: new Date() })
    .where(eq(workflows.id, workflow_id));

  getBroadcaster()?.broadcastToWorkflow(workflow_id, 'connection_added', { connection: newConnection });
  await recordSnapshot(workflow_id, { actor: mcpActor(), message: 'mcp:connect_nodes', app: mcpApp })
    .catch((err) => mcpApp?.log?.warn({ err, workflow_id }, 'recordSnapshot failed in handleConnectNodes'));
  await maybeEmitAutoReview(workflow_id).catch(() => undefined);

  return text({ connection_id: newConnection.id });
}

export async function handleDisconnectNodes(
  params: Record<string, unknown>,
): Promise<TextResult> {
  const workflow_id = params.workflow_id as string;
  const connection_id = params.connection_id as string | undefined;
  const source_node_id = params.source_node_id as string | undefined;
  const target_node_id = params.target_node_id as string | undefined;

  const [wf] = await db.select().from(workflows).where(eq(workflows.id, workflow_id));
  if (!wf) throw new Error(`Workflow ${workflow_id} not found`);

  const original = (wf.connections ?? []) as Connection[];
  let toRemove: Connection[];

  if (connection_id) {
    toRemove = original.filter(c => c.id === connection_id);
  } else if (source_node_id && target_node_id) {
    toRemove = original.filter(
      c => c.sourceNodeId === source_node_id && c.targetNodeId === target_node_id,
    );
  } else {
    throw new Error('Provide either connection_id or both source_node_id and target_node_id');
  }

  if (toRemove.length === 0) {
    return text({ disconnected: false, removedCount: 0 });
  }

  // Hoist a single SELECT for all connections in this batch (avoids N+1).
  const pinned = await getPinnedNodeIds(workflow_id);
  for (const conn of toRemove) {
    const src = pinned.get(conn.sourceNodeId);
    if (src) throw buildZoneError('disconnect', conn.sourceNodeId, src.zoneName);
    const tgt = pinned.get(conn.targetNodeId);
    if (tgt) throw buildZoneError('disconnect', conn.targetNodeId, tgt.zoneName);
  }

  const removedIds = new Set(toRemove.map(c => c.id));
  const connections = original.filter(c => !removedIds.has(c.id));
  const removedCount = toRemove.length;

  await db
    .update(workflows)
    .set({ connections, updatedAt: new Date() })
    .where(eq(workflows.id, workflow_id));

  getBroadcaster()?.broadcastToWorkflow(workflow_id, 'connection_removed', {
    connection_id,
    source_node_id,
    target_node_id,
  });
  await recordSnapshot(workflow_id, { actor: mcpActor(), message: 'mcp:disconnect_nodes', app: mcpApp }).catch((err) => mcpApp?.log?.warn({ err }, 'mcp recordSnapshot/broadcast failure'));
  await maybeEmitAutoReview(workflow_id).catch(() => undefined);

  return text({ disconnected: true, removedCount });
}

export function createMcpServer(app?: FastifyInstance) {
  mcpApp = app;
  const server = new McpServer({
    name: 'flowaibuilder',
    version: '0.1.0',
  });

  // ─── wrapTool: auto-audit every successful MCP tool invocation ───────
  // Override server.tool to wrap handlers with audit logging. Skips the
  // audit tools themselves to avoid recursion. Only logs on SUCCESS.
  const originalTool = server.tool.bind(server) as unknown as (
    ...args: unknown[]
  ) => unknown;
  (server as unknown as { tool: typeof originalTool }).tool = ((...args: unknown[]) => {
    // Supported overloads: (name, schema, handler) and (name, handler)
    const name = args[0] as string;
    const handler = (args.length >= 3 ? args[2] : args[1]) as (
      input: Record<string, unknown>,
      extra?: unknown,
    ) => Promise<unknown>;

    const wrapped = async (input: Record<string, unknown>, extra?: unknown) => {
      // RBAC enforcement (Story 5.2 AC #6, Task 5.3). Stdio bypasses via
      // MCP_STDIO_USER (effective admin); SSE requires the handshake-bound
      // user to meet the tool's minimum role.
      const minRole = minRoleForMcpTool(name);
      assertMcpPermitted(name, minRole, {
        user: activeMcpTransport === 'stdio' ? MCP_STDIO_USER : activeMcpUser ?? undefined,
        transport: activeMcpTransport,
      });
      const result = await handler(input, extra);
      // Skip tools that handle their own audit writes or could leak secrets in args.
      if (
        name === 'flowaibuilder.get_audit_log' ||
        name === 'flowaibuilder.get_execution_log' ||
        name === 'flowaibuilder.manage_secrets'
      ) {
        return result;
      }
      const args_ = (input ?? {}) as Record<string, unknown>;
      const resourceType =
        typeof args_.workflow_id === 'string'
          ? 'workflow'
          : typeof args_.execution_id === 'string'
            ? 'execution'
            : typeof args_.node_id === 'string'
              ? 'node'
              : undefined;
      const resourceId =
        (args_.workflow_id as string | undefined) ??
        (args_.execution_id as string | undefined) ??
        (args_.node_id as string | undefined);
      await app?.audit
        ?.write({
          actor: mcpActor(),
          action: name,
          resourceType: resourceType ?? null,
          resourceId: resourceId ?? null,
          metadata: { mcp_tool: name, args: redactSecrets(args_), transport: activeMcpTransport },
        })
        .catch((err) => app?.log?.warn({ err, tool: name }, 'mcp audit write failed'));
      return result;
    };

    if (args.length >= 3) {
      return originalTool(args[0], args[1], wrapped);
    }
    return originalTool(args[0], wrapped);
  }) as typeof originalTool;

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
      await recordSnapshot(row.id, { actor: mcpActor(), message: 'initial', app: mcpApp }).catch((err) => mcpApp?.log?.warn({ err }, 'mcp recordSnapshot/broadcast failure'));

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
    async (params) => handleAddNode(params as Record<string, unknown>),
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
    async (params) => handleUpdateNode(params as Record<string, unknown>),
  );

  // ─── remove_node ──────────────────────────────────────────
  server.tool(
    'flowaibuilder.remove_node',
    {
      workflow_id: z.string(),
      node_id: z.string(),
    },
    async (params) => handleRemoveNode(params as Record<string, unknown>),
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
    async (params) => handleConnectNodes(params as Record<string, unknown>),
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

      const { isQueueMode, enqueueExecution } = await import('../queue/manager.js');

      if (isQueueMode()) {
        // Queue mode: create execution as 'queued', enqueue job
        const [execRecord] = await db
          .insert(executions)
          .values({
            workflowId: wf.id,
            workflowVersion: wf.version ?? 1,
            status: 'queued',
            mode: 'mcp',
            triggeredBy: mcpActor(),
            triggerData: input_data ?? null,
            startedAt: new Date(),
          })
          .returning();

        await enqueueExecution({
          workflowId: wf.id,
          executionId: execRecord.id,
          triggerData: input_data,
          mode: 'mcp',
          triggeredBy: mcpActor(),
        });

        getBroadcaster()?.broadcastToWorkflow(wf.id, 'execution_queued', {
          execution_id: execRecord.id,
          workflow_id: wf.id,
        });

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              execution_id: execRecord.id,
              status: 'queued',
              workflow_id: wf.id,
            }, null, 2),
          }],
        };
      }

      // Inline mode (default)
      const workflow = toWorkflow(wf);
      const execution = await workflowExecutor.execute(workflow, input_data, 'mcp', mcpActor());

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

  // ─── delete_workflow ─────────────────────────────────────
  server.tool(
    'flowaibuilder.delete_workflow',
    {
      workflow_id: z.string().describe('Workflow ID to delete'),
    },
    async ({ workflow_id }) => {
      const [deleted] = await db.delete(workflows).where(eq(workflows.id, workflow_id)).returning();
      if (!deleted) throw new Error(`Workflow ${workflow_id} not found`);

      getBroadcaster()?.broadcast('workflow_deleted', workflow_id, { id: workflow_id });

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ deleted: true, id: workflow_id }) }],
      };
    },
  );

  // ─── disconnect_nodes ──────────────────────────────────
  server.tool(
    'flowaibuilder.disconnect_nodes',
    {
      workflow_id: z.string(),
      connection_id: z.string().optional().describe('Connection ID to remove'),
      source_node_id: z.string().optional().describe('Source node ID (alternative to connection_id)'),
      target_node_id: z.string().optional().describe('Target node ID (alternative to connection_id)'),
    },
    async (params) => handleDisconnectNodes(params as Record<string, unknown>),
  );

  // ─── get_execution ─────────────────────────────────────
  server.tool(
    'flowaibuilder.get_execution',
    {
      execution_id: z.string().describe('Execution ID'),
    },
    async ({ execution_id }) => {
      const [exec] = await db.select().from(executions).where(eq(executions.id, execution_id));
      if (!exec) throw new Error(`Execution ${execution_id} not found`);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            id: exec.id,
            workflowId: exec.workflowId,
            status: exec.status,
            mode: exec.mode,
            triggerData: exec.triggerData,
            resultData: exec.resultData,
            nodeExecutions: exec.nodeExecutions,
            error: exec.error,
            triggeredBy: exec.triggeredBy,
            startedAt: exec.startedAt?.toISOString(),
            finishedAt: exec.finishedAt?.toISOString(),
            durationMs: exec.durationMs,
          }, null, 2),
        }],
      };
    },
  );

  // ─── list_executions ───────────────────────────────────
  server.tool(
    'flowaibuilder.list_executions',
    {
      workflow_id: z.string().optional().describe('Filter by workflow ID'),
      limit: z.number().int().min(1).max(100).optional().describe('Max results (default 20, max 100)'),
    },
    async ({ workflow_id, limit }) => {
      const maxResults = limit ?? 20;

      const rows = workflow_id
        ? await db.select().from(executions)
            .where(eq(executions.workflowId, workflow_id))
            .orderBy(desc(executions.startedAt))
            .limit(maxResults)
        : await db.select().from(executions)
            .orderBy(desc(executions.startedAt))
            .limit(maxResults);
      const list = rows.map(r => ({
        id: r.id,
        workflowId: r.workflowId,
        status: r.status,
        mode: r.mode,
        triggeredBy: r.triggeredBy,
        startedAt: r.startedAt?.toISOString(),
        finishedAt: r.finishedAt?.toISOString(),
        durationMs: r.durationMs,
      }));

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ executions: list }, null, 2) }],
      };
    },
  );

  // Agent Teams tools (extracted to separate file)
  registerAgentTeamTools(server);

  // Protected Zones tools
  registerZoneTools(server);

  // Export tools (Story 4.1)
  registerExportTools(server);

  // Import + Validate tools (Story 4.2)
  registerImportTools(server);
  registerValidateTools(server);

  // Register fix handlers BEFORE review tools — `apply_fix` relies on them.
  registerFixHandler('flowaibuilder.add_node', handleAddNode);
  registerFixHandler('flowaibuilder.update_node', handleUpdateNode);
  registerFixHandler('flowaibuilder.remove_node', handleRemoveNode);
  registerFixHandler('flowaibuilder.connect_nodes', handleConnectNodes);
  registerFixHandler('flowaibuilder.disconnect_nodes', handleDisconnectNodes);

  // Review tools (get_review_context, save_annotations, get_annotations, dismiss_annotation, apply_fix, get_health_score)
  registerReviewTools(server);

  // Audit tools (Story 5.1)
  registerAuditTools(server, app);

  // Versioning + Git tools (Story 5.3)
  registerVersioningTools(server, app);

  // Secrets + Environment tools (Story 5.4)
  registerSecretsTools(server, app);

  // Queue + Log streaming tools (Story 5.5)
  registerQueueTools(server, app);

  return server;
}

/**
 * Start MCP server with stdio transport (for Claude Code local).
 */
export async function startStdioTransport(server: McpServer) {
  // Stdio is local-trusted — set the active MCP context once so every
  // tool invocation through this process is treated as effective admin.
  setActiveMcpContext(MCP_STDIO_USER, 'stdio');
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/**
 * Register SSE transport endpoints on Fastify (for remote access).
 *
 * Handshake (`GET /mcp/sse`) is authenticated — the auth middleware has
 * already populated `request.user`. We bind that user to the SSE session
 * and reject `/mcp/messages` POSTs whose authenticated user does not match
 * the handshake user (prevents session fixation / cross-user injection).
 */
export function registerSseTransport(app: FastifyInstance, server: McpServer) {
  const transports = new Map<string, { transport: SSEServerTransport; user: AuthUser }>();

  app.get('/mcp/sse', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    const sessionUser = request.user;
    const transport = new SSEServerTransport('/mcp/messages', reply.raw);
    transports.set(transport.sessionId, { transport, user: sessionUser });
    reply.raw.on('close', () => { transports.delete(transport.sessionId); });
    await server.connect(transport);
  });

  app.post('/mcp/messages', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    const sessionId = request.query && typeof request.query === 'object' && 'sessionId' in request.query
      ? String((request.query as Record<string, unknown>).sessionId)
      : '';
    const entry = transports.get(sessionId);
    if (!entry) {
      return reply.code(404).send({ error: 'Session not found' });
    }
    // Bind: the user posting this message MUST be the same user that
    // opened the SSE handshake. Otherwise an authenticated attacker could
    // hijack another user's sessionId.
    if (entry.user.id !== request.user.id) {
      return reply.code(403).send({ error: 'session_user_mismatch' });
    }
    // Set the active MCP context for the duration of the handled message
    // so wrapTool's RBAC check sees the handshake user. This is racy under
    // true parallel SSE traffic but MCP messages are serialized per-session.
    setActiveMcpContext(entry.user, 'sse');
    try {
      await entry.transport.handlePostMessage(
        request.raw,
        reply.raw,
        request.body as Record<string, unknown>,
      );
    } finally {
      setActiveMcpContext(null, 'sse');
    }
    return;
  });
}

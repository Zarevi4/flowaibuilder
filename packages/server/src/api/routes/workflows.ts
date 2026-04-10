import type { FastifyInstance, FastifyReply } from 'fastify';
import { eq, desc, and, isNotNull, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { workflows, executions, taskNodeLinks, workflowVersions, instanceSettings } from '../../db/schema.js';
import {
  recordSnapshot,
  listVersions,
  getVersion,
  revertToVersion,
} from '../../versioning/store.js';
import { diffSnapshots, shouldVersion } from '../../versioning/diff.js';
import { pushWorkflow, defaultRepoPath, type ResolvedGitConfig } from '../../versioning/git.js';
import { decrypt } from '../../crypto/aes.js';
import type { Workflow, WorkflowNode, Connection, Execution, ExecutionStatus, ExecutionMode, NodeExecutionData } from '@flowaibuilder/shared';
import { nanoid } from 'nanoid';
import { getBroadcaster } from '../ws/broadcaster.js';
import { getTeamWatcher } from '../../agent-teams/index.js';
import { maybeEmitAutoReview } from '../../review/triggers.js';
import { annotationStore } from '../../review/store.js';
import {
  assertNodeNotPinned,
  assertConnectionEndpointsNotPinned,
} from '../../zones/enforcer.js';
import { compileWorkflow, ExportError, EXPORT_FORMATS } from '../../export/index.js';
import { importN8nWorkflow, ImportError } from '../../import/index.js';
import { validateWorkflow } from '../../validation/index.js';
import type { ExportFormat } from '@flowaibuilder/shared';
import {
  createZoneCore,
  deleteZoneCore,
  updateZoneCore,
  addToZoneCore,
  removeFromZoneCore,
  getZonesCore,
  ZoneServiceError,
} from '../../zones/service.js';

export function toWorkflow(row: typeof workflows.$inferSelect): Workflow {
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

/**
 * Fetch a single workflow by ID. Used by both REST routes and the WS broadcaster.
 */
export async function getWorkflowById(id: string): Promise<Workflow | null> {
  const [row] = await db.select().from(workflows).where(eq(workflows.id, id));
  return row ? toWorkflow(row) : null;
}

function toExecution(row: typeof executions.$inferSelect): Execution {
  return {
    id: row.id,
    workflowId: row.workflowId,
    workflowVersion: row.workflowVersion ?? undefined,
    status: row.status as ExecutionStatus,
    mode: row.mode as ExecutionMode,
    triggerData: row.triggerData ?? undefined,
    resultData: row.resultData ?? undefined,
    nodeExecutions: (row.nodeExecutions ?? []) as NodeExecutionData[],
    error: row.error ?? undefined,
    triggeredBy: row.triggeredBy,
    startedAt: row.startedAt?.toISOString() ?? new Date().toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? undefined,
    durationMs: row.durationMs ?? undefined,
  };
}

/** Log-and-swallow helper for recordSnapshot side effects. The mutation has
 *  already committed by the time we reach the snapshot hook, so we cannot
 *  realistically roll the user's write back — but we MUST NOT hide the
 *  failure the way `.catch(() => undefined)` did. */
function logSnapshotFailure(app: FastifyInstance, workflowId: string) {
  return (err: unknown) => {
    app.log.error(
      { err, workflowId },
      'recordSnapshot failed — workflow mutation persisted without a version row',
    );
  };
}

/** Strip anything URL- or token-shaped from a git error message before
 *  returning it to the client. Git errors from isomorphic-git can echo the
 *  remote URL including basic-auth credentials. */
function sanitizeGitError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/https?:\/\/[^\s]+/gi, '[redacted-url]')
    .replace(/(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, '[redacted-token]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]');
}

export async function workflowRoutes(app: FastifyInstance) {
  // List workflows
  app.get('/api/workflows', async () => {
    const rows = await db.select().from(workflows);
    return { workflows: rows.map(toWorkflow) };
  });

  // Get workflow by ID
  app.get<{ Params: { id: string } }>('/api/workflows/:id', async (request, reply) => {
    const [row] = await db.select().from(workflows).where(eq(workflows.id, request.params.id));
    if (!row) return reply.code(404).send({ error: 'Workflow not found' });
    return toWorkflow(row);
  });

  // Create workflow
  app.post<{ Body: { name: string; description?: string } }>('/api/workflows', async (request) => {
    const { name, description } = request.body;
    const actor = request.user?.email ?? 'api';
    const [row] = await db.insert(workflows).values({
      name,
      description: description ?? '',
      createdBy: actor,
      updatedBy: actor,
    }).returning();
    await recordSnapshot(row.id, { actor, message: 'initial', app }).catch(logSnapshotFailure(app, row.id));
    return toWorkflow(row);
  });

  // Update workflow
  app.put<{ Params: { id: string }; Body: Partial<Workflow> }>('/api/workflows/:id', async (request, reply) => {
    const { id } = request.params;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    const body = request.body;
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.nodes !== undefined) updates.nodes = body.nodes;
    if (body.connections !== undefined) updates.connections = body.connections;
    if (body.active !== undefined) updates.active = body.active;
    if (body.settings !== undefined) updates.settings = body.settings;
    if (body.tags !== undefined) updates.tags = body.tags;
    if ((body as Record<string, unknown>).environment !== undefined) {
      const env = (body as Record<string, unknown>).environment as string;
      const validEnvs = ['dev', 'staging', 'prod'];
      if (!validEnvs.includes(env)) {
        return reply.code(400).send({ error: `environment must be one of: ${validEnvs.join(', ')}` });
      }
      updates.environment = env;
    }

    const [beforeRow] = await db.select().from(workflows).where(eq(workflows.id, id));
    if (!beforeRow) return reply.code(404).send({ error: 'Workflow not found' });
    // Deep-clone so Drizzle row-caching cannot alias `before` to the updated
    // row under our feet — shouldVersion must see the pre-update shape.
    const before = JSON.parse(JSON.stringify(beforeRow));
    const [row] = await db.update(workflows).set(updates).where(eq(workflows.id, id)).returning();
    if (!row) return reply.code(404).send({ error: 'Workflow not found' });
    if (shouldVersion(before, row)) {
      await recordSnapshot(id, {
        actor: request.user?.email ?? 'api',
        message: 'update',
        app,
      }).catch(logSnapshotFailure(app, id));
    }
    await maybeEmitAutoReview(id).catch(() => undefined);
    return toWorkflow(row);
  });

  // Delete workflow
  app.delete<{ Params: { id: string } }>('/api/workflows/:id', async (request, reply) => {
    const [row] = await db.delete(workflows).where(eq(workflows.id, request.params.id)).returning();
    if (!row) return reply.code(404).send({ error: 'Workflow not found' });
    return { deleted: true, id: row.id };
  });

  // Duplicate workflow
  app.post<{ Params: { id: string } }>('/api/workflows/:id/duplicate', async (request, reply) => {
    const [original] = await db.select().from(workflows).where(eq(workflows.id, request.params.id));
    if (!original) return reply.code(404).send({ error: 'Workflow not found' });

    const [row] = await db.insert(workflows).values({
      name: `${original.name} (copy)`,
      description: original.description ?? '',
      nodes: original.nodes,
      connections: original.connections,
      settings: original.settings,
      tags: original.tags,
      createdBy: 'api',
      updatedBy: 'api',
    }).returning();

    getBroadcaster()?.broadcast('workflow_created', row.id, toWorkflow(row));
    await recordSnapshot(row.id, {
      actor: request.user?.email ?? 'api',
      message: 'duplicate',
      app,
    }).catch(logSnapshotFailure(app, row.id));

    return toWorkflow(row);
  });

  // Activate workflow with pre-deploy review gate (Story 2.4 AC#4)
  app.post<{ Params: { id: string }; Body: { force?: boolean } }>(
    '/api/workflows/:id/activate',
    async (request, reply) => {
      const { id } = request.params;
      const force = request.body?.force === true;

      const [wf] = await db.select().from(workflows).where(eq(workflows.id, id));
      if (!wf) return reply.code(404).send({ error: 'Workflow not found' });

      // Always emit pre-deploy review request (fire-and-forget signal)
      getBroadcaster()?.broadcast('review_requested', id, {
        workflow_id: id,
        trigger: 'pre-deploy',
        context_type: 'pre-deploy',
        requested_at: new Date().toISOString(),
      });

      const latest = await annotationStore.getLatestReview(id);
      const healthScore: number | null = latest?.healthScore ?? null;

      if (healthScore !== null && healthScore < 50 && !force) {
        return {
          healthScore,
          requiresConfirmation: true,
          warning: 'Health score is below 50. Activating may deploy a workflow with critical issues.',
          activated: false,
        };
      }

      const [updated] = await db
        .update(workflows)
        .set({ active: true, updatedAt: new Date() })
        .where(eq(workflows.id, id))
        .returning();
      getBroadcaster()?.broadcast('workflow_updated', id, toWorkflow(updated));
      if (!wf.active) {
        await recordSnapshot(id, {
          actor: request.user?.email ?? 'api',
          message: 'activate',
          app,
        }).catch(logSnapshotFailure(app, id));
      }

      return {
        healthScore,
        requiresConfirmation: false,
        warning: null,
        activated: true,
      };
    },
  );

  // Add node to workflow
  app.post<{ Params: { id: string }; Body: { type: string; name: string; config?: Record<string, unknown>; connectAfter?: string } }>(
    '/api/workflows/:id/nodes',
    async (request, reply) => {
      const { id } = request.params;
      const { type, name, config, connectAfter } = request.body;

      const [wf] = await db.select().from(workflows).where(eq(workflows.id, id));
      if (!wf) return reply.code(404).send({ error: 'Workflow not found' });

      const nodes = (wf.nodes ?? []) as WorkflowNode[];
      const connections = (wf.connections ?? []) as Connection[];

      // Auto-position: place below the last node or to the right
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

      // Auto-connect if requested
      if (connectAfter) {
        connections.push({
          id: nanoid(12),
          sourceNodeId: connectAfter,
          targetNodeId: newNode.id,
        });
      }

      await db.update(workflows).set({ nodes, connections, updatedAt: new Date() }).where(eq(workflows.id, id));

      getBroadcaster()?.broadcastToWorkflow(id, 'node_added', { node: newNode, position });
      await recordSnapshot(id, {
        actor: request.user?.email ?? 'api',
        message: `add_node:${type}`,
        app,
      }).catch(logSnapshotFailure(app, id));
      await maybeEmitAutoReview(id).catch(() => undefined);

      return { node: newNode, position };
    },
  );

  // Patch a single node's config/name/disabled
  app.patch<{ Params: { id: string; nodeId: string }; Body: { name?: string; config?: Record<string, unknown>; disabled?: boolean } }>(
    '/api/workflows/:id/nodes/:nodeId',
    async (request, reply) => {
      const { id, nodeId } = request.params;
      const { name, config, disabled } = request.body;

      const [wf] = await db.select().from(workflows).where(eq(workflows.id, id));
      if (!wf) return reply.code(404).send({ error: 'Workflow not found' });

      const nodes = (wf.nodes ?? []) as WorkflowNode[];
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return reply.code(404).send({ error: 'Node not found' });

      try {
        await assertNodeNotPinned(id, nodeId, 'update');
      } catch (err) {
        return reply.code(409).send({ error: err instanceof Error ? err.message : String(err) });
      }

      if (name !== undefined) { node.name = name; node.data.label = name; }
      if (config !== undefined) node.data.config = { ...(node.data.config ?? {}), ...config };
      if (disabled !== undefined) node.disabled = disabled;
      node.updatedAt = new Date().toISOString();

      await db.update(workflows).set({ nodes, updatedAt: new Date() }).where(eq(workflows.id, id));

      getBroadcaster()?.broadcastToWorkflow(id, 'node_updated', { node_id: nodeId, name, config, disabled });
      await recordSnapshot(id, {
        actor: request.user?.email ?? 'api',
        message: `update_node:${nodeId}`,
        app,
      }).catch(logSnapshotFailure(app, id));
      await maybeEmitAutoReview(id).catch(() => undefined);

      return { node };
    },
  );

  // Delete node from workflow
  app.delete<{ Params: { id: string; nodeId: string } }>(
    '/api/workflows/:id/nodes/:nodeId',
    async (request, reply) => {
      const { id, nodeId } = request.params;

      const [wf] = await db.select().from(workflows).where(eq(workflows.id, id));
      if (!wf) return reply.code(404).send({ error: 'Workflow not found' });

      const originalNodes = (wf.nodes ?? []) as WorkflowNode[];
      if (!originalNodes.some((n) => n.id === nodeId)) {
        return reply.code(404).send({ error: 'Node not found' });
      }

      try {
        await assertNodeNotPinned(id, nodeId, 'remove');
      } catch (err) {
        return reply.code(409).send({ error: err instanceof Error ? err.message : String(err) });
      }

      const nodes = originalNodes.filter((n) => n.id !== nodeId);

      const connections = ((wf.connections ?? []) as Connection[]).filter(
        (c) => c.sourceNodeId !== nodeId && c.targetNodeId !== nodeId,
      );

      await db.update(workflows).set({ nodes, connections, updatedAt: new Date() }).where(eq(workflows.id, id));

      getBroadcaster()?.broadcastToWorkflow(id, 'node_removed', { node_id: nodeId });
      await recordSnapshot(id, {
        actor: request.user?.email ?? 'api',
        message: `remove_node:${nodeId}`,
        app,
      }).catch(logSnapshotFailure(app, id));
      await maybeEmitAutoReview(id).catch(() => undefined);

      return { removed: true, node_id: nodeId };
    },
  );

  // Create connection
  app.post<{ Params: { id: string }; Body: { sourceNodeId: string; targetNodeId: string; sourceHandle?: string; targetHandle?: string } }>(
    '/api/workflows/:id/connections',
    async (request, reply) => {
      const { id } = request.params;
      const { sourceNodeId, targetNodeId, sourceHandle, targetHandle } = request.body;

      const [wf] = await db.select().from(workflows).where(eq(workflows.id, id));
      if (!wf) return reply.code(404).send({ error: 'Workflow not found' });

      const nodes = (wf.nodes ?? []) as WorkflowNode[];

      // P6: Reject self-connections
      if (sourceNodeId === targetNodeId) {
        return reply.code(400).send({ error: 'Cannot connect a node to itself' });
      }

      // P5: Validate source and target nodes exist
      if (!nodes.some((n) => n.id === sourceNodeId)) {
        return reply.code(400).send({ error: `Source node ${sourceNodeId} not found` });
      }
      if (!nodes.some((n) => n.id === targetNodeId)) {
        return reply.code(400).send({ error: `Target node ${targetNodeId} not found` });
      }

      const connections = (wf.connections ?? []) as Connection[];

      // P7: Reject duplicate connections
      const isDuplicate = connections.some(
        (c) => c.sourceNodeId === sourceNodeId && c.targetNodeId === targetNodeId
          && (c.sourceHandle ?? undefined) === (sourceHandle ?? undefined)
          && (c.targetHandle ?? undefined) === (targetHandle ?? undefined),
      );
      if (isDuplicate) {
        return reply.code(409).send({ error: 'Connection already exists' });
      }

      const newConnection: Connection = {
        id: nanoid(12),
        sourceNodeId,
        targetNodeId,
        sourceHandle,
        targetHandle,
      };
      connections.push(newConnection);

      await db.update(workflows).set({ connections, updatedAt: new Date() }).where(eq(workflows.id, id));

      getBroadcaster()?.broadcastToWorkflow(id, 'connection_added', { connection: newConnection });
      await recordSnapshot(id, {
        actor: request.user?.email ?? 'api',
        message: 'connect',
        app,
      }).catch(logSnapshotFailure(app, id));
      await maybeEmitAutoReview(id).catch(() => undefined);

      return { connection: newConnection };
    },
  );

  // Delete connection
  app.delete<{ Params: { id: string; connectionId: string } }>(
    '/api/workflows/:id/connections/:connectionId',
    async (request, reply) => {
      const { id, connectionId } = request.params;

      const [wf] = await db.select().from(workflows).where(eq(workflows.id, id));
      if (!wf) return reply.code(404).send({ error: 'Workflow not found' });

      const connections = (wf.connections ?? []) as Connection[];
      const target = connections.find((c) => c.id === connectionId);
      if (!target) {
        return reply.code(404).send({ error: 'Connection not found' });
      }

      try {
        await assertConnectionEndpointsNotPinned(id, {
          sourceNodeId: target.sourceNodeId,
          targetNodeId: target.targetNodeId,
        });
      } catch (err) {
        return reply.code(409).send({ error: err instanceof Error ? err.message : String(err) });
      }

      const filtered = connections.filter((c) => c.id !== connectionId);

      await db.update(workflows).set({ connections: filtered, updatedAt: new Date() }).where(eq(workflows.id, id));

      getBroadcaster()?.broadcastToWorkflow(id, 'connection_removed', { connection_id: connectionId });
      await recordSnapshot(id, {
        actor: request.user?.email ?? 'api',
        message: 'disconnect',
        app,
      }).catch(logSnapshotFailure(app, id));
      await maybeEmitAutoReview(id).catch(() => undefined);

      return { removed: true, connection_id: connectionId };
    },
  );

  // List executions for a workflow
  app.get<{ Params: { id: string } }>(
    '/api/workflows/:id/executions',
    async (request) => {
      const rows = await db.select().from(executions)
        .where(eq(executions.workflowId, request.params.id))
        .orderBy(desc(executions.startedAt))
        .limit(50);
      return { executions: rows.map(toExecution) };
    },
  );

  // Get single execution detail
  app.get<{ Params: { id: string; executionId: string } }>(
    '/api/workflows/:id/executions/:executionId',
    async (request, reply) => {
      const [row] = await db.select().from(executions)
        .where(and(
          eq(executions.id, request.params.executionId),
          eq(executions.workflowId, request.params.id),
        ));
      if (!row) return reply.code(404).send({ error: 'Execution not found' });
      return toExecution(row);
    },
  );

  // Execute workflow
  app.post<{ Params: { id: string }; Body: { triggerData?: unknown } }>(
    '/api/workflows/:id/execute',
    async (request, reply) => {
      const [wf] = await db.select().from(workflows).where(eq(workflows.id, request.params.id));
      if (!wf) return reply.code(404).send({ error: 'Workflow not found' });

      const { isQueueMode, enqueueExecution } = await import('../../queue/manager.js');

      if (isQueueMode()) {
        // Queue mode: create execution record as 'queued', enqueue job
        const [execRecord] = await db
          .insert(executions)
          .values({
            workflowId: wf.id,
            workflowVersion: wf.version ?? 1,
            status: 'queued',
            mode: 'manual',
            triggeredBy: 'api',
            triggerData: request.body.triggerData ?? null,
            startedAt: new Date(),
          })
          .returning();

        await enqueueExecution({
          workflowId: wf.id,
          executionId: execRecord.id,
          triggerData: request.body.triggerData,
          mode: 'manual',
          triggeredBy: 'api',
        });

        const { getBroadcaster } = await import('../../api/ws/broadcaster.js');
        getBroadcaster()?.broadcastToWorkflow(wf.id, 'execution_queued', {
          execution_id: execRecord.id,
          workflow_id: wf.id,
        });

        return { id: execRecord.id, status: 'queued', workflowId: wf.id };
      }

      // Inline mode (default)
      const { workflowExecutor } = await import('../../engine/executor.js');
      const workflow = toWorkflow(wf);
      const execution = await workflowExecutor.execute(workflow, request.body.triggerData, 'manual', 'api');

      return execution;
    },
  );

  // ─── Queue status (Story 5.5) ────────────────────────────
  app.get('/api/queue/status', async () => {
    const { isQueueMode, getQueueStatus } = await import('../../queue/manager.js');
    if (!isQueueMode()) {
      return { enabled: false };
    }
    return getQueueStatus();
  });

  // ─── Workflow export (Story 4.1) ─────────────────────────
  app.get<{ Params: { id: string }; Querystring: { format?: string; download?: string } }>(
    '/api/workflows/:id/export',
    async (request, reply) => {
      const { id } = request.params;
      const fmt = (request.query.format ?? 'json') as string;
      if (!(EXPORT_FORMATS as readonly string[]).includes(fmt)) {
        return reply.code(400).send({
          error: `Unknown export format "${fmt}". Valid: ${EXPORT_FORMATS.join(', ')}`,
        });
      }
      const [row] = await db.select().from(workflows).where(eq(workflows.id, id));
      if (!row) return reply.code(404).send({ error: 'Workflow not found' });
      try {
        const result = compileWorkflow(toWorkflow(row), fmt as ExportFormat);
        if (request.query.download === '1') {
          return reply
            .header('Content-Disposition', `attachment; filename="${result.filename}"`)
            .type(result.mimeType)
            .send(result.content);
        }
        return result;
      } catch (err) {
        if (err instanceof ExportError) return reply.code(400).send({ error: err.message });
        throw err;
      }
    },
  );

  // ─── Import n8n workflow (Story 4.2) ─────────────────────
  app.post<{ Body: { n8n_workflow_json?: unknown; name?: string; description?: string } }>(
    '/api/workflows/import-n8n',
    async (request, reply) => {
      const body = request.body ?? {};
      try {
        const result = importN8nWorkflow(body.n8n_workflow_json, {
          name: body.name,
          description: body.description,
        });
        const [row] = await db.insert(workflows).values({
          name: result.workflow.name,
          description: result.workflow.description,
          nodes: result.workflow.nodes,
          connections: result.workflow.connections,
          createdBy: 'mcp:import',
          updatedBy: 'mcp:import',
        }).returning();
        const wf = toWorkflow(row);
        getBroadcaster()?.broadcast('workflow_created', wf.id, wf);
        await recordSnapshot(row.id, {
          actor: request.user?.email ?? 'api',
          message: 'import:n8n',
          app,
        }).catch(logSnapshotFailure(app, row.id));
        return { workflow: wf, warnings: result.warnings };
      } catch (err) {
        if (err instanceof ImportError) return reply.code(400).send({ error: err.message });
        throw err;
      }
    },
  );

  // ─── Validate workflow (Story 4.2) ───────────────────────
  app.post<{ Params: { id: string } }>(
    '/api/workflows/:id/validate',
    async (request, reply) => {
      const wf = await getWorkflowById(request.params.id);
      if (!wf) return reply.code(404).send({ error: `Workflow not found: ${request.params.id}` });
      return validateWorkflow(wf);
    },
  );

  // ─── Protected Zones REST routes (Story 3.2) ───────────────
  function zoneErrorReply(reply: FastifyReply, err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof ZoneServiceError && err.code === 'NOT_FOUND') {
      return reply.code(404).send({ error: message });
    }
    if (message.startsWith('PROTECTED ZONE:')) {
      return reply.code(409).send({ error: message });
    }
    return reply.code(400).send({ error: message });
  }

  app.get<{ Params: { id: string } }>('/api/workflows/:id/zones', async (request, reply) => {
    const { id } = request.params;
    const [wf] = await db.select().from(workflows).where(eq(workflows.id, id));
    if (!wf) return reply.code(404).send({ error: 'Workflow not found' });
    const zones = await getZonesCore(id);
    return { zones };
  });

  app.post<{
    Params: { id: string };
    Body: { name: string; node_ids: string[]; color?: string; reason?: string; pinned_by?: string };
  }>('/api/workflows/:id/zones', async (request, reply) => {
    const { id } = request.params;
    const { name, node_ids, color, reason, pinned_by } = request.body ?? ({} as Record<string, never>);
    if (!name || !Array.isArray(node_ids) || node_ids.length === 0) {
      return reply.code(400).send({ error: 'name and node_ids are required' });
    }
    try {
      const zone = await createZoneCore({
        workflowId: id,
        name,
        nodeIds: node_ids,
        color,
        reason,
        pinnedBy: pinned_by ?? 'ui:user',
      });
      return { zone };
    } catch (err) {
      return zoneErrorReply(reply, err);
    }
  });

  app.patch<{
    Params: { id: string; zoneId: string };
    Body: { name?: string; color?: string; reason?: string };
  }>('/api/workflows/:id/zones/:zoneId', async (request, reply) => {
    const { id, zoneId } = request.params;
    try {
      const zone = await updateZoneCore(id, zoneId, request.body ?? {});
      return { zone };
    } catch (err) {
      return zoneErrorReply(reply, err);
    }
  });

  app.delete<{ Params: { id: string; zoneId: string } }>(
    '/api/workflows/:id/zones/:zoneId',
    async (request, reply) => {
      const { id, zoneId } = request.params;
      try {
        const result = await deleteZoneCore(id, zoneId);
        return result;
      } catch (err) {
        return zoneErrorReply(reply, err);
      }
    },
  );

  app.post<{
    Params: { id: string; zoneId: string };
    Body: { node_ids: string[] };
  }>('/api/workflows/:id/zones/:zoneId/add', async (request, reply) => {
    const { id, zoneId } = request.params;
    const node_ids = request.body?.node_ids;
    if (!Array.isArray(node_ids) || node_ids.length === 0) {
      return reply.code(400).send({ error: 'node_ids is required' });
    }
    try {
      const zone = await addToZoneCore(id, zoneId, node_ids);
      return { zone };
    } catch (err) {
      return zoneErrorReply(reply, err);
    }
  });

  app.post<{
    Params: { id: string; zoneId: string };
    Body: { node_ids: string[] };
  }>('/api/workflows/:id/zones/:zoneId/remove', async (request, reply) => {
    const { id, zoneId } = request.params;
    const node_ids = request.body?.node_ids;
    if (!Array.isArray(node_ids) || node_ids.length === 0) {
      return reply.code(400).send({ error: 'node_ids is required' });
    }
    try {
      const result = await removeFromZoneCore(id, zoneId, node_ids);
      if (result.kind === 'deleted') return { deleted: true, zone_id: result.zone_id };
      return { zone: result.zone };
    } catch (err) {
      return zoneErrorReply(reply, err);
    }
  });

  // Get task-node links for a workflow (enriched with live team data)
  app.get<{ Params: { workflowId: string } }>('/api/workflows/:workflowId/task-links', async (request) => {
    const { workflowId } = request.params;
    const links = await db.select().from(taskNodeLinks).where(eq(taskNodeLinks.workflowId, workflowId));

    const watcher = getTeamWatcher();
    const enriched = await Promise.all(links.map(async (link) => {
      let assignee: string | null = null;
      let taskStatus = 'unknown';
      let taskTitle = '';
      if (watcher.isWatching(link.teamName)) {
        try {
          const snapshot = await watcher.getSnapshot(link.teamName);
          const task = snapshot.tasks.find(t => t.id === link.taskId);
          if (task) {
            assignee = task.assignee;
            taskStatus = task.status;
            taskTitle = task.title;
          }
        } catch {
          // Team may have been unwatched between check and snapshot — degrade gracefully
        }
      }
      return { taskId: link.taskId, nodeId: link.nodeId, teamName: link.teamName, assignee, taskStatus, taskTitle };
    }));

    return { links: enriched };
  });

  // ─── Versioning routes (Story 5.3) ─────────────────────────
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/api/workflows/:id/versions',
    async (request, reply) => {
      const { id } = request.params;
      const [wf] = await db.select().from(workflows).where(eq(workflows.id, id));
      if (!wf) return reply.code(404).send({ error: 'Workflow not found' });
      const raw = parseInt(request.query.limit ?? '50', 10);
      const limit = Math.min(Math.max(Number.isFinite(raw) ? raw : 50, 1), 200);
      const versions = await listVersions(id, limit);
      return { versions };
    },
  );

  app.get<{ Params: { id: string; version: string } }>(
    '/api/workflows/:id/versions/:version',
    async (request, reply) => {
      const { id } = request.params;
      const raw = request.params.version;
      const v = Number(raw);
      if (!Number.isInteger(v) || v < 1 || String(v) !== raw) {
        return reply.code(400).send({ error: 'invalid version' });
      }
      const row = await getVersion(id, v);
      if (!row) return reply.code(404).send({ error: 'Version not found' });
      return {
        version: row.version,
        snapshot: row.snapshot,
        gitSha: row.gitSha,
        message: row.message,
        createdBy: row.createdBy,
        createdAt: row.createdAt?.toISOString() ?? null,
      };
    },
  );

  app.get<{ Params: { id: string }; Querystring: { from?: string; to?: string } }>(
    '/api/workflows/:id/diff',
    async (request, reply) => {
      const { id } = request.params;
      const fromRaw = request.query.from ?? '';
      const toRaw = request.query.to ?? '';
      const from = Number(fromRaw);
      const to = Number(toRaw);
      if (
        !Number.isInteger(from) || from < 1 || String(from) !== fromRaw ||
        !Number.isInteger(to) || to < 1 || String(to) !== toRaw
      ) {
        return reply.code(400).send({ error: 'from and to must be positive integers' });
      }
      const a = await getVersion(id, from);
      const b = await getVersion(id, to);
      if (!a || !b) return reply.code(404).send({ error: 'Version not found' });
      const diff = diffSnapshots(a.snapshot as never, b.snapshot as never);
      return { from, to, ...diff };
    },
  );

  app.post<{ Params: { id: string }; Body: { version: number; message?: string } }>(
    '/api/workflows/:id/revert',
    async (request, reply) => {
      const { id } = request.params;
      const { version, message } = request.body ?? ({} as { version: number; message?: string });
      if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
        return reply.code(400).send({ error: 'version must be a positive integer' });
      }
      const result = await revertToVersion(id, version, {
        actor: request.user?.email ?? 'api',
        message,
        app,
      });
      if (!result) return reply.code(404).send({ error: 'Version not found' });
      const [updated] = await db.select().from(workflows).where(eq(workflows.id, id));
      if (updated) {
        getBroadcaster()?.broadcast('workflow_updated', id, toWorkflow(updated));
      }
      await maybeEmitAutoReview(id).catch(() => undefined);
      return { reverted: true, version: result.version };
    },
  );

  // ─── Set environment (Story 5.4) ──────────────────────
  // Allows free movement between dev/staging/prod (no forward-only restriction).
  app.post<{ Params: { id: string }; Body: { environment: string } }>(
    '/api/workflows/:id/promote',
    async (request, reply) => {
      // Skip generic audit middleware — we write custom metadata below.
      request.auditSkip = true;

      const { id } = request.params;
      const { environment } = request.body ?? ({} as { environment: string });
      const validEnvs = ['dev', 'staging', 'prod'];
      if (!environment || !validEnvs.includes(environment)) {
        return reply.code(400).send({ error: `environment must be one of: ${validEnvs.join(', ')}` });
      }
      const [wf] = await db.select().from(workflows).where(eq(workflows.id, id));
      if (!wf) return reply.code(404).send({ error: 'Workflow not found' });

      const from = wf.environment ?? 'dev';
      if (from === environment) {
        return { promoted: false, reason: 'already in target' };
      }

      const [updated] = await db
        .update(workflows)
        .set({ environment, updatedAt: new Date() })
        .where(eq(workflows.id, id))
        .returning();

      const actor = request.user?.email ?? 'api';

      // Version snapshot (environment is now in shouldVersion field list).
      await recordSnapshot(id, { actor, message: `promote:${from}->${environment}`, app })
        .catch(logSnapshotFailure(app, id));

      // Audit entry with custom { from, to } metadata.
      await app.audit?.write({
        actor,
        action: 'workflow.promoted',
        resourceType: 'workflow',
        resourceId: id,
        metadata: { from, to: environment },
      }).catch((err) => app.log.warn({ err, id }, 'promote audit write failed'));

      // WS broadcast.
      getBroadcaster()?.broadcast('workflow_updated', id, toWorkflow(updated));

      return { promoted: true, from, to: environment };
    },
  );

  // ─── Git sync routes (Story 5.3) ───────────────────────────
  async function loadResolvedGitConfig(): Promise<ResolvedGitConfig | { error: string }> {
    const [row] = await db.select().from(instanceSettings).where(eq(instanceSettings.id, 'singleton'));
    if (!row || !row.gitSyncEnabled) return { error: 'git_sync_disabled' };
    if (!row.gitRepoUrl || !row.gitTokenEncrypted || !row.gitAuthorEmail) {
      return { error: 'git_sync_misconfigured' };
    }
    let token: string;
    try {
      token = decrypt(row.gitTokenEncrypted);
    } catch {
      return { error: 'git_token_invalid' };
    }
    const rawBranch = (row.gitBranch ?? '').trim();
    return {
      repoUrl: row.gitRepoUrl,
      branch: rawBranch || 'main',
      authorName: row.gitAuthorName ?? 'flowAIbuilder',
      authorEmail: row.gitAuthorEmail,
      token,
      localPath: defaultRepoPath(),
    };
  }

  app.post<{ Params: { id: string }; Body: { message: string; versionId?: string } }>(
    '/api/workflows/:id/git/push',
    async (request, reply) => {
      const { id } = request.params;
      const { message, versionId } = request.body ?? ({} as { message: string; versionId?: string });
      if (!message || typeof message !== 'string') {
        return reply.code(400).send({ error: 'message required' });
      }
      const cfg = await loadResolvedGitConfig();
      if ('error' in cfg) {
        // 501 is reserved for "feature disabled"; misconfig/token errors map
        // to 400 / 500 so clients can distinguish actionable fixes.
        const code = cfg.error === 'git_sync_disabled' ? 501
          : cfg.error === 'git_sync_misconfigured' ? 400
          : 500;
        return reply.code(code).send({ error: cfg.error });
      }

      // Resolve target version: explicit id, else latest.
      let targetRow: typeof workflowVersions.$inferSelect | undefined;
      if (versionId) {
        const [r] = await db
          .select()
          .from(workflowVersions)
          .where(and(eq(workflowVersions.id, versionId), eq(workflowVersions.workflowId, id)));
        targetRow = r;
      } else {
        const [r] = await db
          .select()
          .from(workflowVersions)
          .where(eq(workflowVersions.workflowId, id))
          .orderBy(desc(workflowVersions.version))
          .limit(1);
        targetRow = r;
      }
      if (!targetRow) return reply.code(404).send({ error: 'No version to push' });

      // Idempotency: if gitSha already set, short-circuit.
      if (targetRow.gitSha) {
        return { sha: targetRow.gitSha, version: targetRow.version, message, file: `workflows/${id}.json` };
      }

      const snapshot = targetRow.snapshot as never;
      try {
        const pushed = await pushWorkflow(id, snapshot, { message, config: cfg });
        // Conditional update: only write gitSha if it is still null, so two
        // concurrent pushes that both won the TOCTOU race cannot overwrite
        // each other. The loser detects the no-op via updatedRows.length === 0.
        const updated = await db
          .update(workflowVersions)
          .set({ gitSha: pushed.sha })
          .where(and(eq(workflowVersions.id, targetRow.id), sql`${workflowVersions.gitSha} IS NULL`))
          .returning();
        if (updated.length === 0) {
          // Another concurrent push beat us to it — re-read and return its sha.
          const [r] = await db
            .select()
            .from(workflowVersions)
            .where(eq(workflowVersions.id, targetRow.id));
          return { sha: r?.gitSha ?? pushed.sha, version: targetRow.version, message, file: pushed.file };
        }
        app.audit?.write({
          actor: request.user?.email ?? 'api',
          action: 'workflow.git.pushed',
          resourceType: 'workflow',
          resourceId: id,
          metadata: { sha: pushed.sha, version: targetRow.version, branch: cfg.branch },
        }).catch((err) => app.log.warn({ err, workflowId: id }, 'audit write failed'));
        return { sha: pushed.sha, version: targetRow.version, message, file: pushed.file };
      } catch (err) {
        app.log.error({ err, workflowId: id }, 'git push failed');
        return reply.code(500).send({
          error: 'git_push_failed',
          detail: sanitizeGitError(err),
        });
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/workflows/:id/git/history',
    async (request, reply) => {
      const { id } = request.params;
      const rows = await db
        .select({
          id: workflowVersions.id,
          version: workflowVersions.version,
          gitSha: workflowVersions.gitSha,
          message: workflowVersions.message,
          createdBy: workflowVersions.createdBy,
          createdAt: workflowVersions.createdAt,
        })
        .from(workflowVersions)
        .where(and(eq(workflowVersions.workflowId, id), isNotNull(workflowVersions.gitSha)))
        .orderBy(desc(workflowVersions.version));
      return {
        history: rows.map((r) => ({
          id: r.id,
          version: r.version,
          gitSha: r.gitSha,
          message: r.message,
          createdBy: r.createdBy,
          createdAt: r.createdAt?.toISOString() ?? null,
        })),
      };
    },
  );
}

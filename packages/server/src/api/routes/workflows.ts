import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { workflows } from '../../db/schema.js';
import type { Workflow, WorkflowNode, Connection } from '@flowaibuilder/shared';
import { nanoid } from 'nanoid';
import { getBroadcaster } from '../ws/broadcaster.js';

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
    const [row] = await db.insert(workflows).values({
      name,
      description: description ?? '',
      createdBy: 'api',
      updatedBy: 'api',
    }).returning();
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

    const [row] = await db.update(workflows).set(updates).where(eq(workflows.id, id)).returning();
    if (!row) return reply.code(404).send({ error: 'Workflow not found' });
    return toWorkflow(row);
  });

  // Delete workflow
  app.delete<{ Params: { id: string } }>('/api/workflows/:id', async (request, reply) => {
    const [row] = await db.delete(workflows).where(eq(workflows.id, request.params.id)).returning();
    if (!row) return reply.code(404).send({ error: 'Workflow not found' });
    return { deleted: true, id: row.id };
  });

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

      return { node: newNode, position };
    },
  );

  // Execute workflow
  app.post<{ Params: { id: string }; Body: { triggerData?: unknown } }>(
    '/api/workflows/:id/execute',
    async (request, reply) => {
      const [wf] = await db.select().from(workflows).where(eq(workflows.id, request.params.id));
      if (!wf) return reply.code(404).send({ error: 'Workflow not found' });

      const { workflowExecutor } = await import('../../engine/executor.js');
      const workflow = toWorkflow(wf);
      const execution = await workflowExecutor.execute(workflow, request.body.triggerData, 'manual', 'api');

      return execution;
    },
  );
}

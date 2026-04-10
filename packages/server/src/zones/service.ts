import { eq, and } from 'drizzle-orm';
import type { ProtectedZone, WorkflowNode } from '@flowaibuilder/shared';
import { db } from '../db/index.js';
import { protectedZones, workflows } from '../db/schema.js';
import { getBroadcaster } from '../api/ws/broadcaster.js';

type ZoneRow = typeof protectedZones.$inferSelect;

export class ZoneServiceError extends Error {
  constructor(message: string, public code: 'NOT_FOUND' | 'INVALID' = 'INVALID') {
    super(message);
  }
}

function serializeZone(row: ZoneRow): ProtectedZone {
  const pinnedAt = row.pinnedAt instanceof Date
    ? row.pinnedAt.toISOString()
    : (row.pinnedAt as unknown as string) ?? new Date().toISOString();
  return {
    id: row.id as string,
    workflowId: row.workflowId as string,
    name: row.name as string,
    nodeIds: ((row.nodeIds ?? []) as string[]),
    color: (row.color as string | null) ?? undefined,
    pinnedBy: row.pinnedBy as string,
    pinnedAt,
    reason: (row.reason as string | null) ?? undefined,
    canUnpin: ((row.canUnpin ?? []) as string[]),
  };
}

async function loadWorkflowNodes(workflowId: string): Promise<WorkflowNode[] | null> {
  const [wf] = await db.select().from(workflows).where(eq(workflows.id, workflowId));
  if (!wf) return null;
  return ((wf.nodes ?? []) as WorkflowNode[]);
}

export interface CreateZoneInput {
  workflowId: string;
  name: string;
  nodeIds: string[];
  color?: string;
  reason?: string;
  pinnedBy?: string;
}

export async function createZoneCore(input: CreateZoneInput): Promise<ProtectedZone> {
  const wfNodes = await loadWorkflowNodes(input.workflowId);
  if (wfNodes === null) throw new ZoneServiceError(`Workflow ${input.workflowId} not found`, 'NOT_FOUND');
  const nodeSet = new Set(wfNodes.map(n => n.id));
  for (const id of input.nodeIds) {
    if (!nodeSet.has(id)) throw new ZoneServiceError(`Node ${id} not found in workflow`);
  }
  // Reject nodes already pinned in another zone (prevents double-membership)
  const existingZones = await db
    .select()
    .from(protectedZones)
    .where(eq(protectedZones.workflowId, input.workflowId));
  const alreadyPinned = new Set<string>();
  for (const z of existingZones) {
    for (const id of ((z.nodeIds ?? []) as string[])) alreadyPinned.add(id);
  }
  for (const id of input.nodeIds) {
    if (alreadyPinned.has(id)) throw new ZoneServiceError(`Node ${id} is already in a protected zone`);
  }
  const [row] = await db
    .insert(protectedZones)
    .values({
      workflowId: input.workflowId,
      name: input.name,
      nodeIds: input.nodeIds,
      color: input.color ?? '#378ADD',
      pinnedBy: input.pinnedBy ?? 'mcp:claude',
      reason: input.reason,
    })
    .returning();
  const zone = serializeZone(row as ZoneRow);
  getBroadcaster()?.broadcastToWorkflow(input.workflowId, 'zone_created', { zone });
  return zone;
}

export async function deleteZoneCore(workflowId: string, zoneId: string): Promise<{ deleted: true; zone_id: string }> {
  const deleted = await db
    .delete(protectedZones)
    .where(and(eq(protectedZones.id, zoneId), eq(protectedZones.workflowId, workflowId)))
    .returning();
  if (!deleted || deleted.length === 0) {
    throw new ZoneServiceError(`Zone ${zoneId} not found in workflow ${workflowId}`, 'NOT_FOUND');
  }
  getBroadcaster()?.broadcastToWorkflow(workflowId, 'zone_deleted', { zone_id: zoneId, workflow_id: workflowId });
  return { deleted: true, zone_id: zoneId };
}

export interface UpdateZoneInput {
  name?: string;
  color?: string;
  reason?: string;
}

export async function updateZoneCore(workflowId: string, zoneId: string, patch: UpdateZoneInput): Promise<ProtectedZone> {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.color !== undefined) update.color = patch.color;
  if (patch.reason !== undefined) update.reason = patch.reason;
  if (Object.keys(update).length === 0) {
    const [existing] = await db
      .select()
      .from(protectedZones)
      .where(and(eq(protectedZones.id, zoneId), eq(protectedZones.workflowId, workflowId)));
    if (!existing) throw new ZoneServiceError(`Zone ${zoneId} not found in workflow ${workflowId}`, 'NOT_FOUND');
    return serializeZone(existing as ZoneRow);
  }
  const [updated] = await db
    .update(protectedZones)
    .set(update)
    .where(and(eq(protectedZones.id, zoneId), eq(protectedZones.workflowId, workflowId)))
    .returning();
  if (!updated) throw new ZoneServiceError(`Zone ${zoneId} not found in workflow ${workflowId}`, 'NOT_FOUND');
  const zone = serializeZone(updated as ZoneRow);
  getBroadcaster()?.broadcastToWorkflow(workflowId, 'zone_updated', { zone });
  return zone;
}

export async function addToZoneCore(workflowId: string, zoneId: string, nodeIds: string[]): Promise<ProtectedZone> {
  const [zoneRow] = await db
    .select()
    .from(protectedZones)
    .where(and(eq(protectedZones.id, zoneId), eq(protectedZones.workflowId, workflowId)));
  if (!zoneRow) throw new ZoneServiceError(`Zone ${zoneId} not found in workflow ${workflowId}`, 'NOT_FOUND');

  const wfNodes = await loadWorkflowNodes(workflowId);
  if (wfNodes === null) throw new ZoneServiceError(`Workflow ${workflowId} not found`, 'NOT_FOUND');
  const nodeSet = new Set(wfNodes.map(n => n.id));
  for (const id of nodeIds) {
    if (!nodeSet.has(id)) throw new ZoneServiceError(`Node ${id} not found in workflow`);
  }
  // Reject nodes already pinned in any other zone of this workflow
  const otherZones = await db
    .select()
    .from(protectedZones)
    .where(eq(protectedZones.workflowId, workflowId));
  const alreadyPinned = new Set<string>();
  for (const z of otherZones) {
    if (z.id === zoneId) continue;
    for (const id of ((z.nodeIds ?? []) as string[])) alreadyPinned.add(id);
  }
  for (const id of nodeIds) {
    if (alreadyPinned.has(id)) throw new ZoneServiceError(`Node ${id} is already in another protected zone`);
  }

  const existing = ((zoneRow.nodeIds ?? []) as string[]);
  const seen = new Set(existing);
  const merged = [...existing];
  for (const id of nodeIds) {
    if (!seen.has(id)) {
      merged.push(id);
      seen.add(id);
    }
  }

  const [updated] = await db
    .update(protectedZones)
    .set({ nodeIds: merged })
    .where(and(eq(protectedZones.id, zoneId), eq(protectedZones.workflowId, workflowId)))
    .returning();
  const zone = serializeZone(updated as ZoneRow);
  getBroadcaster()?.broadcastToWorkflow(workflowId, 'zone_updated', { zone });
  return zone;
}

export type RemoveFromZoneResult =
  | { kind: 'updated'; zone: ProtectedZone }
  | { kind: 'deleted'; zone_id: string };

export async function removeFromZoneCore(workflowId: string, zoneId: string, nodeIds: string[]): Promise<RemoveFromZoneResult> {
  const [zoneRow] = await db
    .select()
    .from(protectedZones)
    .where(and(eq(protectedZones.id, zoneId), eq(protectedZones.workflowId, workflowId)));
  if (!zoneRow) throw new ZoneServiceError(`Zone ${zoneId} not found in workflow ${workflowId}`, 'NOT_FOUND');

  const removeSet = new Set(nodeIds);
  const existing = ((zoneRow.nodeIds ?? []) as string[]);
  const remaining = existing.filter(id => !removeSet.has(id));

  // No-op: none of the requested ids were members → return current zone without DB write or broadcast
  if (remaining.length === existing.length) {
    return { kind: 'updated', zone: serializeZone(zoneRow as ZoneRow) };
  }

  if (remaining.length === 0) {
    await db
      .delete(protectedZones)
      .where(and(eq(protectedZones.id, zoneId), eq(protectedZones.workflowId, workflowId)))
      .returning();
    getBroadcaster()?.broadcastToWorkflow(workflowId, 'zone_deleted', { zone_id: zoneId, workflow_id: workflowId });
    return { kind: 'deleted', zone_id: zoneId };
  }

  const [updated] = await db
    .update(protectedZones)
    .set({ nodeIds: remaining })
    .where(and(eq(protectedZones.id, zoneId), eq(protectedZones.workflowId, workflowId)))
    .returning();
  const zone = serializeZone(updated as ZoneRow);
  getBroadcaster()?.broadcastToWorkflow(workflowId, 'zone_updated', { zone });
  return { kind: 'updated', zone };
}

export async function getZonesCore(workflowId: string): Promise<ProtectedZone[]> {
  const rows = await db
    .select()
    .from(protectedZones)
    .where(eq(protectedZones.workflowId, workflowId));
  return (rows as ZoneRow[]).map(serializeZone);
}

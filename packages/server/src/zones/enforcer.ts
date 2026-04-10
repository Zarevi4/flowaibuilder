import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { protectedZones } from '../db/schema.js';

type Verb = 'update' | 'remove' | 'disconnect';

export async function getPinnedNodeIds(
  workflowId: string,
): Promise<Map<string, { zoneId: string; zoneName: string }>> {
  const rows = await db
    .select()
    .from(protectedZones)
    .where(eq(protectedZones.workflowId, workflowId));

  const map = new Map<string, { zoneId: string; zoneName: string }>();
  for (const row of rows) {
    const ids = (row.nodeIds ?? []) as string[];
    for (const id of ids) {
      if (!map.has(id)) {
        map.set(id, { zoneId: row.id as string, zoneName: row.name as string });
      }
    }
  }
  return map;
}

export function buildZoneError(verb: Verb, nodeId: string, zoneName: string): Error {
  return new Error(
    `PROTECTED ZONE: Cannot ${verb} node ${nodeId} — it belongs to zone "${zoneName}". You CAN: read config, trace data flow, connect new nodes to outputs. You CANNOT: modify, remove, or disconnect.`,
  );
}

export async function assertNodeNotPinned(
  workflowId: string,
  nodeId: string,
  verb: Verb,
): Promise<void> {
  const pinned = await getPinnedNodeIds(workflowId);
  const hit = pinned.get(nodeId);
  if (hit) throw buildZoneError(verb, nodeId, hit.zoneName);
}

export async function assertConnectionEndpointsNotPinned(
  workflowId: string,
  connection: { sourceNodeId: string; targetNodeId: string },
): Promise<void> {
  const pinned = await getPinnedNodeIds(workflowId);
  const src = pinned.get(connection.sourceNodeId);
  if (src) throw buildZoneError('disconnect', connection.sourceNodeId, src.zoneName);
  const tgt = pinned.get(connection.targetNodeId);
  if (tgt) throw buildZoneError('disconnect', connection.targetNodeId, tgt.zoneName);
}

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  createZoneCore,
  deleteZoneCore,
  addToZoneCore,
  removeFromZoneCore,
  getZonesCore,
  ZoneServiceError,
} from '../../zones/service.js';

function mcpError(message: string, extra?: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message, ...extra }) }],
    isError: true,
  };
}

function text(obj: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(obj) }] };
}

function asMcpError(err: unknown) {
  if (err instanceof ZoneServiceError) return mcpError(err.message);
  if (err instanceof Error) return mcpError(err.message);
  return mcpError(String(err));
}

export function registerZoneTools(server: McpServer) {
  // ─── create_zone ──────────────────────────────────────────
  server.tool(
    'flowaibuilder.create_zone',
    {
      workflow_id: z.string().describe('Workflow ID containing the nodes to protect'),
      name: z.string().min(1).describe('Human-readable zone name'),
      node_ids: z.array(z.string()).min(1).describe('IDs of nodes to include in the zone'),
      color: z.string().optional().describe('Hex color (default #378ADD)'),
      reason: z.string().optional().describe('Why this zone is protected'),
      pinned_by: z.string().optional().describe('Identifier of who pinned (default mcp:claude)'),
    },
    async ({ workflow_id, name, node_ids, color, reason, pinned_by }) => {
      try {
        const zone = await createZoneCore({
          workflowId: workflow_id,
          name,
          nodeIds: node_ids,
          color,
          reason,
          pinnedBy: pinned_by,
        });
        return text({ zone_id: zone.id, zone });
      } catch (err) {
        return asMcpError(err);
      }
    },
  );

  // ─── delete_zone ──────────────────────────────────────────
  server.tool(
    'flowaibuilder.delete_zone',
    {
      workflow_id: z.string().describe('Workflow ID owning the zone'),
      zone_id: z.string().describe('Zone ID to delete'),
    },
    async ({ workflow_id, zone_id }) => {
      try {
        const result = await deleteZoneCore(workflow_id, zone_id);
        return text(result);
      } catch (err) {
        return asMcpError(err);
      }
    },
  );

  // ─── add_to_zone ──────────────────────────────────────────
  server.tool(
    'flowaibuilder.add_to_zone',
    {
      workflow_id: z.string().describe('Workflow ID owning the zone'),
      zone_id: z.string().describe('Zone ID to extend'),
      node_ids: z.array(z.string()).min(1).describe('Node IDs to add to the zone'),
    },
    async ({ workflow_id, zone_id, node_ids }) => {
      try {
        const zone = await addToZoneCore(workflow_id, zone_id, node_ids);
        return text({ updated: true, zone });
      } catch (err) {
        return asMcpError(err);
      }
    },
  );

  // ─── remove_from_zone ─────────────────────────────────────
  server.tool(
    'flowaibuilder.remove_from_zone',
    {
      workflow_id: z.string().describe('Workflow ID owning the zone'),
      zone_id: z.string().describe('Zone ID to shrink'),
      node_ids: z.array(z.string()).min(1).describe('Node IDs to remove from the zone'),
    },
    async ({ workflow_id, zone_id, node_ids }) => {
      try {
        const result = await removeFromZoneCore(workflow_id, zone_id, node_ids);
        if (result.kind === 'deleted') return text({ deleted: true, zone_id: result.zone_id });
        return text({ updated: true, zone: result.zone });
      } catch (err) {
        return asMcpError(err);
      }
    },
  );

  // ─── get_zones ────────────────────────────────────────────
  server.tool(
    'flowaibuilder.get_zones',
    {
      workflow_id: z.string().describe('Workflow ID to list zones for'),
    },
    async ({ workflow_id }) => {
      try {
        const zones = await getZonesCore(workflow_id);
        return text({ zones });
      } catch (err) {
        return asMcpError(err);
      }
    },
  );
}

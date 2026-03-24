# Zone Enforcement Skill

## What Are Protected Zones
Human selects nodes on canvas -> clicks "Pin zone" -> those nodes become READ-ONLY for AI.
The MCP server enforces this. Claude (or any MCP client) CAN read pinned nodes but CANNOT modify them.

## Server-Side Enforcement
Every write operation checks zones BEFORE executing:

```
update_node    -> checkWrite(workflow_id, node_id, 'update')
remove_node    -> checkWrite(workflow_id, node_id, 'remove')
disconnect     -> checkWrite(workflow_id, source, 'disconnect') + checkWrite(target, 'disconnect')
apply_fix      -> checkWrite(workflow_id, annotation.node_id, 'apply fix to')
```

## What Claude CAN Do With Pinned Nodes
- READ configs (get_workflow returns full data including pinned nodes)
- TRACE data flow through them (get_review_context includes incoming/outgoing fields)
- CONNECT new nodes TO pinned nodes' outputs (add_node with connect_after pointing to pinned node)
- REFERENCE pinned nodes in expressions
- REVIEW pinned nodes (annotations can mention them, but fix.tool cannot target them)

## What Claude CANNOT Do
- update_node on pinned node -> ERROR
- remove_node on pinned node -> ERROR
- disconnect edges from/to pinned node -> ERROR
- apply_fix that targets pinned node -> ERROR

## Error Message Format
Errors MUST guide Claude to work around the zone:
```
"PROTECTED ZONE: Cannot update node 'CRM Enrichment'.
It belongs to zone 'CRM Integration' (pinned by user:alex on 2026-03-24).
You CAN: read config, trace data flow, connect new nodes to its outputs.
You CANNOT: modify config, remove node, disconnect edges.
Build around this zone or ask the human to unpin it."
```

## Zone Data
```typescript
interface ProtectedZone {
  id: string;
  workflow_id: string;
  name: string;           // "CRM Integration"
  node_ids: string[];     // nodes in zone
  color: string;          // boundary color on canvas
  pinned_by: string;      // "user:alex"
  pinned_at: string;
  reason?: string;        // "Production-tested"
}
```

## MCP Tools
```
flowaibuilder.create_zone       { workflow_id, name, node_ids[], color? }
flowaibuilder.delete_zone       { workflow_id, zone_id }
flowaibuilder.get_zones         { workflow_id }
flowaibuilder.add_to_zone       { workflow_id, zone_id, node_ids[] }
flowaibuilder.remove_from_zone  { workflow_id, zone_id, node_ids[] }
```

## Canvas Rendering
- Blue dashed boundary (SVG rect overlay) around pinned nodes
- Lock icon on each pinned node
- Zone label: name + pinned by + date
- Slightly dimmed nodes (opacity 0.8)
- Positions locked (cannot drag)

## AI Review + Zones
- No error/warning annotations on pinned nodes
- Suggestions CAN reference pinned nodes ("add error handling AFTER the CRM zone")
- Health score for pinned zones is locked at their last review score

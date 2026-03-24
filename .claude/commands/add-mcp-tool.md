---
description: "Scaffold a new MCP tool with schema, zone enforcement, audit logging, and WebSocket broadcast"
argument-hint: <tool-name> <tool-group: workflow|node|review|zone|agent-team|export>
---

# Add MCP Tool: $ARGUMENTS

## Steps

### 1. Parse arguments
Extract tool name and group from: $ARGUMENTS
Example: `duplicate_workflow workflow` or `get_health_score review`

### 2. Find or create tool group file
Tool groups are in `packages/server/src/mcp/tools/<group>-tools.ts`
If the group file exists, add to it. If not, create it.

### 3. Define Zod schema
```typescript
const <toolName>Schema = z.object({
  workflow_id: z.string().uuid(),
  // ... params
});
```

### 4. Implement tool handler
```typescript
server.tool("flowaibuilder.<tool_name>", <toolName>Schema, async (params) => {
  // Zone check (if modifying nodes)
  // await zoneEnforcer.checkWrite(params.workflow_id, params.node_id, 'operation');
  
  // Business logic
  const result = await service.doSomething(params);
  
  // Audit log
  await auditLog.log(actor, 'action.name', 'resource_type', result.id);
  
  // WebSocket broadcast
  broadcaster.send({ type: 'event_name', workflow_id: params.workflow_id, ...result });
  
  return result;
});
```

### 5. Checklist
Verify these are all present:
- [ ] Zod schema with proper types
- [ ] Zone enforcement check (if ANY node modification)
- [ ] Audit log entry
- [ ] WebSocket broadcast
- [ ] Descriptive error messages (especially for zone violations)
- [ ] Return type is JSON-serializable

### 6. Register in MCP server
Make sure the tool group file is imported in `packages/server/src/mcp/index.ts`

### 7. Add to shared types
If this tool returns a new data shape, add the type to `packages/shared/src/types/mcp.ts`

### 8. Summary
Print tool name, group, and remind to test with Claude Code.

# Story 3.1: Zone CRUD & Server-Side Enforcement

Status: done

## Story

As a workflow user,
I want to create protected zones around groups of nodes with server-side enforcement,
so that AI agents and other users cannot accidentally break working sections of my workflow.

## Acceptance Criteria

1. **Given** a workflow with nodes **When** Claude calls `flowaibuilder.create_zone({ workflow_id, name, node_ids, color?, reason?, pinned_by? })` **Then** a row is inserted into `protected_zones` with `workflowId`, `name`, `nodeIds` (validated to all exist in the workflow), `color` (default `#378ADD`), `pinnedBy` (default `'mcp:claude'`), `pinnedAt=now()`, and optional `reason`. **And** a `zone_created` event is broadcast via `getBroadcaster()?.broadcastToWorkflow(workflow_id, 'zone_created', { zone })`. The tool returns `{ zone_id, zone }`. If the workflow does not exist or any `node_ids[]` are not present in the workflow, return an MCP error.

2. **Given** a protected zone exists containing node X **When** Claude calls `flowaibuilder.update_node({ workflow_id, node_id: X, ... })` **Then** the `ZoneEnforcer` blocks the operation and the tool returns an MCP error with the EXACT message:
   `PROTECTED ZONE: Cannot update node {node_id} — it belongs to zone "{zone_name}". You CAN: read config, trace data flow, connect new nodes to outputs. You CANNOT: modify, remove, or disconnect.`
   **And** no DB write occurs and no `node_updated` event is broadcast.

3. **Given** a protected zone exists containing node X **When** Claude calls `flowaibuilder.remove_node({ workflow_id, node_id: X })` **Then** the operation is blocked with the same descriptive zone error format (substituting "remove" for "update" in the verb), no DB write occurs, no `node_removed` event is broadcast.

4. **Given** a protected zone exists containing node X **When** Claude calls `flowaibuilder.disconnect_nodes(...)` and the connection's `sourceNodeId` OR `targetNodeId` equals X **Then** the operation is blocked with the descriptive zone error (verb "disconnect"), no DB write occurs, no `connection_removed` event is broadcast. Disconnect operations targeting connections where neither endpoint is pinned proceed normally.

5. **Given** a protected zone exists **When** any read tool is called (`flowaibuilder.get_workflow`, `flowaibuilder.get_review_context`, REST `GET /api/workflows/:id`) **Then** read access is unrestricted — pinned nodes, their config, and zone metadata are returned normally. The enforcer MUST NOT touch any read path.

6. **Given** a protected zone exists **When** `flowaibuilder.delete_zone({ workflow_id, zone_id })` is called **Then** the row is deleted from `protected_zones`, member nodes become editable again, and a `zone_deleted` event is broadcast with `{ zone_id, workflow_id }`. Returns `{ deleted: true, zone_id }`. Returns MCP error if the zone does not exist or belongs to a different workflow.

7. **Given** a protected zone exists **When** `flowaibuilder.add_to_zone({ workflow_id, zone_id, node_ids })` is called **Then** the zone's `nodeIds` jsonb column is updated to the union of existing + new (deduplicated, order preserved), all `node_ids` are validated to exist in the workflow, and a `zone_updated` event is broadcast with the updated zone object. Returns `{ updated: true, zone }`.

8. **Given** a protected zone exists **When** `flowaibuilder.remove_from_zone({ workflow_id, zone_id, node_ids })` is called **Then** the listed `node_ids` are removed from the zone's `nodeIds`. If the resulting `nodeIds` array is empty, the zone row is deleted and a `zone_deleted` event is broadcast instead of `zone_updated`. Otherwise broadcast `zone_updated`. Returns `{ updated: true, zone }` or `{ deleted: true, zone_id }`.

9. **Given** zones exist for a workflow **When** Claude calls `flowaibuilder.get_zones({ workflow_id })` **Then** the tool returns `{ zones: ProtectedZone[] }` (matching the `ProtectedZone` shape from `packages/shared/src/types/zone.ts`) with each zone's `id`, `workflowId`, `name`, `nodeIds`, `color`, `pinnedBy`, `pinnedAt` (ISO string), `reason`, `canUnpin`. Empty array if none.

10. **Given** all 5 new zone MCP tools are registered **When** an MCP client lists tools **Then** `flowaibuilder.create_zone`, `flowaibuilder.delete_zone`, `flowaibuilder.add_to_zone`, `flowaibuilder.remove_from_zone`, and `flowaibuilder.get_zones` are present, each with zod-validated parameter schemas and `.describe()` strings on every field. The existing `flowaibuilder.get_review_context` tool from Story 2.1 already returns `protected_zones` and continues to work unchanged.

11. **Given** the `apply_fix` dispatcher (Story 2.2) routes a fix calling `flowaibuilder.update_node`, `remove_node`, or `disconnect_nodes` against a pinned node **When** the fix is applied **Then** the same `ZoneEnforcer` check fires (because the dispatcher invokes the shared `handleUpdateNode` / `handleRemoveNode` / `handleDisconnectNodes` module-level functions), the fix is rejected with the descriptive zone error, and the annotation is NOT marked applied.

12. **Given** the test suite **When** `npm test` runs in `packages/server` **Then** new tests in `packages/server/src/__tests__/zone-enforcer.test.ts` cover: (a) create_zone happy path + invalid node_ids, (b) update_node blocked on pinned node, (c) update_node allowed on non-pinned node, (d) remove_node blocked, (e) disconnect_nodes blocked when either endpoint pinned, (f) disconnect_nodes allowed when neither endpoint pinned, (g) read paths unaffected, (h) delete_zone unpins nodes, (i) add_to_zone / remove_from_zone, (j) remove_from_zone deleting last node deletes the zone.

## Tasks / Subtasks

- [x] Task 1: ZoneEnforcer module (AC: #2, #3, #4, #11)
  - [x] 1.1 Create `packages/server/src/zones/enforcer.ts` exporting:
    - `async function getPinnedNodeIds(workflowId: string): Promise<Map<string, { zoneId: string; zoneName: string }>>` — single SELECT against `protectedZones` filtered by `workflowId`, flattens all `nodeIds` into a Map keyed by node id.
    - `function buildZoneError(verb: 'update' | 'remove' | 'disconnect', nodeId: string, zoneName: string): Error` — returns an `Error` whose message matches the EXACT format in AC #2 (substituting verb).
    - `async function assertNodeNotPinned(workflowId: string, nodeId: string, verb: 'update' | 'remove' | 'disconnect'): Promise<void>` — throws `buildZoneError(...)` if pinned.
    - `async function assertConnectionEndpointsNotPinned(workflowId: string, connection: { sourceNodeId: string; targetNodeId: string }): Promise<void>` — throws if either endpoint pinned (verb `'disconnect'`).
  - [x] 1.2 Use the same `db` import pattern as `packages/server/src/mcp/index.ts` (`import { db } from '../db/index.js'` and `import { protectedZones } from '../db/schema.js'`).

- [x] Task 2: Wire enforcer into existing mutation handlers (AC: #2, #3, #4, #11)
  - [x] 2.1 In `packages/server/src/mcp/index.ts`, import `assertNodeNotPinned`, `assertConnectionEndpointsNotPinned` from `../zones/enforcer.js`.
  - [x] 2.2 In `handleUpdateNode` (line 100-138): immediately after the `if (!node) throw ...` line and BEFORE any mutation, call `await assertNodeNotPinned(workflow_id, node_id, 'update')`. Errors propagate up to MCP as `mcpError` automatically because they throw.
  - [x] 2.3 In `handleRemoveNode` (line 140-163): after the workflow load and BEFORE the filter, call `await assertNodeNotPinned(workflow_id, node_id, 'remove')`.
  - [x] 2.4 In `handleDisconnectNodes` (line 198-243): after resolving which connection(s) will be removed but BEFORE the DB write, call `await assertConnectionEndpointsNotPinned(workflow_id, connection)` for each connection that would be removed. If `connection_id` was supplied, look up the connection to get its endpoints first.
  - [x] 2.5 Do NOT wire the enforcer into `handleAddNode` or `handleConnectNodes` — the spec says zones must allow connecting NEW nodes to pinned outputs (per the error message: "You CAN: connect new nodes to outputs").
  - [x] 2.6 The dispatcher in `packages/server/src/review/fix-dispatcher.ts` already calls these `handle*` functions (registered at lines 500-504 of `mcp/index.ts`) — therefore AC #11 is satisfied by 2.2-2.4 with no fix-dispatcher changes.

- [x] Task 3: Zone MCP tools file (AC: #1, #6, #7, #8, #9, #10)
  - [x] 3.1 Create `packages/server/src/mcp/tools/zones.ts` exporting `registerZoneTools(server: McpServer)`. Follow the EXACT pattern of `packages/server/src/mcp/tools/agent-teams.ts`:
    - top-level imports (`McpServer`, `z`, `eq` from drizzle, `db`, `protectedZones`, `workflows`, `getBroadcaster`)
    - local `mcpError(message, extra?)` helper returning `{ content: [{ type: 'text', text: JSON.stringify({ error: message, ...extra }) }], isError: true }`
    - shared helper `serializeZone(row)` that maps the drizzle row to the `ProtectedZone` shape from `packages/shared/src/types/zone.ts` (convert `pinnedAt` to ISO string, default `nodeIds` to `[]`).
  - [x] 3.2 Implement `flowaibuilder.create_zone`:
    - Params: `{ workflow_id: z.string().describe(...), name: z.string().min(1), node_ids: z.array(z.string()).min(1), color: z.string().optional(), reason: z.string().optional(), pinned_by: z.string().optional() }`.
    - Load the workflow row; if missing → `mcpError`.
    - Validate every `node_ids[i]` exists in `wf.nodes`; if any missing → `mcpError("Node ${id} not found in workflow")`.
    - Insert via `db.insert(protectedZones).values({ workflowId, name, nodeIds: node_ids, color: color ?? '#378ADD', pinnedBy: pinned_by ?? 'mcp:claude', reason }).returning()`.
    - Broadcast `getBroadcaster()?.broadcastToWorkflow(workflow_id, 'zone_created', { zone: serializeZone(row) })`.
    - Return `text({ zone_id: row.id, zone: serializeZone(row) })`.
  - [x] 3.3 Implement `flowaibuilder.delete_zone`:
    - Params: `{ workflow_id: z.string(), zone_id: z.string() }`.
    - `db.delete(protectedZones).where(and(eq(protectedZones.id, zone_id), eq(protectedZones.workflowId, workflow_id))).returning()`. If empty → `mcpError`.
    - Broadcast `zone_deleted` with `{ zone_id, workflow_id }`. Return `text({ deleted: true, zone_id })`.
  - [x] 3.4 Implement `flowaibuilder.add_to_zone`:
    - Params: `{ workflow_id, zone_id, node_ids: z.array(z.string()).min(1) }`.
    - Load zone (filter by both id + workflowId). If missing → `mcpError`.
    - Load workflow; validate every new `node_ids[i]` exists in `wf.nodes`.
    - Compute new array: dedupe(union(existing, new)), preserve order (existing first).
    - `db.update(protectedZones).set({ nodeIds: merged }).where(eq(...)).returning()`.
    - Broadcast `zone_updated` with `{ zone: serializeZone(row) }`. Return `text({ updated: true, zone: serializeZone(row) })`.
  - [x] 3.5 Implement `flowaibuilder.remove_from_zone`:
    - Params: same as add_to_zone.
    - Compute new array: existing.filter(id => !node_ids.includes(id)).
    - If new array is empty → delete the zone row, broadcast `zone_deleted`, return `text({ deleted: true, zone_id })`.
    - Else update, broadcast `zone_updated`, return `text({ updated: true, zone: serializeZone(row) })`.
  - [x] 3.6 Implement `flowaibuilder.get_zones`:
    - Params: `{ workflow_id: z.string() }`.
    - `db.select().from(protectedZones).where(eq(protectedZones.workflowId, workflow_id))`.
    - Return `text({ zones: rows.map(serializeZone) })`.

- [x] Task 4: Register zone tools (AC: #10)
  - [x] 4.1 In `packages/server/src/mcp/index.ts`, import `registerZoneTools` from `./tools/zones.js`.
  - [x] 4.2 Call `registerZoneTools(server)` inside `createMcpServer()` after `registerAgentTeamTools(server)` and BEFORE `registerReviewTools(server)` (so review context already sees zones via direct DB read).
  - [x] 4.3 Verify `flowaibuilder.get_review_context` from Story 2.1 still returns `protected_zones` correctly — no changes needed there because it reads from `protectedZones` directly (see story 2-1 task 2.2 reference).

- [x] Task 5: Tests (AC: #12)
  - [x] 5.1 Create `packages/server/src/__tests__/zone-enforcer.test.ts`. Mirror the setup pattern of any existing test file in `packages/server/src/__tests__/` (use vitest, in-memory or test DB per the existing convention — inspect a sibling test before writing).
  - [x] 5.2 Cases (one `it()` block each):
    - `create_zone` happy path: creates row, returns zone object, validates broadcast was called.
    - `create_zone` rejects unknown node_ids.
    - `update_node` on pinned node throws zone error with the EXACT verb-substituted message.
    - `update_node` on non-pinned node still works.
    - `remove_node` on pinned node throws.
    - `disconnect_nodes` blocked when either endpoint is pinned (test both source-pinned and target-pinned).
    - `disconnect_nodes` allowed when neither endpoint pinned.
    - `get_workflow` / read paths return pinned nodes unchanged (no enforcer interference).
    - `delete_zone` removes row and subsequent `update_node` succeeds.
    - `add_to_zone` dedupes; `remove_from_zone` updates array.
    - `remove_from_zone` removing last node deletes the zone (broadcasts `zone_deleted`).
  - [x] 5.3 Mock `getBroadcaster()` (or import the broadcaster module and stub `broadcastToWorkflow`) to assert event emission without needing a live WebSocket.

## Dev Notes

### Existing primitives — DO NOT recreate
- **DB table already exists**: `protectedZones` is defined at `packages/server/src/db/schema.ts:140-153` with `id`, `workflowId`, `name`, `nodeIds` (jsonb), `color` (default `#378ADD`), `pinnedBy`, `pinnedAt`, `reason`, `canUnpin`. NO migration needed.
- **Shared type already exists**: `ProtectedZone` is exported at `packages/shared/src/types/zone.ts:1-11` and re-exported from `packages/shared/src/index.ts:37`. Use it for `serializeZone`'s return type — do NOT redefine.
- **Mutation handlers are already module-level functions**: `handleAddNode`, `handleUpdateNode`, `handleRemoveNode`, `handleConnectNodes`, `handleDisconnectNodes` in `packages/server/src/mcp/index.ts:49-243`. Both `server.tool(...)` callbacks AND `registerFixHandler(...)` (lines 500-504) call these — meaning enforcement added inside these functions automatically protects the `apply_fix` dispatcher path from Story 2.2. This is the intended seam (see comment at line 38).
- **Broadcaster API**: `getBroadcaster()?.broadcastToWorkflow(workflow_id, eventName, payload)` — used throughout `mcp/index.ts` (e.g. line 94). For zone events use exactly: `'zone_created'`, `'zone_updated'`, `'zone_deleted'`.
- **MCP tool file pattern**: Mirror `packages/server/src/mcp/tools/agent-teams.ts` for `registerZoneTools` and `mcpError` helper (see lines 16, 32 of that file). Mirror `packages/server/src/mcp/tools/review.ts` for any helper conventions you need.

### Error message format — EXACT string required
The error string in AC #2 is the literal contract Claude Code consumes to decide how to work around a zone. Implement once in `buildZoneError` and use the verb argument to swap `update`/`remove`/`disconnect`. Do not abbreviate, do not move punctuation, do not localize.

### Testing standards
- Test runner: vitest (already configured in `packages/server/package.json`).
- Test directory: `packages/server/src/__tests__/` (already used by stories 2.1/2.2).
- Read at least one existing test in that directory before writing new ones to match DB-setup conventions.

### Project Structure Notes
- New file: `packages/server/src/zones/enforcer.ts` (new `zones/` directory — single-file dir is fine for now; future zone-related server logic lives here).
- New file: `packages/server/src/mcp/tools/zones.ts` (sits alongside `agent-teams.ts` and `review.ts`).
- New file: `packages/server/src/__tests__/zone-enforcer.test.ts`.
- Modified: `packages/server/src/mcp/index.ts` — add 3 enforcer calls and 1 `registerZoneTools(server)` line + import.
- No UI changes in this story — Story 3.2 handles canvas UI / boundaries / lock icons / context menus.
- No REST routes added in this story — MCP-only per CLAUDE.md "MCP-first" principle. (UI in Story 3.2 will consume these via MCP-over-HTTP, the same way existing canvas pieces do.)
- No new dependencies. No `@anthropic-ai/sdk`. No DB migration.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.1: Zone CRUD & Server-Side Enforcement] (lines 568-603)
- [Source: _bmad-output/planning-artifacts/epics.md#FR31-FR37] Functional requirements 31-37 cover zones; this story implements FR31-FR34 (server side). FR35-FR37 (canvas UI) belong to Story 3.2.
- [Source: packages/server/src/db/schema.ts:140-153] `protectedZones` table definition.
- [Source: packages/shared/src/types/zone.ts] `ProtectedZone` interface.
- [Source: packages/server/src/mcp/index.ts:49-243] Existing mutation handlers — ZoneEnforcer hooks here.
- [Source: packages/server/src/mcp/index.ts:496-507] Tool registration site for `registerZoneTools`.
- [Source: packages/server/src/mcp/tools/agent-teams.ts:16,32] `mcpError` helper + `register*Tools` pattern.
- [Source: _bmad-output/implementation-artifacts/2-1-review-context-builder-core-mcp-tools.md] Story 2.1 already loads `protectedZones` for the review context — that integration stays as-is.
- [Source: CLAUDE.md "Protected Zones enforcement"] Project principle: every node write MUST check zones first via ZoneEnforcer.

## Dev Agent Record

### Agent Model Used

claude-opus-4-6

### Debug Log References

### Completion Notes List

- ZoneEnforcer module created at `packages/server/src/zones/enforcer.ts` with `getPinnedNodeIds`, `buildZoneError`, `assertNodeNotPinned`, `assertConnectionEndpointsNotPinned`. Error message format matches AC #2 verbatim with verb substitution.
- Wired enforcer into `handleUpdateNode`, `handleRemoveNode`, `handleDisconnectNodes` in `packages/server/src/mcp/index.ts`. Add/connect handlers untouched (per spec — pinned outputs accept new connections). Because the fix-dispatcher invokes the same module-level handlers, AC #11 is automatically satisfied.
- `handleDisconnectNodes` was restructured slightly to compute the connections-to-remove BEFORE the DB write, so the enforcer check runs before any mutation/broadcast.
- Five new MCP tools registered via `registerZoneTools` in `packages/server/src/mcp/tools/zones.ts`: `create_zone`, `delete_zone`, `add_to_zone`, `remove_from_zone`, `get_zones`. Pattern mirrors `tools/agent-teams.ts`.
- Tests in `packages/server/src/__tests__/zone-enforcer.test.ts` cover all 11 cases listed in AC #12 (13 `it()` blocks total). All pass. Pre-existing failures in `broadcaster.test.ts` (port collision) and `settings-and-audit.test.ts` are unrelated to this story.

### File List

- packages/server/src/zones/enforcer.ts (new)
- packages/server/src/mcp/tools/zones.ts (new)
- packages/server/src/__tests__/zone-enforcer.test.ts (new)
- packages/server/src/mcp/index.ts (modified — enforcer hooks + registerZoneTools)

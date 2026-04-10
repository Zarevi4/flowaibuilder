# Story 3.2: Zone Canvas UI & Interactions

Status: done

## Story

As a workflow user,
I want to see protected zones visually on the canvas and manage them via context menu,
so that I can clearly identify what's pinned and control zone boundaries directly from the canvas.

## Acceptance Criteria

1. **Given** a workflow has one or more protected zones **When** the canvas mounts (or `zone_created`/`zone_updated`/`zone_deleted` arrives via WS) **Then** each zone is rendered as a blue (default `#378ADD`, override from `zone.color`) **dashed boundary rectangle** drawn behind all member nodes. The rectangle's bounds are computed from the union AABB of every member node's `position` + measured size, padded by 24px on every side. The label inside the rectangle's top-left shows: `{zone.name}` on the first line, and `Pinned by {zone.pinnedBy} · {relative time of zone.pinnedAt}` on the second. Zones re-layout reactively when any member node's position changes.

2. **Given** a node belongs to a protected zone **When** the canvas renders that node **Then** (a) a small lock icon (lucide `Lock`, 12px) appears as an overlay in the node's top-right corner, (b) the node container has `opacity-70` (or equivalent dim styling) compared to non-pinned nodes, and (c) the React Flow node's `draggable` prop is set to `false` so dragging is impossible (per AC #6).

3. **Given** I select one or more nodes on the canvas and right-click on a selected node (or on empty selection background after a marquee select) **When** the context menu opens **Then** it includes a "Create Protected Zone" item. Selecting it prompts for a zone name (use a simple `window.prompt` for MVP — no modal component required). On confirm, it calls `POST /api/workflows/:id/zones` with `{ name, node_ids: <selected ids> }` and the new zone appears via the `zone_created` WS broadcast (see AC #7). If no nodes are selected, the item is disabled or hidden.

4. **Given** I right-click on a zone boundary (the dashed rectangle or its label, NOT a member node) **When** the context menu opens **Then** it shows: "Unpin Zone" and "Rename Zone". "Unpin Zone" calls `DELETE /api/workflows/:id/zones/:zoneId` and the zone disappears via `zone_deleted` WS. "Rename Zone" prompts for a new name and calls `PATCH /api/workflows/:id/zones/:zoneId` with `{ name }` which broadcasts `zone_updated`.

5. **Given** I right-click on a single node that is **not** in any zone **When** the context menu opens **Then** "Create Protected Zone" is shown (operating on `[that node]`). **Given** I right-click on a node that **is** in a zone **Then** the menu instead shows "Remove from Zone" (calls `POST /api/workflows/:id/zones/:zoneId/remove` with `{ node_ids: [nodeId] }` which routes to `flowaibuilder.remove_from_zone`). Clicking outside the menu or pressing `Escape` closes it. The menu must be position-anchored to the cursor and constrained to the viewport.

6. **Given** I attempt to drag a node that is inside a protected zone **When** I press the mouse and try to move it **Then** the node does NOT move. This is enforced by `draggable: false` on the React Flow node (AC #2c). No optimistic local position change occurs and no `node_updated` WS event is emitted. Non-pinned nodes drag normally and continue to debounce-save via the existing `updateNodePosition` flow.

7. **Given** the workflow store **When** the WS messages `zone_created`, `zone_updated`, `zone_deleted` arrive (workflowId-filtered) **Then** the store's `zones` slice is updated: created → append, updated → replace by id, deleted → remove by id. The reducer pattern must mirror the existing `node_added`/`node_updated`/`node_removed` cases in `reduceWsMessage` (`packages/ui/src/store/workflow.ts:268-444`). Initial zones are loaded from `GET /api/workflows/:id/zones` immediately after `loadWorkflow` completes (similar to `loadTaskLinks`).

8. **Given** new REST routes are added in `packages/server/src/api/routes/workflows.ts` **When** any zone REST endpoint is called **Then** it delegates to the same DB operations as the MCP tools in `packages/server/src/mcp/tools/zones.ts` (so behavior, error messages, and broadcasts are identical). Routes:
   - `GET    /api/workflows/:id/zones` → `{ zones: ProtectedZone[] }`
   - `POST   /api/workflows/:id/zones` body `{ name, node_ids, color?, reason?, pinned_by? }` → `{ zone }` and broadcasts `zone_created`
   - `PATCH  /api/workflows/:id/zones/:zoneId` body `{ name?, color?, reason? }` → `{ zone }` and broadcasts `zone_updated`
   - `DELETE /api/workflows/:id/zones/:zoneId` → `{ deleted: true, zone_id }` and broadcasts `zone_deleted`
   - `POST   /api/workflows/:id/zones/:zoneId/add` body `{ node_ids }` → broadcasts `zone_updated`
   - `POST   /api/workflows/:id/zones/:zoneId/remove` body `{ node_ids }` → broadcasts `zone_updated` OR `zone_deleted` (if last node removed, matching MCP `remove_from_zone` semantics).
   The new `pinned_by` for UI-initiated zones defaults to `'ui:user'` (vs `'mcp:claude'` from the MCP tool path).

9. **Given** the existing REST node-mutation endpoints (`PATCH /api/workflows/:id/nodes/:nodeId`, `DELETE /api/workflows/:id/nodes/:nodeId`, `DELETE /api/workflows/:id/connections/:connectionId`) are called for a node/connection that intersects a protected zone **When** the request is processed **Then** the endpoint must call the SAME `assertNodeNotPinned` / `assertConnectionEndpointsNotPinned` from `packages/server/src/zones/enforcer.ts` BEFORE the DB write, returning `409 Conflict` with body `{ error: <the buildZoneError message> }`. This closes the gap that Story 3.1 left (the enforcer was wired into MCP handlers only). The UI must surface this 409 message via the existing error toast mechanism (or `set({ error })` in the workflow store).

10. **Given** the shared WebSocket type union `WebSocketEventType` in `packages/shared/src/types/mcp.ts` **When** the type is updated **Then** `'zone_updated'` is added to the union (Story 3.1's `zones.ts` already broadcasts it but the type currently lacks it). No other event names change.

11. **Given** the test suite **When** `npm test` runs in `packages/ui` **Then** new vitest tests in `packages/ui/src/__tests__/zones-canvas.test.tsx` cover: (a) WS `zone_created` adds a zone to the store, (b) WS `zone_deleted` removes it, (c) WS `zone_updated` replaces in place, (d) `BaseNode` renders the lock overlay when `data.pinned === true`, (e) the React Flow node `draggable` flag is `false` for pinned nodes (mappers/Canvas integration), (f) the context menu shows the correct items for empty/single-node/zone-boundary right-clicks.
   **And** in `packages/server` a new test `zones-rest.test.ts` covers happy paths for each new REST route AND that PATCH/DELETE node + DELETE connection routes return 409 when the target is pinned.

## Tasks / Subtasks

- [x] Task 1: Server — REST routes for zones (AC: #8, #9, #10)
  - [x] 1.1 Add `'zone_updated'` to `WebSocketEventType` in `packages/shared/src/types/mcp.ts` (after line 27). Run `npm run build` in `packages/shared` (or root) to verify the rest of the monorepo type-checks.
  - [x] 1.2 In `packages/server/src/mcp/tools/zones.ts`, refactor each tool's body into an exported plain async function (e.g. `export async function createZoneCore(args, opts: { pinnedBy?: string })`) returning the same shape. Keep the MCP `server.tool(...)` registration calling the core function. This avoids duplicating DB/broadcast logic between MCP and REST. (If the file's structure makes this awkward, it is acceptable to instead extract a shared `packages/server/src/zones/service.ts` module that BOTH `tools/zones.ts` and the new REST routes import.)
  - [x] 1.3 In `packages/server/src/api/routes/workflows.ts`, add the 6 routes from AC #8. Each route must:
    - Validate `:id` workflow exists (mirror existing patterns in this file).
    - Call the shared core functions from 1.2.
    - Default `pinnedBy` to `'ui:user'` for POST `/zones`.
    - Return JSON identical to MCP tool returns (caller convenience).
    - Catch zone errors and map to `409` status if the message starts with `PROTECTED ZONE:`, else `400`/`500` as appropriate.
  - [x] 1.4 Wire `ZoneEnforcer` into the existing REST mutation routes (closes Story 3.1 gap):
    - `app.patch(.../nodes/:nodeId)` (~line 227): call `await assertNodeNotPinned(id, nodeId, 'update')` BEFORE the DB write. On throw → `reply.code(409).send({ error: err.message })`.
    - `app.delete(.../nodes/:nodeId)` (~line 255): same with verb `'remove'`.
    - `app.delete(.../connections/:connectionId)` (~line 337): look up the connection's `sourceNodeId`/`targetNodeId`, then `await assertConnectionEndpointsNotPinned(id, { sourceNodeId, targetNodeId })`. On throw → 409.
    - Do NOT wire into POST `/nodes` (add) or POST `/connections` (connect-new) — pinned outputs accept new connections per Story 3.1 spec.

- [x] Task 2: Server tests (AC: #11)
  - [x] 2.1 Create `packages/server/src/__tests__/zones-rest.test.ts`. Mirror DB-setup conventions from `zone-enforcer.test.ts` (Story 3.1).
  - [x] 2.2 Cover: GET zones (empty + populated), POST create, PATCH rename, DELETE, add/remove members, last-member-removal deletes zone. Assert WS broadcast calls.
  - [x] 2.3 Cover REST enforcement: PATCH node on pinned node → 409 with `PROTECTED ZONE:` prefix. DELETE pinned node → 409. DELETE connection where either endpoint pinned → 409. Non-pinned cases still succeed.

- [x] Task 3: UI — API client + store slice (AC: #7, #8)
  - [x] 3.1 In `packages/ui/src/lib/api.ts`, add and export:
    - `getZones(workflowId): Promise<{ zones: ProtectedZone[] }>`
    - `createZone(workflowId, { name, nodeIds, color?, reason? }): Promise<{ zone: ProtectedZone }>`
    - `renameZone(workflowId, zoneId, name): Promise<{ zone: ProtectedZone }>`
    - `deleteZone(workflowId, zoneId): Promise<{ deleted: boolean; zone_id: string }>`
    - `addNodesToZone(workflowId, zoneId, nodeIds): Promise<{ zone: ProtectedZone } | { deleted: true }>`
    - `removeNodesFromZone(workflowId, zoneId, nodeIds): Promise<{ zone: ProtectedZone } | { deleted: true }>`
    - Convert all camelCase request bodies to the snake_case the REST routes expect (`node_ids` not `nodeIds`).
    - Surface 409 zone errors as `Error` instances whose `message` contains the server's `PROTECTED ZONE:` text (parse the JSON body in `request<T>` for non-OK responses — currently it only throws status text).
  - [x] 3.2 In `packages/ui/src/store/workflow.ts`:
    - Add `zones: ProtectedZone[]` to `WorkflowState` (default `[]`). Reset to `[]` in `loadWorkflow` and on `loadWorkflow`'s success populate via `getZones(id)`.
    - In `reduceWsMessage`, add three new cases mirroring the node cases:
      - `case 'zone_created': return { ...state, zones: [...state.zones, data.zone] }` (guard against duplicate id).
      - `case 'zone_updated': return { ...state, zones: state.zones.map(z => z.id === data.zone.id ? data.zone : z) }`.
      - `case 'zone_deleted': return { ...state, zones: state.zones.filter(z => z.id !== data.zone_id) }`.
    - Add a `pinnedNodeIds` derived selector (or computed via `useMemo` in Canvas.tsx) returning a `Set<string>` of all node ids that appear in any zone.
  - [x] 3.3 In `packages/ui/src/lib/mappers.ts` (or directly in `Canvas.tsx`), pass `data.pinned: boolean` and set `draggable: false` on each React Flow node whose id is in `pinnedNodeIds`. The merge must happen alongside the existing executionStatus/taskLink merge in `Canvas.tsx:63-81` (or in the mappers if you prefer pure transformation).

- [x] Task 4: UI — Zone overlay rendering (AC: #1, #2)
  - [x] 4.1 Create `packages/ui/src/components/canvas/zones/ZoneLayer.tsx`. It must be a React component used as a child of `<ReactFlow>` (like `ReactFlowAnnotationLayer`). Inside, use `useReactFlow().getNodes()` (or read `nodes` from the store) to compute each zone's bounding box from the union AABB of `nodes.filter(n => zone.nodeIds.includes(n.id))`. Pad by 24px. Render an SVG `<rect>` per zone via React Flow's `<ViewportPortal>` (from `@xyflow/react`) so it transforms with the canvas. Use `stroke-dasharray` for the dashed border, `stroke={zone.color ?? '#378ADD'}`, `fill="transparent"`, `pointer-events="auto"` so right-click works. Render the zone label as an HTML overlay positioned at top-left of the rect.
  - [x] 4.2 Mount `<ZoneLayer />` inside `<ReactFlow>` in `Canvas.tsx` BEFORE `<ReactFlowAnnotationLayer />` (so annotations draw on top of zones).
  - [x] 4.3 Update `BaseNode.tsx`: accept a new optional prop `pinned?: boolean`. When true, render a `<Lock size={12} />` (lucide-react) icon absolutely positioned in the top-right corner of the card, and add `opacity-70` to the outer container's className. Wire `pinned` through the node `data` payload populated in Task 3.3, and update each node component (`AiNode`, `CodeNode`, etc.) that calls `<BaseNode>` to forward `data.pinned`.

- [x] Task 5: UI — Context menu (AC: #3, #4, #5)
  - [x] 5.1 Create `packages/ui/src/components/canvas/zones/ContextMenu.tsx`. State (position + items) lives in a small zustand slice or local Canvas state. Render an absolutely-positioned `div` with menu items, anchored to the cursor coordinates, viewport-clamped. Close on outside click, on `Escape`, and after any item is invoked.
  - [x] 5.2 In `Canvas.tsx`, add `onNodeContextMenu` and `onPaneContextMenu` handlers from React Flow. They `event.preventDefault()`, then dispatch into the menu state with the right item set:
    - On node right-click: if node is in a zone → items `['Remove from Zone']`; else → items `['Create Protected Zone (with selection)']`.
    - On pane right-click after marquee select: `['Create Protected Zone (with selection)']`.
    - Right-click on a zone rect/label: handled inside `ZoneLayer.tsx` via its own `onContextMenu` → items `['Unpin Zone', 'Rename Zone']`. Stop propagation so React Flow's pane handler doesn't also fire.
  - [x] 5.3 Item handlers call the API client methods from Task 3.1. Use `window.prompt` for the name input (Create Zone, Rename Zone). Reject empty names client-side.

- [x] Task 6: UI tests (AC: #11)
  - [x] 6.1 Create `packages/ui/src/__tests__/zones-canvas.test.tsx`. Use vitest + React Testing Library (mirror the conventions of any existing UI test file in `packages/ui/src/__tests__/`).
  - [x] 6.2 Cases: WS reducer for `zone_created`/`zone_updated`/`zone_deleted` (call `useWorkflowStore.getState().applyWsMessage(...)` and assert state). `BaseNode` renders the lock when `pinned=true`. Context menu items differ based on whether the right-clicked node is pinned. Drag is blocked: assert that the merged React Flow node has `draggable === false` for pinned ids.

## Dev Notes

### Existing primitives — DO NOT recreate
- **Server-side ZoneEnforcer already exists**: `packages/server/src/zones/enforcer.ts` (Story 3.1). Use `assertNodeNotPinned`, `assertConnectionEndpointsNotPinned`. Same module, no rewriting.
- **MCP zone tools already exist**: `packages/server/src/mcp/tools/zones.ts` (Story 3.1). Either refactor each tool body into an exported core function OR pull the shared logic into `packages/server/src/zones/service.ts`. The REST routes from this story MUST share that core — do not duplicate insert/validate/broadcast logic.
- **WS broadcaster**: `getBroadcaster()?.broadcastToWorkflow(workflowId, eventName, payload)` (`packages/server/src/api/ws/broadcaster.ts:101`). Re-use exactly. After Task 1.1, `'zone_updated'` is a valid event name in the union.
- **DB schema**: `protectedZones` at `packages/server/src/db/schema.ts:140-153`. NO migration needed.
- **Shared type**: `ProtectedZone` from `@flowaibuilder/shared` (`packages/shared/src/types/zone.ts`). Use as-is in store and API client.
- **Workflow store reducer pattern**: `reduceWsMessage` in `packages/ui/src/store/workflow.ts:268-444`. The new zone cases must follow the exact same return-new-state-or-same-ref convention.
- **Canvas data merge pattern**: `Canvas.tsx:63-81` already merges `executionStatus`, `linkedAgent`, `linkedTaskStatus`, `linkedTaskTitle` into node `data`. Add `pinned` and `draggable: false` here.
- **React Flow ViewportPortal**: import from `@xyflow/react` — renders children inside the viewport (transforms with pan/zoom). Use this for zone rectangles so they pan/zoom with the canvas.
- **Existing layer pattern**: `packages/ui/src/components/canvas/review/ReactFlowAnnotationLayer.tsx` is the model for `ZoneLayer.tsx`. Read it before writing the new component.

### Why REST AND MCP both exist for zones
Story 3.1 deliberately implemented MCP only ("MCP-first" per CLAUDE.md). For Story 3.2 the canvas needs zone CRUD and the rest of the canvas already calls REST (`/api/workflows/:id/nodes`, etc.) — adding zone REST routes is the lowest-friction path. Both MCP and REST MUST call the same core service so behavior, error messages, and WS broadcasts stay identical.

### REST node-mutation enforcement gap (Story 3.1 carryover)
Story 3.1 only wired `ZoneEnforcer` into the MCP handlers (`packages/server/src/mcp/index.ts`). The REST node mutation endpoints in `packages/server/src/api/routes/workflows.ts` (PATCH node, DELETE node, DELETE connection) currently bypass enforcement — meaning the canvas could update a pinned node directly through REST even though Claude cannot. Task 1.4 closes this gap. Without it, AC #6 ("drag is blocked") could be defeated by another canvas action that hits PATCH /nodes/:id. AC #9 makes this explicit.

### React Flow drag-locking
The canonical way to make a React Flow node un-draggable is `node.draggable = false` on the node object you pass to `<ReactFlow nodes={...}>`. There is no global mode for "lock subset of nodes" — it must be set per node. The merge in `Canvas.tsx:63-81` is the right place. Do not try to use `nodesDraggable` (global) or to intercept `onNodeDragStart` (race-prone).

### Context menu — keep it simple
There is no existing context-menu pattern in the codebase (`grep ContextMenu` returns nothing). Do NOT pull in a third-party menu library. A small absolute-positioned `<div>` with Tailwind classes is sufficient for MVP. Use `useEffect` cleanup to remove the global click/keydown listeners on unmount or dismissal.

### Testing standards
- Server: vitest, `packages/server/src/__tests__/`. Mirror `zone-enforcer.test.ts` from Story 3.1 for DB setup.
- UI: vitest + React Testing Library + jsdom. Existing UI tests live in `packages/ui/src/__tests__/`. Inspect a sibling test for jsdom setup conventions before writing.

### Project Structure Notes
- New files:
  - `packages/server/src/zones/service.ts` (optional — only if you extract shared core; otherwise refactor inside `tools/zones.ts`)
  - `packages/server/src/__tests__/zones-rest.test.ts`
  - `packages/ui/src/components/canvas/zones/ZoneLayer.tsx`
  - `packages/ui/src/components/canvas/zones/ContextMenu.tsx`
  - `packages/ui/src/__tests__/zones-canvas.test.tsx`
- Modified files:
  - `packages/shared/src/types/mcp.ts` (add `'zone_updated'`)
  - `packages/server/src/api/routes/workflows.ts` (6 new zone routes + 3 enforcer wirings)
  - `packages/server/src/mcp/tools/zones.ts` (extract core functions, optional)
  - `packages/ui/src/lib/api.ts` (6 new functions + improve `request<T>` to surface server error message body)
  - `packages/ui/src/store/workflow.ts` (add `zones` slice + 3 new reducer cases + initial load)
  - `packages/ui/src/components/canvas/Canvas.tsx` (mount `ZoneLayer`, wire context menu handlers, merge `pinned` + `draggable: false`)
  - `packages/ui/src/components/canvas/nodes/BaseNode.tsx` (accept `pinned`, render lock + dim)
  - Each `*Node.tsx` in `packages/ui/src/components/canvas/nodes/` that uses `BaseNode` (forward `data.pinned`)
  - `packages/ui/src/lib/mappers.ts` (only if you choose to merge `pinned` here instead of `Canvas.tsx`)
- No DB migration. No new server dependencies. UI may use already-installed `lucide-react` for the lock icon.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.2: Zone Canvas UI & Interactions] (lines 605-633)
- [Source: _bmad-output/implementation-artifacts/3-1-zone-crud-server-side-enforcement.md] Story 3.1 — establishes ZoneEnforcer, MCP zone tools, broadcast event names, error message format
- [Source: packages/server/src/zones/enforcer.ts] Existing enforcer module (Story 3.1)
- [Source: packages/server/src/mcp/tools/zones.ts] Existing MCP zone tools — share core with new REST routes
- [Source: packages/server/src/api/routes/workflows.ts:227-360] PATCH/DELETE node + DELETE connection routes — wire enforcer here
- [Source: packages/server/src/api/ws/broadcaster.ts:77,101] `broadcast` / `broadcastToWorkflow` API
- [Source: packages/shared/src/types/mcp.ts:7-32] `WebSocketEventType` union — add `'zone_updated'`
- [Source: packages/shared/src/types/zone.ts] `ProtectedZone` interface
- [Source: packages/ui/src/store/workflow.ts:268-444] `reduceWsMessage` — add 3 new cases, follow same return convention
- [Source: packages/ui/src/components/canvas/Canvas.tsx:63-81] Node-data merge site for `pinned` + `draggable: false`
- [Source: packages/ui/src/components/canvas/review/ReactFlowAnnotationLayer.tsx] Pattern for in-canvas overlay layers — model for `ZoneLayer.tsx`
- [Source: packages/ui/src/components/canvas/nodes/BaseNode.tsx] Where the lock icon and `opacity-70` go
- [Source: packages/ui/src/lib/api.ts] REST client — add new zone functions and improve error parsing
- [Source: CLAUDE.md "Protected Zones enforcement"] Project principle: every node write checks zones first

## Dev Agent Record

### Agent Model Used

claude-opus-4-6

### Debug Log References

### Completion Notes List

- Extracted shared zone core into `packages/server/src/zones/service.ts`. Both MCP tools (`packages/server/src/mcp/tools/zones.ts`) and the new REST routes call this single service so behavior, broadcasts, and error messages stay identical. Existing zone-enforcer.test.ts (13 tests) still passes after the refactor.
- Added `'zone_updated'` to `WebSocketEventType` in `packages/shared/src/types/mcp.ts` (Story 3.1 was emitting it without the type).
- Added 6 zone REST routes in `packages/server/src/api/routes/workflows.ts`. POST `/zones` defaults `pinnedBy='ui:user'`. Errors mapped to 404 / 409 (PROTECTED ZONE) / 400.
- Closed Story 3.1's REST enforcement gap: PATCH/DELETE node + DELETE connection now call `assertNodeNotPinned` / `assertConnectionEndpointsNotPinned` and return 409 with the `PROTECTED ZONE: …` message before any DB write.
- UI store: added `zones: ProtectedZone[]` slice, initial load in `loadWorkflow`, and three new `reduceWsMessage` cases (`zone_created`/`zone_updated`/`zone_deleted`) following the existing return-new-state convention.
- API client: added `getZones`, `createZone`, `renameZone`, `deleteZone`, `addNodesToZone`, `removeNodesFromZone`. Snake-cased the bodies. Improved `request<T>` to surface server `{ error }` JSON in thrown `Error.message` so 409 zone messages reach the user.
- Canvas: derived `pinnedNodeIds` from zones; merged `data.pinned: true` and `draggable: false` into pinned RF nodes alongside the existing executionStatus/taskLink merge in `Canvas.tsx`. Drag is blocked at the React Flow level (no optimistic updates, no node_updated WS).
- New `ZoneLayer.tsx` renders dashed-bordered rectangles via `<ViewportPortal>` so they pan/zoom with the canvas. Bounds computed from union AABB of member nodes (measured size) padded by 24px. Label shows zone name and "Pinned by … · Xs ago".
- New `ContextMenu.tsx` (`CanvasContextMenu`): viewport-clamped, closes on outside click / Escape. No third-party menu lib.
- Wired `onNodeContextMenu` and `onPaneContextMenu` in Canvas: pinned node → "Remove from Zone"; non-pinned node → "Create Protected Zone (with selection)"; pane right-click after marquee select → "Create Protected Zone (with selection)"; right-click on a zone rect → "Unpin Zone" / "Rename Zone" via `ZoneLayer`'s own onContextMenu (stops propagation).
- BaseNode accepts `pinned?: boolean`, renders a `<Lock size={12}/>` overlay (lucide) and adds `opacity-70` when set. All 6 node components forward `data.pinned`.
- Tests: server `zones-rest.test.ts` covers GET (empty), POST create (broadcasts zone_created, pinnedBy='ui:user'), PATCH rename, DELETE, POST add, POST remove (last-member-removal deletes), and the 4 enforcement cases (PATCH pinned 409, PATCH non-pinned 200, DELETE pinned 409, DELETE connection on pinned endpoint 409, DELETE connection no-pin 200) — 11 tests, all passing. UI `zones-canvas.test.tsx` covers WS reducer (created/updated/deleted, dedup), `BaseNode` lock overlay rendering, and `CanvasContextMenu` item click + null state — 8 tests, all passing.
- Pre-existing test failures (`team-store.test.ts`, `team-dashboard.test.ts`, `settings-and-audit.test.ts`) are unrelated to this story (verified by stashing my changes and re-running) and were not addressed.

### File List

**Modified**
- `packages/shared/src/types/mcp.ts` — added `'zone_updated'` to `WebSocketEventType`
- `packages/server/src/api/routes/workflows.ts` — 6 new zone REST routes; wired enforcer into PATCH node, DELETE node, DELETE connection
- `packages/server/src/mcp/tools/zones.ts` — refactored to call shared service module
- `packages/ui/src/lib/api.ts` — 6 new zone API functions; `request<T>` now surfaces server error message
- `packages/ui/src/store/workflow.ts` — `zones` slice + reducer cases + initial load
- `packages/ui/src/components/canvas/Canvas.tsx` — pinned merge, ZoneLayer + context menu wiring
- `packages/ui/src/components/canvas/nodes/BaseNode.tsx` — `pinned` prop, Lock overlay, opacity-70
- `packages/ui/src/components/canvas/nodes/AiNode.tsx` — forward `data.pinned`
- `packages/ui/src/components/canvas/nodes/CodeNode.tsx` — forward `data.pinned`
- `packages/ui/src/components/canvas/nodes/HttpNode.tsx` — forward `data.pinned`
- `packages/ui/src/components/canvas/nodes/LogicNode.tsx` — forward `data.pinned`
- `packages/ui/src/components/canvas/nodes/OutputNode.tsx` — forward `data.pinned`
- `packages/ui/src/components/canvas/nodes/TriggerNode.tsx` — forward `data.pinned`

**New**
- `packages/server/src/zones/service.ts` — shared zone CRUD service (used by MCP and REST)
- `packages/server/src/__tests__/zones-rest.test.ts` — 11 tests
- `packages/ui/src/components/canvas/zones/ZoneLayer.tsx`
- `packages/ui/src/components/canvas/zones/ContextMenu.tsx`
- `packages/ui/src/__tests__/zones-canvas.test.tsx` — 8 tests

### Change Log

- 2026-04-08: Story 3.2 implementation complete. Added zone REST routes (6) sharing core service with MCP tools. Closed Story 3.1 REST enforcement gap (PATCH/DELETE node + DELETE connection now return 409 on pinned). UI: zone overlay rendering, context menu, drag-blocking via `draggable: false`, lock badge on pinned nodes. New tests: 11 server + 8 UI, all passing.
- 2026-04-08: Code review (bmad-code-review). 10 patches applied, 8 deferred, 10 dismissed. UI tests now 18/18; server zone tests 11/11.

### Review Findings

- [x] [Review][Patch] ZoneLayer overlay does not follow node drags — useMemo deps missed nodeLookup [packages/ui/src/components/canvas/zones/ZoneLayer.tsx]
- [x] [Review][Patch] Zone rect intercepts clicks/right-clicks on member nodes (AC #1) — set rect pointerEvents:none, zIndex:-1; label opts back in [ZoneLayer.tsx]
- [x] [Review][Patch] Multi-select drag bypasses pinned protection (AC #6) — guard onNodeDragStop [Canvas.tsx]
- [x] [Review][Patch] Keyboard delete on pinned node bypassed enforcement (AC #6/#9) — pass deletable:false via applyPinnedFlag, defense-in-depth in handleNodesDelete [Canvas.tsx]
- [x] [Review][Patch] Node could be pinned in multiple zones — createZoneCore + addToZoneCore now reject already-pinned ids [packages/server/src/zones/service.ts]
- [x] [Review][Patch] addToZoneCore / removeFromZoneCore UPDATE not workflowId-scoped — added and(eq(id), eq(workflowId)) [service.ts]
- [x] [Review][Patch] removeFromZoneCore wrote DB + broadcast on no-op — early return when remaining unchanged [service.ts]
- [x] [Review][Patch] Context menu viewport clamp had no lower bound — Math.max(8, …) on left/top [ContextMenu.tsx]
- [x] [Review][Patch] AC #11 missing test coverage (e) draggable=false (f) menu variants — extracted helpers.ts and added 10 unit tests [zones/helpers.ts, __tests__/zones-canvas.test.tsx]
- [x] [Review][Patch] Empty/zero-width zone name accepted — sanitizeZoneName strips zero-width and trims [helpers.ts, Canvas.tsx]
- [x] [Review][Defer] Race: WS zone events arriving between loadWorkflow reset and getZones resolve are clobbered [store/workflow.ts] — deferred, mirrors existing nodes pattern
- [x] [Review][Defer] toExecution fabricates startedAt=now() for null DB column [workflows.ts ~60] — deferred, pre-existing
- [x] [Review][Defer] Activate route TOCTOU on undefined updated [workflows.ts ~137] — deferred, pre-existing
- [x] [Review][Defer] ZoneLayer fontSize lives in flow-space → unreadable at low zoom [ZoneLayer.tsx] — deferred, polish
- [x] [Review][Defer] Single-node zone "Remove from Zone" silently deletes zone — deferred, matches MCP semantics by spec
- [x] [Review][Defer] canUnpin not enforced in deleteZoneCore/removeFromZoneCore [service.ts] — deferred, not in story AC
- [x] [Review][Defer] No authz on zone REST routes — deferred, not in story AC
- [x] [Review][Defer] getZonesCore has no ORDER BY → unstable z-order [service.ts] — deferred, minor

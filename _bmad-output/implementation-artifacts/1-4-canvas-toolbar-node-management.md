# Story 1.4: Canvas Toolbar & Node Management

Status: done

## Story

As a workflow user,
I want a toolbar to add new nodes and trigger common actions,
so that I can build workflows visually without using the CLI.

## Acceptance Criteria

1. **Given** the canvas editor is open **When** I click the "Add Node" button in the toolbar **Then** a dropdown appears with node categories (Triggers, Logic, Integration, Output) and node types within each

2. **Given** I select a node type from the dropdown **When** the node is created **Then** it appears on the canvas at a sensible default position using the auto-layout algorithm **And** the new node is persisted to the server

3. **Given** I select a node and press Delete or use the context menu **When** the node is removed **Then** it disappears from the canvas, its connections are cleaned up, and the deletion is persisted

4. **Given** I drag from one node's output handle to another node's input handle **When** I release **Then** a connection (edge) is created between them and persisted to the server

## Tasks / Subtasks

- [x] Task 1: Add REST API endpoints for node deletion and connection management (AC: #3, #4)
  - [x]1.1 Add `DELETE /api/workflows/:id/nodes/:nodeId` route — remove node + cleanup connections + broadcast `node_removed`
  - [x]1.2 Add `POST /api/workflows/:id/connections` route — create connection + broadcast `connection_added`
  - [x]1.3 Add `DELETE /api/workflows/:id/connections/:connectionId` route — remove connection + broadcast `connection_removed`
- [x] Task 2: Extend API client and Zustand store with node/connection CRUD (AC: #2, #3, #4)
  - [x]2.1 Add `addNode`, `deleteNode`, `addConnection`, `deleteConnection` to `lib/api.ts`
  - [x]2.2 Add `addNode`, `removeNode`, `onConnect` actions to `useWorkflowStore`
- [x] Task 3: Build the Canvas Toolbar component (AC: #1, #2)
  - [x]3.1 Create `components/toolbar/CanvasToolbar.tsx` with "Add Node" button + category dropdown
  - [x]3.2 Create `components/toolbar/AddNodeDropdown.tsx` — grouped by NODE_CATEGORIES, items from NODE_TYPES, click adds node
  - [x]3.3 Wire toolbar into Editor.tsx layout (positioned above canvas)
- [x] Task 4: Implement node deletion (AC: #3)
  - [x]4.1 Add Delete/Backspace keyboard handler on canvas (only when a node is selected, NOT when typing in sidebar)
  - [x]4.2 Add "Delete Node" button to NodeConfigSidebar
  - [x]4.3 Wire deletion to store action → REST DELETE → WS broadcast cleanup
- [x] Task 5: Implement edge creation via drag (AC: #4)
  - [x]5.1 Add `onConnect` handler to Canvas.tsx ReactFlow — persist new connection to server
  - [x]5.2 Ensure handle IDs follow existing convention: `input-0`, `output-0` (multi-output nodes: `output-0`, `output-1`)
- [x] Task 6: Tests (all ACs)
  - [x]6.1 Test toolbar rendering and dropdown interaction
  - [x]6.2 Test addNode/removeNode/onConnect store actions
  - [x]6.3 Test new API endpoints (server-side)
  - [x]6.4 Test keyboard delete handler (fires only when canvas focused)

## Dev Notes

### Server-Side: Existing Infrastructure

The server already has MCP tools for all node/connection operations. REST endpoints are partially implemented:

**Already exists:**
- `POST /api/workflows/:id/nodes` — adds node with auto-position (below last node, y+150) and optional `connectAfter`
- `PATCH /api/workflows/:id/nodes/:nodeId` — update name/config/disabled
- `PUT /api/workflows/:id` — full workflow update (can update nodes/connections arrays)

**Missing — must create:**
- `DELETE /api/workflows/:id/nodes/:nodeId` — remove node + cleanup connections. Copy logic from MCP `remove_node` tool (mcp/index.ts:158-184): filter node from nodes array, filter connections touching that node, save, broadcast `node_removed`.
- `POST /api/workflows/:id/connections` — create a connection. Copy logic from MCP `connect_nodes` (mcp/index.ts:186-220): create Connection with nanoid, push to connections array, save, broadcast `connection_added`.
- `DELETE /api/workflows/:id/connections/:connectionId` — remove a connection. Copy logic from MCP `disconnect_nodes` (mcp/index.ts:310-350): filter by connection_id, save, broadcast `connection_removed`.

### Auto-Layout Algorithm

The existing `add_node` (both MCP and REST) places new nodes below the last node:
```typescript
const lastNode = nodes[nodes.length - 1];
const position = lastNode
  ? { x: lastNode.position.x, y: lastNode.position.y + 150 }
  : { x: 250, y: 100 };
```
This is sufficient for MVP. Do NOT overcomplicate with a full graph layout engine.

### Shared Constants (use these, do NOT hardcode)

Import from `@flowaibuilder/shared`:
- `NODE_TYPES` — Record<string, NodeTypeMetadata> with type, category, label, description, color, icon, inputs, outputs
- `NODE_CATEGORIES` — `{ trigger, logic, integration, output }` each with label and color

NODE_CATEGORIES keys match NODE_TYPES[x].category values. Group dropdown items by iterating NODE_TYPES and grouping by `.category`.

### UI Architecture Patterns (from previous stories)

**File locations — follow exactly:**
- New components: `packages/ui/src/components/toolbar/CanvasToolbar.tsx`, `AddNodeDropdown.tsx`
- Store changes: `packages/ui/src/store/workflow.ts`
- API additions: `packages/ui/src/lib/api.ts`
- Server routes: `packages/server/src/api/routes/workflows.ts`
- Tests: `packages/ui/src/__tests__/`, `packages/server/src/__tests__/`

**Zustand 5 pattern** (MUST follow — from store/workflow.ts):
```typescript
export const useWorkflowStore = create<WorkflowState>()((set, get) => ({
  // state...
  actionName: async (params) => {
    const { workflow } = get();
    if (!workflow) return;
    // optimistic update via set({...})
    // then async server call
  },
}));
```

**Optimistic update + debounced save pattern** (established in stories 1.1-1.3):
- Node add/delete: NO debounce — immediate server call (these are discrete user actions, not continuous editing)
- Connection create: NO debounce — immediate server call
- The existing debounce pattern is for position/config which change continuously

**API client pattern** (lib/api.ts):
```typescript
export async function addNode(workflowId: string, body: { type: string; name: string; config?: Record<string, unknown> }): Promise<{ node: WorkflowNode; position: { x: number; y: number } }> {
  return request(`/workflows/${workflowId}/nodes`, { method: 'POST', body: JSON.stringify(body) });
}
```

**Icons** — use `lucide-react` (already installed). Icon names are in NODE_TYPES[x].icon. Resolve via the existing `lib/icons.ts` pattern.

### Canvas Integration

**ReactFlow `onConnect` handler** — this is the standard React Flow way to handle edge creation:
```typescript
const onConnect = useCallback((params: Connection) => {
  // params has: source, target, sourceHandle, targetHandle
  storeAction(params);
}, []);
// Pass to <ReactFlow onConnect={onConnect} />
```

**Keyboard delete** — React Flow fires `onNodesDelete` / `onEdgesDelete` callbacks. BUT be careful: only handle delete when canvas is focused, NOT when user is typing in sidebar inputs or Monaco editor. Check `document.activeElement` or use React Flow's built-in `deleteKeyCode` prop:
```typescript
<ReactFlow deleteKeyCode={['Delete', 'Backspace']} onNodesDelete={handleNodesDelete} />
```
React Flow handles focus correctly — delete only fires when the canvas pane is focused, not when typing in inputs.

**Handle IDs** — existing nodes use explicit handle IDs: `input-0`, `output-0`. Multi-output nodes (if, switch) use `output-0`, `output-1`, etc. This is defined in BaseNode.tsx. The connection params from onConnect will include these handle IDs.

### Editor Layout

Current Editor.tsx structure:
```tsx
<div className="flex-1 flex h-full">
  <div className="flex-1 relative">
    <Canvas />
    <div className="absolute top-2 right-2">WS status indicator</div>
  </div>
  {selectedNodeId && <NodeConfigSidebar />}
</div>
```

Add toolbar as an absolute-positioned overlay at the top-left of the canvas area (like the existing WS status indicator at top-right). Do NOT restructure the flex layout. Example:
```tsx
<div className="flex-1 relative">
  <Canvas />
  <CanvasToolbar className="absolute top-2 left-2" />
  <div className="absolute top-2 right-2">WS status indicator</div>
</div>
```

### Dropdown Behavior

- Click "Add Node" → dropdown opens with categories as group headers
- Each category shows its node types with icon + label
- Click a node type → calls `addNode` store action → dropdown closes
- Click outside → dropdown closes
- Use simple state (`useState<boolean>`) for open/close — no need for a dropdown library

### Delete Button in Sidebar

Add a "Delete Node" button at the bottom of `NodeConfigSidebar.tsx`. Style: red/destructive, full-width. On click: call `removeNode` store action, then `selectNode(null)` to close sidebar.

### WebSocket Round-Trip

The store already handles `node_added`, `node_removed`, `connection_added`, `connection_removed` in the `reduceWsMessage` function (workflow.ts:157-294). After the REST call, the server broadcasts the event, and ALL clients (including the originator) receive the WS message. The reducer applies it.

For the originating client: the optimistic update has already applied the change locally. The WS message arrives and the reducer applies it again, but since the data matches, there's no visible glitch. This is the same pattern used for position updates (feedback loop prevention via position comparison). For node add/remove, duplicates won't occur because:
- `node_added`: adds to array. If we optimistically added already, the WS handler will add a duplicate. **IMPORTANT**: Either (a) don't optimistic-add for node creation (just wait for WS), or (b) check for duplicate node ID in the `node_added` reducer. Option (a) is simpler — the server responds in <100ms, so the UX is fine without optimistic add.
- `node_removed`: filters by ID, so applying twice is harmless (second filter is a no-op).
- `connection_added`: same duplicate risk as node_added. Use same approach.
- `connection_removed`: same as node_removed, safe to apply twice.

**Recommendation**: For add operations, do NOT use optimistic updates. Call the server, let the WS broadcast update the local state. This avoids duplicate handling complexity.

### Styling

Follow existing patterns:
- Dark theme: `bg-gray-900`, `bg-gray-800`, `border-gray-700`, `text-gray-300`
- Hover: `hover:bg-gray-700`
- Active/selected: purple accent (`bg-purple-600`, `text-purple-400`)
- Buttons: rounded, small padding (`px-3 py-1.5 text-sm rounded-lg`)
- Category headers in dropdown: `text-xs uppercase tracking-wider text-gray-500`
- Use the category colors from NODE_CATEGORIES for category headers or node type icons

### CSS Class

The project uses Tailwind 4 with `@import "tailwindcss"` in index.css. A custom `.input-field` utility class exists for form inputs. No component library — all hand-rolled with Tailwind classes.

### Project Structure Notes

- All paths, modules, and naming conventions align with the unified project structure
- New files go in `components/toolbar/` (empty dir already exists)
- Exports follow named export pattern (no default exports)
- TypeScript strict mode enabled

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.4] — Acceptance criteria
- [Source: _bmad-output/planning-artifacts/architecture.md] — DB schema, API patterns, WebSocket protocol
- [Source: packages/server/src/api/routes/workflows.ts] — Existing REST routes
- [Source: packages/server/src/mcp/index.ts:69-220,310-350] — MCP add_node, remove_node, connect_nodes, disconnect_nodes logic to replicate in REST
- [Source: packages/shared/src/constants/node-types.ts] — NODE_TYPES and NODE_CATEGORIES constants
- [Source: packages/ui/src/store/workflow.ts] — Zustand store with WS reducer
- [Source: packages/ui/src/components/canvas/Canvas.tsx] — Current ReactFlow setup
- [Source: packages/ui/src/pages/Editor.tsx] — Editor layout
- [Source: packages/ui/src/lib/api.ts] — API client pattern
- [Source: 1-3-node-config-sidebar-code-editor.md] — Previous story learnings (stale closure, debounce cleanup, PATCH merge)

### Review Findings

- [x] [Review][Decision] **D1: removeNode has no rollback on API failure** — Resolved: option (b) — accept and rely on WS full_sync to recover. Error toast added via store error state. [store/workflow.ts]

- [x] [Review][Patch] **P1: WS `node_added` reducer has no duplicate guard** — Fixed: added ID dedup check before appending. [store/workflow.ts]
- [x] [Review][Patch] **P2: WS `connection_added` reducer has no duplicate guard** — Fixed: added ID dedup check before appending. [store/workflow.ts]
- [x] [Review][Patch] **P3: `sentToSubscribers` dead variable in broadcaster** — Fixed: removed dead variable. [server/api/ws/broadcaster.ts]
- [x] [Review][Patch] **P4: No error feedback when addNode/onConnect/removeNode API calls fail** — Fixed: added try/catch with error state on all three actions. [store/workflow.ts]
- [x] [Review][Patch] **P5: POST /connections allows dangling refs to non-existent nodes** — Fixed: added node existence validation. [server/api/routes/workflows.ts]
- [x] [Review][Patch] **P6: POST /connections allows self-referential connections** — Fixed: reject sourceNodeId === targetNodeId with 400. [server/api/routes/workflows.ts]
- [x] [Review][Patch] **P7: POST /connections allows duplicate connections** — Fixed: check for existing identical connection, return 409. [server/api/routes/workflows.ts]
- [x] [Review][Patch] **P8: connId coercion bug in connection_added reducer** — Fixed: changed `as string ||` to `?? ` (nullish coalescing). [store/workflow.ts]
- [x] [Review][Patch] **P9: Concurrent updateNodeConfig debounce drops saves for different nodes** — Fixed: replaced single timeout with per-node Map of timers. [store/workflow.ts]
- [x] [Review][Patch] **P10: Debounce timeouts not cleared on Editor unmount** — Fixed: exported `cancelPendingSaves()`, called in Editor cleanup. [store/workflow.ts, pages/Editor.tsx]

- [x] [Review][Defer] **W1: Race condition: read-modify-write without DB locking** [server/api/routes/workflows.ts] — deferred, pre-existing architectural pattern across all endpoints
- [x] [Review][Defer] **W2: No input validation/schema on request bodies** [server/api/routes/workflows.ts] — deferred, pre-existing pattern
- [x] [Review][Defer] **W3: No authentication on endpoints** [server/api/routes/workflows.ts] — deferred, planned for Epic 5 (Story 5-2)
- [x] [Review][Defer] **W4: No Protected Zones enforcement on node writes** [server/api/routes/workflows.ts] — deferred, planned for Epic 3
- [x] [Review][Defer] **W5: Switch node icon resolves to wrong fallback** [ui/lib/icons.ts] — deferred, cosmetic

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- All 72 tests pass (20 server, 52 UI) — 0 regressions

### Completion Notes List
- Task 1: Added 3 REST endpoints — DELETE node (with connection cleanup + broadcast), POST connection (with broadcast), DELETE connection (with broadcast). Replicated logic from MCP tools.
- Task 2: Added `addNode`, `deleteNode`, `addConnection`, `deleteConnection` to API client. Added `addNode`, `removeNode`, `onConnect` store actions. `addNode` and `onConnect` use no optimistic update (wait for WS); `removeNode` uses optimistic removal (idempotent filter).
- Task 3: Built CanvasToolbar with Add Node button and AddNodeDropdown grouped by NODE_CATEGORIES. Wired into Editor.tsx as absolute overlay top-left.
- Task 4: Added `onNodesDelete` handler + `deleteKeyCode` prop to ReactFlow. Added Delete Node button to NodeConfigSidebar with red destructive styling.
- Task 5: Added `onConnect` handler to Canvas.tsx, persists connections through API. Handle IDs follow existing `input-0`/`output-0` convention.
- Task 6: 18 new tests covering toolbar rendering, dropdown interaction, store actions, API endpoints, and keyboard delete.

### Change Log
- 2026-03-26: Story 1.4 implemented — Canvas Toolbar, Node Management, Connection Management

### File List
- packages/server/src/api/routes/workflows.ts (modified — added DELETE node, POST connection, DELETE connection routes)
- packages/ui/src/lib/api.ts (modified — added addNode, deleteNode, addConnection, deleteConnection)
- packages/ui/src/store/workflow.ts (modified — added addNode, removeNode, onConnect store actions)
- packages/ui/src/components/toolbar/CanvasToolbar.tsx (new)
- packages/ui/src/components/toolbar/AddNodeDropdown.tsx (new)
- packages/ui/src/pages/Editor.tsx (modified — added CanvasToolbar)
- packages/ui/src/components/canvas/Canvas.tsx (modified — added onConnect, onNodesDelete, deleteKeyCode)
- packages/ui/src/components/sidebar/NodeConfigSidebar.tsx (modified — added Delete Node button)
- packages/server/src/__tests__/node-connection-routes.test.ts (new)
- packages/ui/src/__tests__/canvas-toolbar.test.ts (new)
- packages/ui/src/__tests__/store-node-actions.test.ts (new)
- packages/ui/src/__tests__/canvas-delete.test.ts (new)

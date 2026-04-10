# Story 1.2: WebSocket Integration & Real-Time Sync

Status: done

## Story

As a Claude Code power user,
I want to watch AI agents build and modify workflows on my canvas in real-time,
So that I can see what my agents are doing without refreshing.

## Acceptance Criteria

1. **Given** the canvas is open for a workflow
   **When** a node is added, updated, or removed via MCP or REST API
   **Then** the change appears on the canvas within 1 second via WebSocket push

2. **Given** the WebSocket connection drops
   **When** it reconnects
   **Then** a `full_sync` message restores the canvas to the current server state

3. **Given** multiple server events fire in rapid succession
   **When** the UI receives them
   **Then** all events are applied in order without visual glitching

## Tasks / Subtasks

- [x] Task 1: Fix Vite WS proxy + add server-side `full_sync` and subscriptions (AC: #2)
  - [x] 1.1 Fix Vite proxy: change `/ws` target from `ws://localhost:3000` to `ws://localhost:5174`
  - [x] 1.2 Add incoming message handling to `Broadcaster`: `ws.on('message', handler)` for each client
  - [x] 1.3 Handle `{ type: "subscribe", workflowId }` — fetch workflow from DB, send `full_sync` back to that client only (not broadcast)
  - [x] 1.4 Track per-client subscriptions: `Map<WebSocket, string>` mapping client→workflowId
  - [x] 1.5 Update `broadcastToWorkflow()` to only send to clients subscribed to that workflowId
  - [x] 1.6 Pass a `getWorkflow` function to the `Broadcaster` constructor (inject DB dependency without coupling to Drizzle)

- [x] Task 2: Create `store/ws.ts` — WebSocket connection store (AC: #1, #2, #3)
  - [x] 2.1 Create `packages/ui/src/store/ws.ts` as a standalone Zustand store
  - [x] 2.2 State: `status` ('connecting' | 'connected' | 'disconnected'), `lastError: string | null`
  - [x] 2.3 `connect(workflowId)`: open WebSocket, send subscribe on open
  - [x] 2.4 `disconnect()`: close WebSocket, clear reconnect timer
  - [x] 2.5 Auto-reconnect: exponential backoff 1s → 2s → 4s → 8s → 16s cap, with jitter; reset on successful connect
  - [x] 2.6 On `connected` ack: set status to 'connected'
  - [x] 2.7 On close/error: set status to 'disconnected', start reconnect
  - [x] 2.8 On message: parse JSON as `WebSocketMessage`, call `applyWsMessage()` in workflow store

- [x] Task 3: Add WS message handlers to workflow store (AC: #1, #2, #3)
  - [x] 3.1 Add `applyWsMessage(msg: WebSocketMessage)` action to `useWorkflowStore`
  - [x] 3.2 `full_sync`: replace workflow, nodes, edges entirely using existing `toReactFlowNodes`/`toReactFlowEdges` mappers
  - [x] 3.3 `node_added`: append to both `workflow.nodes` and React Flow `nodes`
  - [x] 3.4 `node_updated`: merge changes into both `workflow.nodes` and React Flow `nodes`
  - [x] 3.5 `node_removed`: remove from both arrays, remove associated edges
  - [x] 3.6 `connection_added`: append to both `workflow.connections` and React Flow `edges`
  - [x] 3.7 `connection_removed`: remove from both arrays
  - [x] 3.8 `workflow_updated`: update workflow metadata only (name, description)
  - [x] 3.9 Filter: only process messages where `msg.workflowId === workflow.id`

- [x] Task 4: Wire WebSocket lifecycle into Editor page (AC: #1, #2)
  - [x] 4.1 In `Editor.tsx`, after `loadWorkflow` succeeds, call `wsStore.connect(workflowId)`
  - [x] 4.2 On workflowId change or unmount, call `wsStore.disconnect()`
  - [x] 4.3 Add connection status indicator (colored dot): green=connected, yellow=connecting, red=disconnected

- [x] Task 5: Ordered message application and glitch prevention (AC: #3)
  - [x] 5.1 Batch rapid WS messages via `requestAnimationFrame` — collect messages, apply in single `set()` call
  - [x] 5.2 Do NOT trigger `fitView` on incremental WS updates (only on initial load and `full_sync`)
  - [x] 5.3 Skip `node_updated` events where position matches local state (prevents feedback loops from user's own drag actions)

- [x] Task 6: Tests (AC: #1, #2, #3)
  - [x] 6.1 Unit test `applyWsMessage` for each event type (node_added, node_updated, node_removed, connection_added, connection_removed, full_sync)
  - [x] 6.2 Unit test WS store reconnect logic (mock WebSocket)
  - [x] 6.3 Unit test message filtering (ignore messages for different workflowId)
  - [x] 6.4 Server test: broadcaster handles subscribe message and responds with full_sync

## Dev Notes

### Why This Story Matters

This is the **core real-time infrastructure** for flowAIbuilder's vision as the visual control center for Claude Code. Without WS sync, users can't watch agents build workflows live — the defining experience. This infrastructure also serves **Epic 6 (Agent Teams Dashboard)**, which is the next epic and the killer feature. The WS event type system already includes `agent_messages_updated` and `team_tasks_updated` — this story builds the client-side plumbing they'll use.

### Architecture Compliance

- **New file**: `packages/ui/src/store/ws.ts` — standalone Zustand store per architecture spec
- **Zustand 5**: `create<T>()((set, get) => ({...}))` — same pattern as `workflow.ts` and `ui.ts`
- **Types**: Import `WebSocketMessage`, `WebSocketEventType` from `@flowaibuilder/shared`. Do NOT duplicate.
- **Mappers**: Reuse `toReactFlowNode`, `toReactFlowEdge` from `lib/mappers.ts`
- **Zero-cost AI**: No Claude API calls. Pure WebSocket plumbing.

### Critical Bug Fix: Vite Proxy Port Mismatch

`packages/ui/vite.config.ts:14-17` proxies `/ws` to `ws://localhost:3000`, but the WebSocket broadcaster runs on port **5174** (`WS_PORT` in `packages/server/src/index.ts:10`). Fix:

```typescript
'/ws': {
  target: 'ws://localhost:5174',
  ws: true,
},
```

### Server-Side Changes (Broadcaster)

The `Broadcaster` class (`packages/server/src/api/ws/broadcaster.ts`) is **one-way broadcast only**. For full_sync on reconnect, add:

1. **Message listener** on each client: `ws.on('message', handler)`
2. **Subscribe handling**: Client sends `{ type: "subscribe", workflowId }`, server fetches workflow and sends `full_sync` to that client only
3. **DB injection**: Pass a `getWorkflow` callback to the constructor — do NOT import Drizzle directly into broadcaster

```typescript
// Constructor signature change:
constructor(port: number, private getWorkflowFn?: (id: string) => Promise<Workflow | null>)

// In connection handler, add:
ws.on('message', async (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === 'subscribe' && msg.workflowId) {
    this.subscriptions.set(ws, msg.workflowId);
    if (this.getWorkflowFn) {
      const workflow = await this.getWorkflowFn(msg.workflowId);
      if (workflow) {
        ws.send(JSON.stringify({
          type: 'full_sync',
          workflowId: workflow.id,
          data: workflow,
          timestamp: new Date().toISOString(),
        }));
      }
    }
  }
});
```

In `index.ts`, pass the service function when creating the broadcaster:
```typescript
import { getWorkflow } from './services/workflow.js'; // or inline from routes
const broadcaster = createBroadcaster(WS_PORT, getWorkflow);
```

**Note**: If no `getWorkflow` service function exists as a standalone export, extract one from the route handler in `packages/server/src/api/routes/workflows.ts`. The route's GET handler already queries the DB — factor the DB query into a reusable function.

### WebSocket Message Format (Already Defined)

From `packages/shared/src/types/mcp.ts`:
```typescript
type WebSocketEventType =
  | 'connected' | 'full_sync'
  | 'workflow_created' | 'workflow_updated' | 'workflow_deleted'
  | 'node_added' | 'node_updated' | 'node_removed'
  | 'connection_added' | 'connection_removed'
  | 'node_executed' | 'execution_started' | 'execution_completed'
  | 'annotation_added' | 'annotations_updated'
  | 'zone_created' | 'zone_deleted';

interface WebSocketMessage {
  type: WebSocketEventType;
  workflowId: string;
  data: unknown;
  timestamp: string;  // ISO 8601
}
```

**Data payloads by event type** (from REST routes and MCP tools that call `broadcaster.broadcast()`):
- `node_added`: `{ node: WorkflowNode, position: Position }`
- `node_updated`: `{ node_id: string, changes: Partial<WorkflowNode> }`
- `node_removed`: `{ node_id: string }`
- `connection_added`: `{ source: string, target: string }`
- `connection_removed`: `{ connection_id?: string, source?: string, target?: string }`
- `workflow_updated`: `Partial<Workflow>`
- `full_sync`: full `Workflow` object (with nodes and connections arrays)

### WebSocket Client URL

Use native browser `WebSocket` — do NOT add a library (socket.io, reconnecting-websocket, etc.):

```typescript
const wsUrl = import.meta.env.VITE_WS_URL
  || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
```

- Dev: `ws://localhost:5180/ws` (Vite proxies to 5174)
- Prod: `VITE_WS_URL` env var or auto-detect from page host

### Reconnection Strategy

Exponential backoff with jitter:
```
delay = min(1000 * 2^attempt + random(0, 500), 16000)
```
On reconnect: re-send `subscribe` → server responds with `full_sync` → canvas fully restored.

### Glitch Prevention (AC #3)

Rapid WS messages (e.g., MCP creates 5 nodes in sequence) must not cause 5 synchronous re-renders:
- Batch within `requestAnimationFrame`: collect messages, apply all in single `set()` call
- React 19 has automatic batching for async callbacks, but explicit RAF batching is safer for WS `onmessage`
- Do NOT call `fitView` on incremental updates — only on initial `loadWorkflow` and `full_sync`

### Feedback Loop Prevention

User drags node → `updateNodePosition` → PUT API → server broadcasts `node_updated` → UI receives it. Must NOT re-apply:
- Compare incoming position with local state — skip if identical
- This is sufficient for MVP. If issues arise, upgrade to correlationId tagging.

### Existing Code to Reuse (DO NOT RECREATE)

| What | Where | Use for |
|------|-------|---------|
| `toReactFlowNode/Edge` | `packages/ui/src/lib/mappers.ts` | `full_sync` and `node_added` handlers |
| `getWorkflow()` | `packages/ui/src/lib/api.ts` | Fallback full_sync via REST if WS fails |
| `useWorkflowStore` | `packages/ui/src/store/workflow.ts` | Extend with `applyWsMessage`, don't create parallel state |
| `WebSocketMessage` | `packages/shared/src/types/mcp.ts` | Import directly, don't duplicate |
| `Broadcaster` | `packages/server/src/api/ws/broadcaster.ts` | Extend class, don't create new WS server |

### Previous Story Intelligence

**Story 1.1 learnings:**
- Zustand 5 pattern: `create<T>()((set, get) => ({...}))`
- `loadWorkflow` clears `saveTimeout` on entry (stale save prevention) — WS `disconnect()` must do the same
- `loadRequestId` prevents stale responses — use similar pattern for WS (ignore messages from stale connections)
- Handle IDs always explicit (`input-0`, `output-0`) — new nodes from WS must include these
- `workflow.nodes` and React Flow `nodes` can diverge — `applyWsMessage` MUST update BOTH arrays
- Vite proxy added for `/ws` but targets wrong port (3000 instead of 5174)

**Story 1.0 learnings:**
- Broadcaster singleton: `getBroadcaster()` from `index.ts`
- REST routes and MCP tools already call `broadcaster.broadcast()` / `broadcaster.broadcastToWorkflow()` — WS messages are being sent, UI just doesn't listen yet
- WS server on port 5174, separate from Fastify (3000)

### What NOT to Do

- Do NOT install a WebSocket library — use native `WebSocket` API
- Do NOT create a separate state system — extend existing workflow store
- Do NOT add execution status overlay styling (Story 1.5)
- Do NOT handle annotation or zone WS events in the UI (Epics 2 and 3)
- Do NOT implement bidirectional WS for mutations — UI uses REST for writes, WS is server→client push (except `subscribe`)
- Do NOT add `subscribe` or any new client→server message type to `WebSocketEventType` — use a separate type or inline string for client messages

### Project Structure Notes

- New UI file: `packages/ui/src/store/ws.ts` — follows existing store pattern
- Server changes: extend `packages/server/src/api/ws/broadcaster.ts` — no new files
- May need to extract a `getWorkflow` service function from routes if one doesn't exist as standalone

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Story 1.2, lines 296-314]
- [Source: _bmad-output/planning-artifacts/architecture.md — WebSocket Protocol section]
- [Source: packages/server/src/api/ws/broadcaster.ts — current implementation]
- [Source: packages/shared/src/types/mcp.ts — WebSocketMessage, WebSocketEventType]
- [Source: packages/ui/src/store/workflow.ts — Zustand store to extend]
- [Source: packages/ui/src/lib/mappers.ts — toReactFlowNode/Edge converters]
- [Source: packages/ui/vite.config.ts — Vite proxy (needs port fix)]
- [Source: packages/server/src/index.ts — WS_PORT=5174, broadcaster creation]
- [Source: _bmad-output/implementation-artifacts/1-0-wire-server-foundation.md — server patterns]
- [Source: _bmad-output/implementation-artifacts/1-1-ui-scaffold-react-flow-canvas-with-custom-nodes.md — UI patterns, review findings]
- [Source: Claude Instructions/sprint-execution-order.md — Epic 6 is next after Epic 1]

## Review Findings

### Decision Needed

- [x] [Review][Decision] MCP `handlePostMessage` 3-arg signature may not match SDK version — **dismissed**: user confirmed SDK supports 3-arg form — `packages/server/src/mcp/index.ts` changed from `transport.handlePostMessage(body)` to `transport.handlePostMessage(request.raw, reply.raw, body)`. If the MCP SDK version doesn't support the 3-arg form, this will throw at runtime. Also, passing `reply.raw` means Fastify loses response control. Verify against installed `@modelcontextprotocol/sdk` version.

### Patch

- [x] [Review][Patch] `broadcastToWorkflow` fallback broadcasts to ALL clients when no subscribers exist [broadcaster.ts:110-117] — **fixed**: removed fallback, only sends to subscribed clients
- [x] [Review][Patch] `connection_added` WS handler reads `data.source`/`data.target` but server sends `sourceNodeId`/`targetNodeId` [workflow.ts:181-183] — **fixed**: reads `data.connection` with field name fallbacks
- [x] [Review][Patch] `connection_removed` WS handler reads `data.source`/`data.target` but server sends `source_node_id`/`target_node_id` [workflow.ts:200-219] — **fixed**: reads both field name formats
- [x] [Review][Patch] `node_updated` WS handler reads `data.changes` but server sends flat fields (`node_id`, `name`, `config`) [workflow.ts:130] — **fixed**: supports both nested and flat formats
- [x] [Review][Patch] `ws.send()` can throw on closed socket in broadcaster — no try/catch around send in connection ack, subscribe response, and broadcast loops [broadcaster.ts:37,58,78-82] — **fixed**: added try/catch around all send calls
- [x] [Review][Patch] Race condition: `wsConnect` fires after component unmount — `loadWorkflow().then(wsConnect)` can execute after cleanup `wsDisconnect()` [Editor.tsx:17-26] — **fixed**: added `cancelled` flag checked in `.then()` callback
- [x] [Review][Patch] RAF batching calls `applyWsMessage` per message instead of single `set()` — spec requires single set() call [ws.ts:28-30] — **fixed**: gets store state once, applies all messages in sequence
- [x] [Review][Patch] No `fitView` on `full_sync` — spec says fitView on initial load AND full_sync for viewport restore after reconnect [workflow.ts full_sync handler] — **fixed**: added `fitViewCounter` + `FitViewOnSync` child component
- [x] [Review][Patch] No max reconnect attempt cap — client retries forever every ~16s [ws.ts:115-121] — **fixed**: max 20 attempts, then stops with error message

### Deferred (pre-existing, not caused by this story)

- [x] [Review][Defer] Concurrent read-modify-write race on workflow JSON arrays (no DB-level locking) [mcp/index.ts, routes/workflows.ts] — deferred, pre-existing
- [x] [Review][Defer] `markBranchSkipped` incorrectly skips merge/diamond pattern nodes [executor.ts:293-304] — deferred, pre-existing
- [x] [Review][Defer] No graceful shutdown (SIGTERM/SIGINT handlers missing) [index.ts] — deferred, pre-existing
- [x] [Review][Defer] Broadcaster `close()` doesn't clean up individual client sockets [broadcaster.ts:124-126] — deferred, pre-existing
- [x] [Review][Defer] No authentication/authorization on any endpoint [routes, mcp] — deferred, pre-existing (Story 5-2)
- [x] [Review][Defer] MCP `delete_workflow` doesn't cascade-delete executions [mcp/index.ts] — deferred, pre-existing
- [x] [Review][Defer] `disconnect_nodes` Zod schema doesn't enforce either/or constraint [mcp/index.ts] — deferred, pre-existing
- [x] [Review][Defer] Duplicate workflow doesn't deep-clone/regenerate node IDs [routes/workflows.ts] — deferred, pre-existing
- [x] [Review][Defer] `connect_nodes` accepts non-existent node IDs without validation [mcp/index.ts] — deferred, pre-existing
- [x] [Review][Defer] SSE transport: multiple `server.connect(transport)` may conflict [mcp/index.ts:443-464] — deferred, pre-existing
- [x] [Review][Defer] `httpRequest` helper doesn't check `resp.ok` [engine/context.ts:51-62] — deferred, pre-existing
- [x] [Review][Defer] Empty workflow execution succeeds vacuously [executor.ts:57,232-234] — deferred, pre-existing

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- All 49 tests pass (35 UI + 14 server), zero regressions
- TypeScript compiles clean for both UI and server packages

### Completion Notes List

- **Task 1**: Fixed Vite proxy port (3000→5174), extended Broadcaster with subscribe/full_sync handling, per-client subscription tracking via Map<WebSocket, string>, getWorkflow DI via constructor. Extracted `getWorkflowById` service function from routes.
- **Task 2**: Created `store/ws.ts` Zustand store with connect/disconnect, exponential backoff reconnect (1s→16s cap with jitter), status tracking, and native WebSocket (no libraries).
- **Task 3**: Added `applyWsMessage` to workflow store handling all 7 event types (full_sync, node_added/updated/removed, connection_added/removed, workflow_updated). Updates both workflow.nodes and React Flow nodes arrays. Filters by workflowId.
- **Task 4**: Wired WS lifecycle into Editor.tsx — connects after loadWorkflow, disconnects on unmount/change. Added colored status indicator (green/yellow/red dot).
- **Task 5**: Implemented RAF batching for rapid WS messages (full_sync bypasses batch for immediate canvas restore). Position comparison prevents feedback loops. fitView only on initial load, not incremental updates.
- **Task 6**: 22 new tests — 9 applyWsMessage unit tests, 5 WS reconnect tests, 2 server broadcaster subscribe/subscription-filtering tests. Also added vite-env.d.ts for import.meta.env types.

### Change Log

- 2026-03-25: Implemented full WebSocket integration and real-time sync (Story 1.2)

### File List

- packages/ui/vite.config.ts (modified — fixed WS proxy port)
- packages/server/src/api/ws/broadcaster.ts (modified — subscribe, subscriptions, getWorkflow DI)
- packages/server/src/api/routes/workflows.ts (modified — extracted getWorkflowById)
- packages/server/src/index.ts (modified — pass getWorkflowById to broadcaster)
- packages/ui/src/store/ws.ts (new — WebSocket connection Zustand store)
- packages/ui/src/store/workflow.ts (modified — added applyWsMessage handler)
- packages/ui/src/pages/Editor.tsx (modified — WS lifecycle + status indicator)
- packages/ui/src/vite-env.d.ts (new — Vite client type reference)
- packages/ui/src/__tests__/ws-store.test.ts (new — applyWsMessage unit tests)
- packages/ui/src/__tests__/ws-reconnect.test.ts (new — WS reconnect logic tests)
- packages/server/src/__tests__/broadcaster.test.ts (modified — subscribe/full_sync tests)

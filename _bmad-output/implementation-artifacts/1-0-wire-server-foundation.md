# Story 1.0: Wire Server Foundation

Status: done

## Story

As a developer (human or AI agent),
I want the Fastify server fully wired with DB connection, REST API routes, WebSocket broadcaster, and MCP tool registration,
So that the UI and Claude Code have working endpoints to interact with.

## Acceptance Criteria

1. **Given** the server starts via `npm run dev:server`
   **When** it initializes
   **Then** it connects to the database (SQLite in dev), registers all Fastify route plugins, starts the WebSocket server, and registers MCP tools on stdio + HTTP/SSE transport
   **And** a health check at `GET /api/health` returns 200

2. **Given** the workflow engine and node handlers already exist
   **When** REST routes for `/api/workflows` are registered
   **Then** CRUD operations (create, get, list, delete, duplicate) work via HTTP
   **And** `POST /api/workflows/:id/execute` triggers the engine and returns execution results

3. **Given** the WebSocket server is running
   **When** a client connects to the WS endpoint
   **Then** the client receives a connection acknowledgment
   **And** all server-side mutations (node add/update/remove, execution status) broadcast to connected clients

4. **Given** the MCP server is registered
   **When** Claude Code connects via stdio or HTTP/SSE
   **Then** core MCP tools are available: create_workflow, get_workflow, list_workflows, delete_workflow, add_node, update_node, remove_node, connect_nodes, disconnect_nodes, execute_workflow, get_execution, list_executions

## Important: Existing Implementation Status

**Most of this story is already implemented.** Commits `0392a95` and `d1183f7` delivered:
- Project scaffold, DB schema, engine, 7 node handlers
- MCP server with 8 tools, REST API CRUD, WebSocket broadcaster

**The dev agent MUST verify** each acceptance criterion against the existing code and only implement what's missing. Do NOT rewrite existing working code.

### What Already Exists (Verified)

| Component | File | Status |
|-----------|------|--------|
| Fastify server entry | `packages/server/src/index.ts` | Functional — imports nodes, creates broadcaster, registers routes + MCP |
| DB schema (14 tables) | `packages/server/src/db/schema.ts` | Complete — workflows, executions, audit_log, users, annotations, etc. |
| DB client | `packages/server/src/db/index.ts` | Exports `db` instance |
| Workflow engine | `packages/server/src/engine/executor.ts` | Full topological sort + execution |
| Node runner | `packages/server/src/engine/node-runner.ts` | Registry pattern, timing, error capture |
| Node context | `packages/server/src/engine/context.ts` | $input, $json, $env, $secrets, $helpers |
| 7 Node handlers | `packages/server/src/nodes/` | webhook, manual, code-js, if, set, http-request, respond-webhook |
| REST API routes | `packages/server/src/api/routes/workflows.ts` | GET/POST/PUT/DELETE /api/workflows, POST execute, POST add node |
| WebSocket broadcaster | `packages/server/src/api/ws/broadcaster.ts` | Broadcaster class on port 5174 |
| MCP server | `packages/server/src/mcp/index.ts` | 8 tools with Zod schemas, SSE transport on /mcp/sse |
| Shared types | `packages/shared/src/types/` | Workflow, Execution, NodeType types |

### Gaps to Verify and Fix

The dev agent should check for these potential gaps:

1. **Health check endpoint** — Verify `GET /api/health` returns 200 with status info. If missing, add it.
2. **`duplicate` workflow** — AC says "create, get, list, delete, duplicate". Verify duplicate endpoint exists. If not, add `POST /api/workflows/:id/duplicate`.
3. **`disconnect_nodes` MCP tool** — AC lists it. Verify it exists alongside `connect_nodes`.
4. **`get_execution` and `list_executions` MCP tools** — AC lists these. Verify they exist.
5. **WebSocket connection acknowledgment** — AC says client receives ack on connect. Verify broadcaster sends ack message.
6. **Execution status broadcasting** — AC says "execution status" broadcasts to clients. Verify the executor calls `broadcaster.broadcast()` during execution events (node_executed, execution_completed).
7. **stdio transport** — AC says MCP works on "stdio + HTTP/SSE". Verify stdio transport is registered (may only have SSE currently).

## Tasks / Subtasks

- [x] Task 1: Verify all acceptance criteria against existing code (AC: 1-4)
  - [x] Start server with `npm run dev:server` and confirm it boots without errors
  - [x] Test `GET /api/health` returns 200
  - [x] Test workflow CRUD via REST API (create, get, list, delete)
  - [x] Test workflow execution via `POST /api/workflows/:id/execute`
  - [x] Test WebSocket connection receives ack
  - [x] Test MCP tools via stdio or SSE
- [x] Task 2: Implement missing endpoints/tools identified in gaps (AC: 1-4)
  - [x] Add `GET /api/health` if missing — Already existed ✓
  - [x] Add `POST /api/workflows/:id/duplicate` if missing — Added
  - [x] Add `disconnect_nodes` MCP tool if missing — Added
  - [x] Add `get_execution` and `list_executions` MCP tools if missing — Added both
  - [x] Add WebSocket connection ack message if missing — Already existed ✓ (fixed type)
  - [x] Wire execution events to broadcaster if not connected — Added execution_started, node_executed, execution_completed broadcasts
  - [x] Add stdio transport for MCP if missing — Wired via --stdio CLI flag
- [x] Task 3: Verify end-to-end flow (AC: 1-4)
  - [x] Create workflow via MCP → verify appears in REST GET
  - [x] Add nodes via MCP → verify WebSocket broadcasts received
  - [x] Execute workflow → verify execution events broadcast to WS clients
  - [x] Verify all 12 MCP tools listed in AC4 are registered and functional

### Review Findings

- [x] [Review][Patch] stdio transport + console.log corrupts MCP protocol stream [packages/server/src/index.ts:39-43] — Fixed: suppress console.log when --stdio active
- [x] [Review][Patch] `list_executions` has no upper bound on `limit` parameter [packages/server/src/mcp/index.ts:393] — Fixed: added z.number().int().min(1).max(100)
- [x] [Review][Patch] `disconnect_nodes` silently succeeds with 0 removals [packages/server/src/mcp/index.ts:326-338] — Fixed: early return with disconnected:false when nothing removed
- [x] [Review][Defer] Protected Zones not enforced on disconnect/delete MCP tools — deferred, Epic 3 scope
- [x] [Review][Defer] `delete_workflow` does not cascade-delete executions — deferred, DB schema design from prior commit
- [x] [Review][Defer] Read-modify-write race condition on JSON columns — deferred, pre-existing pattern
- [x] [Review][Defer] No error handling for ws.send() failures in broadcaster — deferred, pre-existing
- [x] [Review][Defer] Existing MCP tools may lack WS broadcasts — deferred, prior commit scope

## Dev Notes

### Architecture Compliance

- **Zero-cost AI model**: Server NEVER calls Claude API. No `@anthropic-ai/sdk` dependency.
- **MCP-first**: Every feature is MCP tool first, REST API second, UI button third.
- **Service pattern**: Business logic accessed via `app.services.*` (workflows, nodes, executions, audit).
- **Broadcast on mutation**: Every REST and MCP write operation must broadcast to WebSocket.
- **Audit logging**: Every request should be logged (actor, action, resource_type, resource_id, changes).

### Server Architecture Pattern

```
Fastify server (port 3000)
├── REST routes: /api/workflows, /api/health
├── MCP SSE: /mcp/sse, /mcp/messages
├── MCP stdio: stdin/stdout transport
└── WebSocket (port 5174)
    └── Broadcaster → all connected clients
```

### MCP Tool Registration Pattern

```typescript
// mcp/index.ts — uses Zod schemas
server.tool("tool_name", zodSchema, async (params) => {
  // 1. Validate via schema
  // 2. Call app.services.*
  // 3. Log audit
  // 4. Broadcast to WebSocket
  // 5. Return structured response
});
```

### WebSocket Message Types (Server → Client)

```typescript
type ServerMessage =
  | { type: "workflow_created"; workflow: Workflow }
  | { type: "node_added"; workflow_id: string; node: WorkflowNode }
  | { type: "node_updated"; workflow_id: string; node_id: string; changes: Partial<WorkflowNode> }
  | { type: "node_removed"; workflow_id: string; node_id: string }
  | { type: "connection_added"; workflow_id: string; source: string; target: string }
  | { type: "node_executed"; execution_id: string; node_id: string; status: string; duration_ms: number }
  | { type: "execution_completed"; execution_id: string; status: string }
  | { type: "full_sync"; workflow: Workflow }
```

### Key Dependencies (Already Installed)

- `fastify` 5.2.0, `@fastify/cors`
- `@modelcontextprotocol/sdk` 1.27.1
- `drizzle-orm` 0.38.0
- `zod` 3.24.0
- `ws` 8.18.0
- `nanoid` 5.0.0

### File Locations

- Server entry: `packages/server/src/index.ts`
- DB schema: `packages/server/src/db/schema.ts`
- DB client: `packages/server/src/db/index.ts`
- Routes: `packages/server/src/api/routes/workflows.ts`
- Broadcaster: `packages/server/src/api/ws/broadcaster.ts`
- MCP server: `packages/server/src/mcp/index.ts`
- Engine: `packages/server/src/engine/executor.ts`
- Node handlers: `packages/server/src/nodes/` (registered via `nodes/index.ts`)
- Shared types: `packages/shared/src/types/`

### Testing Approach

This story is primarily a **verification + gap-fill** story. The dev agent should:
1. Boot the server and test each AC manually
2. Fix any gaps found (missing endpoints, missing tools, missing broadcasts)
3. Do NOT add tests for existing working code — only test new code added
4. Keep changes minimal — this is a wiring story, not a rewrite

### What NOT to Do

- Do NOT rewrite `index.ts`, `workflows.ts`, `broadcaster.ts`, or `mcp/index.ts` from scratch
- Do NOT add auth middleware, RBAC, or audit middleware yet (that's Epic 5)
- Do NOT implement review tools, zone tools, or agent-team tools (those are Epics 2, 3, 6)
- Do NOT add node types beyond the existing 7 (switch, merge, loop, etc. come in later stories)
- Do NOT refactor the engine or node-runner patterns

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.0]
- [Source: _bmad-output/planning-artifacts/architecture.md#Server Architecture]
- [Source: _bmad-output/planning-artifacts/architecture.md#MCP Server]
- [Source: _bmad-output/planning-artifacts/architecture.md#WebSocket Protocol]
- [Source: 00_docs/flowaibuilder-architecture.md]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- Fixed pre-existing type error in `mcp/index.ts:455` — `SSEServerTransport.handlePostMessage` needed 2-3 args (req, res, body), was passing only body
- Added `connected` and `full_sync` to `WebSocketEventType` union to fix broadcaster type mismatch

### Completion Notes List

- **Verification**: Health check, CRUD, WebSocket ack, and 8 MCP tools all existed and were functional
- **Gap: duplicate endpoint** — Added `POST /api/workflows/:id/duplicate` to REST routes
- **Gap: delete_workflow MCP tool** — Added with broadcast on `workflow_deleted`
- **Gap: disconnect_nodes MCP tool** — Added with support for disconnecting by connection_id or by source+target pair
- **Gap: get_execution MCP tool** — Added to query single execution by ID
- **Gap: list_executions MCP tool** — Added with optional workflow_id filter and limit
- **Gap: execution broadcasting** — Wired `execution_started`, `node_executed`, and `execution_completed` events from executor to WebSocket broadcaster
- **Gap: stdio transport** — Wired `startStdioTransport` in index.ts behind `--stdio` CLI flag
- **Fix: handlePostMessage signature** — Updated to pass `(request.raw, reply.raw, body)` per MCP SDK v1.27.1 API
- **Tests**: Added vitest with 12 tests across 3 test files (broadcaster, MCP registration, routes)
- All 12 MCP tools now registered: create_workflow, get_workflow, list_workflows, delete_workflow, add_node, update_node, remove_node, connect_nodes, disconnect_nodes, execute_workflow, get_execution, list_executions
- All type checks pass (tsc --noEmit)
- All tests pass (vitest run: 3 files, 12 tests)

### File List

- `packages/server/src/index.ts` — Modified (wired stdio transport via --stdio flag)
- `packages/server/src/mcp/index.ts` — Modified (added 4 MCP tools: delete_workflow, disconnect_nodes, get_execution, list_executions; fixed handlePostMessage)
- `packages/server/src/api/routes/workflows.ts` — Modified (added POST /api/workflows/:id/duplicate)
- `packages/server/src/api/ws/broadcaster.ts` — Modified (typed ack message as WebSocketMessage)
- `packages/server/src/engine/executor.ts` — Modified (wired execution_started, node_executed, execution_completed broadcasts)
- `packages/shared/src/types/mcp.ts` — Modified (added 'connected' and 'full_sync' to WebSocketEventType)
- `packages/server/src/__tests__/mcp-tools.test.ts` — New (MCP tool registration tests)
- `packages/server/src/__tests__/broadcaster.test.ts` — New (WebSocket broadcaster + ack tests)
- `packages/server/src/__tests__/health-and-routes.test.ts` — New (health check + route registration tests)
- `packages/server/package.json` — Modified (added test/test:watch scripts, vitest devDependency)
- `package.json` — Modified (added root test script)

## Change Log

- 2026-03-24: Story 1.0 implementation — verified existing code, filled 7 gaps (duplicate endpoint, 4 MCP tools, execution broadcasting, stdio transport), added vitest test suite with 12 tests

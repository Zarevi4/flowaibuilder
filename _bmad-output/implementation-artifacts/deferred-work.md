# Deferred Work

## Deferred from: code review of story-5-3 (2026-04-09, Group C)

- **`VersionsPanel` opens its own raw WebSocket** instead of subscribing to `useWsStore` — duplicate connection. Refactor to use the shared store. [packages/ui/src/components/versions/VersionsPanel.tsx:35-48]
- **Duplicate `getGitSettings`/`updateGitSettings` aliases** in api.ts — dead surface area. [packages/ui/src/lib/api.ts]
- **Task 9.5 MCP tool integration test coverage shallow** — only tests static RBAC mapping, not the list/get/revert/git_push/git_history handlers end-to-end.
- **VersionsPanel `toggleSelect` click-order semantics** — surprising when 3rd version is picked.
- **`delete_workflow` MCP tool lacks admin gating** — pre-existing Story 5.2 concern.
- **Stdio/SSE mixed-mode `activeMcpUser` race** — SSE `finally` wipes stdio context. Not currently supported in one process.
- **VersionsPanel has no WS reconnect logic** — stale version list on server restart.
- **VersionsPanel hardcoded `/ws/workflow/...` path** — ignores reverse-proxy prefix.

## Deferred from: code review of story-5-3 (2026-04-09, Group B)

- **`onAuth` token form is GitHub-specific** — GitLab/Bitbucket/Azure DevOps need different forms. Document as a known limitation. [packages/server/src/versioning/git.ts:59-61]
- **`initRepo` does not handle an existing non-empty non-git directory** — clone will fail with an opaque error. [packages/server/src/versioning/git.ts:85-102]
- **`initRepo` doesn't verify remote URL/branch match** — if the config changes, the old checkout is reused. [packages/server/src/versioning/git.ts:85-102]
- **`aes.ts` uses a static salt + ambiguous key-format heuristic** — base64 is the documented path, but the scrypt passphrase fallback uses a global salt. [packages/server/src/crypto/aes.ts]
- **Audit middleware blanket-excludes `/mcp/` routes** — pre-existing from Stories 5.1/5.2; MCP path has its own audit writes. [packages/server/src/api/middleware/audit.ts:23]
- **Audit captures full response JSON into `changes.after`** — deeply-nested workflow configs with embedded credentials are only partially redacted. [packages/server/src/api/middleware/audit.ts]
- **No `gitToken` request-body size cap** — DoS vector on `encrypt`. [packages/server/src/api/routes/settings.ts]
- **`decrypt` lacks pre-validation of IV/tag length** — Node throws regardless. [packages/server/src/crypto/aes.ts]
- **`defaultRepoPath` is CWD-relative** — absolute path via `FLOWAI_DATA_DIR` is documented. [packages/server/src/versioning/git.ts:50-53]
- **`resolveAction` fallback collisions for unmapped workflow subroutes** — not currently hit. [packages/server/src/api/middleware/audit.ts]

## Deferred from: code review of story-5-3 (2026-04-09, Group A)

- **`executions.workflowId` flipped to `.notNull()` without migration** — existing nullable rows will break `drizzle-kit push`. [packages/server/src/db/schema.ts:832]
- **`workflow_version_unique` unique constraint added with no dedup migration** — pre-unique duplicate `(workflow_id, version)` rows will fail migration. [packages/server/src/db/schema.ts:841-843]
- **Snapshot size unbounded** — a large workflow produces multi-MB JSONB writes on every mutation; add a size guard. [packages/server/src/versioning/store.ts:116-126]
- **`instanceSettings` singleton row never seeded** — git sync stays "disabled" until a row exists in the table. [packages/server/src/db/schema.ts:873]
- **`request.user` typed as `any`** — Fastify type augmentation missing; silent actor-attribution bugs possible. [packages/server/src/api/routes/workflows.ts multiple]
- **`stable()` throws on circular / bigint values** — a user-supplied Code node config with a cycle will 500 the PUT. [packages/server/src/versioning/diff.ts:955]
- **Duplicate node IDs silently collapsed in `diffSnapshots`** — schema does not enforce node-id uniqueness. [packages/server/src/versioning/diff.ts:62]
- **Node mutation endpoints unconditionally snapshot** — a no-op PATCH with empty body bumps the version. [packages/server/src/api/routes/workflows.ts:231-248]
- **Activate-path spurious version if executor sets `active=true` via PUT** — executor not in Group A scope; revisit after Group B. [packages/server/src/api/routes/workflows.ts:176-188]
- **Git push tests do not cover misconfigured / token-invalid branches** — coverage gap. [packages/server/src/__tests__/versioning-routes.test.ts]

## Deferred from: code review of story-5-1 (2026-04-09)

- **Audit middleware `onSend` only captures `application/json` string payloads** — 204 No Content, streamed responses, or `reply.send(Buffer)` handlers leave `auditAfter = null`, so `changes.after` is null on the audit entry. Every current mutation route returns JSON so there is no active bug, but the assumption should be documented with a comment in `registerAuditMiddleware` and reconsidered if any mutation ever returns non-JSON. [packages/server/src/api/middleware/audit.ts:108-120]
- **`resolveAction` called twice per request** — preHandler runs it once to populate `auditMeta`; onResponse re-runs it instead of reading the cached result. Minor CPU waste and a latent drift risk if the mapping ever becomes non-deterministic. Cache the `ActionMap` on `request.auditMeta` from preHandler and read it back in onResponse. [packages/server/src/api/middleware/audit.ts:88,128]

## Deferred from: code review of story-4-1 (2026-04-09)

- **Brittle compiler test regexes (TS/Python)** — `expect(content).not.toMatch(/"id":/)` (export-compilers.test.ts:73) and `not.toContain('null'/'true')` (lines 80-81) inspect the entire compiled output. A node config string value containing those substrings would cause false failures. Tighten to inspect only the post-`nodes: [` slice or use a stricter pattern. [packages/server/src/__tests__/export-compilers.test.ts]
- **MCP handler `format as never` cast** — `tools/export.ts:53` casts to `never` to bypass z.enum string typing. `format as ExportFormat` is the correct cast and would catch enum drift. Cosmetic. [packages/server/src/mcp/tools/export.ts]
- **Generated TS/Python emit unused `node, connection` imports** — The literal-based shape doesn't reference these helpers. Add a header comment or drop the imports once the notional SDK shape solidifies. [packages/server/src/export/compilers/typescript.ts, python.ts]

## Deferred from: code review of story-3-2 (2026-04-08)

- **WS-vs-loadWorkflow zones race** — Between `loadWorkflow` resetting `zones: []` and `getZones()` resolving, any incoming `zone_*` WS event is overwritten by the REST result. Mirrors the same pattern for nodes; fix both at once. [packages/ui/src/store/workflow.ts ~105]
- **toExecution fabricates `startedAt`** — Pre-existing: `row.startedAt?.toISOString() ?? new Date().toISOString()` invents `now()` for queued/pending executions. [packages/server/src/api/routes/workflows.ts ~60]
- **Activate route TOCTOU** — Pre-existing: if the row is deleted between the existence check and the update, `toWorkflow(updated)` throws on undefined. [workflows.ts ~137]
- **ZoneLayer label `fontSize: 11` lives in flow-space** — Becomes unreadable at low zoom and oversized at high zoom. Move to a screen-space layer or scale inversely with viewport zoom. [packages/ui/src/components/canvas/zones/ZoneLayer.tsx]
- **Single-node zone "Remove from Zone" silently deletes the zone** — Matches MCP `remove_from_zone` semantics by spec; UX confirmation is enhancement work. [Canvas.tsx, service.ts]
- **`canUnpin` field never enforced** — `deleteZoneCore` and `removeFromZoneCore` ignore the per-zone `canUnpin` whitelist. Out of Story 3.2 AC; needs an authz design pass. [packages/server/src/zones/service.ts]
- **No authz on zone REST routes** — Any caller can create/delete/modify zones. Out of Story 3.2 AC; matches the rest of the API today. [packages/server/src/api/routes/workflows.ts]
- **`getZonesCore` has no `ORDER BY`** — Initial-load order is DB-dependent → overlapping zone z-order can flip between loads. [service.ts]

## Deferred from: code review of story-3-1 (2026-04-08)

- **`serializeZone` fabricates `pinnedAt` on null** — `tools/zones.ts:23-25` falls back to `new Date().toISOString()` when `row.pinnedAt` is null. The DB column is nullable (`defaultNow()` without `.notNull()`), so a null could surface a misleading "now" value instead of the truth. Switch to a strict `instanceof Date` branch + null pass-through, or make the column `.notNull()`. [packages/server/src/mcp/tools/zones.ts]
- **`add_to_zone` allows nodes already pinned in another zone** — `getPinnedNodeIds` de-dupes via "first zone wins", which silently masks cross-zone membership. Spec doesn't forbid it; add a comment in `enforcer.ts:19` or explicitly reject in `add_to_zone`. [packages/server/src/zones/enforcer.ts]
- **`create_zone` does not validate `color` format** — Accepts any string; no hex validation. Add a `.regex(/^#[0-9a-fA-F]{6}$/)` if the UI ever round-trips bad values. [packages/server/src/mcp/tools/zones.ts]
- **`serializeZone` double-cast smell** — `(row.pinnedAt as unknown as string)` and similar casts bypass drizzle's typed row. Replace with proper narrowing once the schema is `.notNull()`-clean. [packages/server/src/mcp/tools/zones.ts]
- **No `get_zones` test coverage** — AC #12 doesn't require it but it's a 5-line addition to the existing mocked suite. [packages/server/src/__tests__/zone-enforcer.test.ts]

## Deferred from: code review of story-1-0 (2026-03-25)

- **Protected Zones not enforced on disconnect/delete MCP tools** — `disconnect_nodes` and `delete_workflow` MCP tools do not check zone enforcement before mutating. Requires Epic 3 (Protected Zones) implementation.
- **`delete_workflow` does not cascade-delete executions** — No `ON DELETE CASCADE` on the executions table foreign key. Deleting a workflow orphans its execution records. DB schema fix needed.
- **Read-modify-write race condition on JSON columns** — All MCP tools that mutate `nodes` or `connections` JSON columns use a read-then-write pattern without locking. Concurrent requests can cause lost updates.
- **No error handling for `ws.send()` failures in broadcaster** — The `readyState === OPEN` check is racy; socket can transition between check and send. Needs try-catch around `client.send()`.
- **Existing MCP tools may lack WS broadcasts** — `add_node`, `update_node`, `remove_node`, `connect_nodes` tools from prior commits need verification that they broadcast to WebSocket clients per AC3.

## Deferred from: code review of story-1-1 (2026-03-25)

- **workflow.nodes and ReactFlow nodes diverge on non-position changes** — `onNodesChange` only updates ReactFlow `nodes` array via `applyNodeChanges`, never syncs back to `workflow.nodes`. Currently only position changes sync back via `updateNodePosition`. Will matter when canvas-driven node add/delete is implemented. [store/workflow.ts:52-56]
- **No 404 catch-all route** — Navigating to unknown URLs renders the header with empty content area. No "not found" page. Not in story 1.1 scope. [App.tsx:18-21]

## Deferred from: code review of story-1-2 (2026-03-25)

- **Concurrent read-modify-write race on workflow JSON arrays** — All MCP/REST endpoints that mutate `nodes`/`connections` JSON columns read-then-write without DB locking. Concurrent requests lose updates. [mcp/index.ts, routes/workflows.ts]
- **`markBranchSkipped` incorrectly skips merge/diamond pattern nodes** — Recursive skip marking doesn't account for nodes reachable from both IF branches. Merge nodes get incorrectly skipped. [executor.ts:293-304]
- **No graceful shutdown** — No SIGTERM/SIGINT handlers. WebSocket server, Fastify, and pending executions not cleaned up on process exit. In-progress executions left in `running` status permanently. [index.ts]
- **Broadcaster `close()` doesn't clean up individual client sockets** — Only calls `wss.close()` without iterating clients or clearing subscriptions Map. [broadcaster.ts:124-126]
- **No authentication/authorization on any endpoint** — REST API and MCP tools have zero auth checks. Server binds to 0.0.0.0. Planned for Story 5-2. [routes, mcp]
- **MCP `delete_workflow` doesn't cascade-delete executions** — Orphaned execution records remain. [mcp/index.ts]
- **`disconnect_nodes` Zod schema doesn't enforce either/or constraint** — `connection_id` and `source_node_id`/`target_node_id` are all `.optional()` but the tool requires one or the other. [mcp/index.ts]
- **Duplicate workflow doesn't deep-clone/regenerate node IDs** — Duplicated nodes share same IDs as original, potential cross-workflow collisions. [routes/workflows.ts]
- **`connect_nodes` accepts non-existent node IDs** — No validation that source/target nodes exist in the workflow. Creates invalid connections. [mcp/index.ts]
- **SSE transport: multiple `server.connect(transport)` on single McpServer** — Each SSE connection calls `server.connect(transport)`. May not support concurrent transports. [mcp/index.ts:443-464]
- **`httpRequest` helper doesn't check `resp.ok`** — Non-2xx responses (including HTML error pages) returned as data without error indication. [engine/context.ts:51-62]
- **Empty workflow execution succeeds vacuously** — Workflow with zero nodes passes topological sort and returns `status: 'success'`. Creates phantom execution records. [executor.ts:57,232-234]

## Deferred from: code review of story-1-3 (2026-03-25)

- **No request body validation on any REST mutation endpoint** — POST, PUT, PATCH accept arbitrary types, missing fields, empty bodies. Corrupt data enters DB. Add Fastify JSON schema or Zod validation. [routes/workflows.ts]
- **IF branching is a no-op without `sourceHandle`** — `connect_nodes` MCP tool doesn't set `source_handle`, so connections match neither `'true'` nor `'false'` filter in executor. [executor.ts:266-288]
- **Multiple SSE clients on same McpServer** — Each SSE connection calls `server.connect(transport)`. Second client likely breaks first session. [mcp/index.ts:446-451]
- **No guard against concurrent workflow execution** — Two simultaneous execute requests cause duplicate side effects. Needs per-workflow execution lock. [routes/workflows.ts:185-197]
- **`GET /api/workflows` has no pagination** — Fetches all workflows with full node/connection JSON blobs. [routes/workflows.ts:39-42]
- **`toWorkflow` duplicated in REST routes and MCP server** — Identical mapping logic will drift on schema changes. Extract to shared utility. [routes/workflows.ts, mcp/index.ts]
- **`connect_nodes` allows self-connections and dangling node refs** — No validation that source/target IDs exist or differ. [mcp/index.ts:196-220]
- **Dead `sentToSubscribers` variable** — Fallback broadcast logic JSDoc'd but never implemented. [broadcaster.ts:110]
- **PATCH server test only checks route registration** — Needs proper DB mock + broadcast assertion test. [health-and-routes.test.ts:145]
- **MCP tools test doesn't test any tool behavior** — Only verifies `createMcpServer()` returns an object. [mcp-tools.test.ts]
- **Headers model uses object (loses duplicate/empty keys)** — HttpRequestForm uses `Record<string, string>` for headers; should be array of tuples. [HttpRequestForm.tsx]
- **DefaultForm stale `text` state on external config change** — `useState` initializer runs once; WS updates show stale JSON. [DefaultForm.tsx]
- **`set` node maps to `CodeNode` in canvas registry** — Shows "No code" instead of logic display. [node-registry.ts:15]
- **No duplicate guard for `node_added`/`connection_added` WS messages** — Replays or echoes create duplicates. [store/workflow.ts]
- **`workflow_updated` version field never incremented** — All executions reference version 1. [routes/workflows.ts]

## Deferred from: code review of story-1-4 (2026-03-26)

- **Race condition: read-modify-write without DB locking** — All new REST endpoints (PATCH node, DELETE node, POST/DELETE connection) use read-then-write without optimistic locking. Pre-existing architectural pattern. [routes/workflows.ts]
- **No input validation/schema on request bodies** — New endpoints trust request body shape without Fastify JSON schema or Zod validation. Pre-existing pattern. [routes/workflows.ts]
- **No authentication on endpoints** — Planned for Epic 5, Story 5-2. [routes/workflows.ts]
- **No Protected Zones enforcement on node write endpoints** — PATCH/DELETE node and DELETE connection don't check zones. Planned for Epic 3. [routes/workflows.ts]
- **Switch node icon resolves to wrong fallback** — `switch` type icon not in icons.ts map, falls back to Code icon. Cosmetic. [ui/lib/icons.ts]

## Deferred from: code review of story-1-5 (2026-03-26)

- **API `Content-Type` forced to JSON on all bodies** — `api.ts:7-8` sets `Content-Type: application/json` whenever body is truthy. Breaks FormData/Blob. Not triggered by story 1-5.
- **`res.json()` called unconditionally — crashes on 204 No Content** — `api.ts:17` will throw SyntaxError on empty responses. No 204 endpoints in story 1-5.
- **Module-level mutable singletons in ws.ts break test isolation** — `ws.ts:15-23` uses module-scope vars for socket/timers. Pre-existing architecture.
- **IF-node `markBranchSkipped` skips merge nodes in diamond topologies** — `executor.ts:293-304` DFS doesn't check for other incoming paths. Pre-existing.
- **Retry broadcasts failure but not retry success** — `executor.ts:88-95` broadcasts error before retry; successful retry never re-broadcasts. Pre-existing.
- **`node_updated` WS event doesn't sync config into React Flow data** — `workflow.ts:252-278` reducer ignores `config` field from server broadcast. Pre-existing.
- **`updateNode` API return type mismatch** — `api.ts:80` expects `{ updated, node_id }` but server returns `{ node }`. Pre-existing.
- **No debounce on sidebar name input** — `NodeConfigSidebar.tsx:74-79` fires API call per keystroke. Pre-existing.
- **`handleConfigChange` useCallback has unstable `wfNode` dep** — `NodeConfigSidebar.tsx:83-88` memoization is ineffective. Pre-existing.
- **CodeNode conflicting `truncate` + `whitespace-pre-wrap`** — `CodeNode.tsx:19` CSS conflict. Pre-existing.
- **Stack trace display missing from sidebar error panel** — AC #2 calls for stack trace but `NodeExecutionData.error` is a single string. Deferred: error string sufficient for MVP.

## Deferred from: code review of story-1-6 (2026-03-27)

- **`timeAgo` returns "just now" for invalid/future dates** — If `updatedAt` is NaN or future, all interval comparisons fail silently → "just now". Pre-existing data boundary issue; `updatedAt` comes from server.
- **`request()` breaks on 204 No Content** — `res.json()` called unconditionally; DELETE returning 204 would crash. Already tracked as issue #17 from story 1-5.
- **Dialog dismissed before async delete completes** — `handleDeleteConfirm` nulls `deleteTarget` immediately before awaiting API. On failure, error shows but dialog is gone; retry requires re-initiating. UX pattern decision.

## Deferred from: code review of story-6-1 (2026-03-28)

- **`broadcast()` sends to all clients — no team-level subscription filter** — Agent teams events use global broadcast; all connected UI clients receive every team's events. Architecture decision for Story 6.3 team subscription mechanism.
- **`recentMessages` hard-coded to 5 vs `get_agent_messages` default 20** — Cosmetic inconsistency between snapshot and direct message query. `recentMessages` is intentionally brief; full messages available via `get_agent_messages`.
- **No file size guard before JSON parse** — `readFile` loads full file into memory without size check. Pre-existing pattern across all file reads in codebase.
- **`computeProgress` gives no signal for "all blocked" vs "just started"** — Progress is a single 0-100 number; no breakdown by status. UX concern for Story 6.3 dashboard.

## Deferred from: code review of story-6-2 (2026-03-28)

- **Race condition in read-modify-write (appendToInbox/writeTasksFile)** — Concurrent calls can lose messages/task updates. Accepted per dev notes: single server process + atomic writes.
- **`generateId` uses 8 hex chars (32 bits entropy)** — Birthday collision at ~65K tasks. Low practical risk for agent team scale.
- **No cleanup of `taskNodeLinks` when nodes are deleted** — Dangling links possible after node removal. Address in future story with cascade or cleanup logic.

## Deferred from: code review of story-6-3 (2026-03-28)

- **`connectGlobal` subscription fragility** — Empty `workflowId` is falsy so server doesn't store the subscription. Works today because `broadcast()` sends to ALL clients, but fragile if broadcast logic is ever changed to filter by subscription. [broadcaster.ts:32]
- **No pagination on messages endpoint** — `/api/teams/:teamName/messages` returns all messages in a single response. For long-running teams with many agents, this could cause memory pressure. [teams.ts routes]
- **Error response body not parsed in `api.ts` `request()`** — `throw new Error(res.statusText)` discards the server's descriptive error body. Pre-existing pattern across all API calls. [api.ts:14-17]
- **Duplicate `DashboardMessage` type across 3 files** — Defined independently in server routes, UI store, and MessageFeed component. Spec allows local types but may drift. Consider extracting to shared types.
- **Agent status doesn't update in real-time via WS** — Agent status (active/idle/blocked) is computed server-side in `buildTeamSnapshot`. WS events update tasks and messages but don't recompute agent status. Requires server-side push or client-side status inference. [store/teams.ts]

## Deferred from: code review of story-6-4 (2026-03-28)

- **Race condition: TOCTOU on workflow node mutation endpoints** — All node/connection PATCH/DELETE endpoints read-then-write workflow JSON without locking. Concurrent requests silently drop mutations. Pre-existing architectural pattern. [routes/workflows.ts]
- **connection_removed WS handler drops ALL connections between two nodes** — When `connection_id` is absent, filter removes by source+target only, ignoring handles. Multiple connections between same nodes all removed. [store/workflow.ts:344-352]
- **node_updated WS reducer IIFE spreads unknown payload fields into node data** — When `data.changes` is falsy, entire WS message payload (minus node_id) is spread as node properties, potentially corrupting data. [store/workflow.ts]
- **updateNodePosition debounce captures stale workflow state** — The 500ms debounced server write uses `updatedWorkflowNodes` from call-time closure. Concurrent config changes between call and timeout are overwritten. [store/workflow.ts]
- **add_task MCP tool doesn't require watching, update_task does** — Inconsistent behavior; add_task also leaks full filesystem path in error messages. [mcp/tools/agent-teams.ts]
- **Duplicate link_task_to_node inserts — unique constraint error unhandled** — Calling the tool twice with same params throws a raw DB error instead of a friendly message. [mcp/tools/agent-teams.ts]
- **workflow_updated WS handler explicitly discards nodes/connections** — Server-sent node/connection updates are silently overridden by local state. [store/workflow.ts:365-371]
- **duplicate endpoint copies node IDs verbatim** — Duplicated workflow shares node IDs with original, causing cross-workflow taskNodeLink ambiguity. [routes/workflows.ts]
- **API client throws generic status text, drops server JSON error body** — Users see "API 404: Not Found" instead of descriptive server errors. [ui/lib/api.ts]
- **Module-level mutable singletons not test-safe** — `saveTimeout`, `configSaveTimeouts`, `loadRequestId` persist across tests without auto-reset. [store/workflow.ts]
- **WS subscribe with empty workflowId skips subscription registration** — Global connections never added to subscriptions map. Works because `broadcast()` sends to all, but fragile. [broadcaster.ts:32]
- **appendToInbox not atomic under concurrent writes** — Two concurrent `send_team_message` calls can lose messages via read-modify-write race. [parser.ts]
- **validateName allows dot-prefix names** — Creates hidden directories under `~/.claude/teams/`. [watcher.ts]
- **Team events broadcast to ALL clients** — No team-level subscription filtering. All clients receive every team's events. [watcher.ts]
- **No cycle detection in connection creation** — Self-connections rejected but A→B→C→A cycles allowed, risking executor infinite loops. [routes/workflows.ts]
- **Path traversal risk in get_agent_messages/send_team_message** — Filesystem path constructed from user input with only validateName between user and disk. [mcp/tools/agent-teams.ts]

## Deferred from: code review of story-4-3 (2026-03-28)

- **Hardcoded dev secrets in docker-compose.yml** — JWT_SECRET and ENCRYPTION_KEY are plaintext defaults; needs .env file or Docker secrets for production deployment
- **REDIS_URL configured but not consumed by server** — BullMQ/Redis integration is a future epic; env var is provisioned early

## Deferred from: code review of story-1-7 (2026-04-08)

- **List executions endpoint doesn't 404 for unknown workflow id** — `GET /api/workflows/:id/executions` silently returns `{executions: []}`; other endpoints in the same file 404. Inconsistent. [api/routes/workflows.ts:307-317]
- **AC #3 partial: error message/stack only visible on click** — When an execution has an errored node, consider auto-selecting the first errored node so the trace panel opens by default. Currently the user must hunt and click.
- **`executions.startedAt` is nullable** — Schema has `defaultNow()` but no `.notNull()`. `desc(startedAt)` ordering puts NULLs first in Postgres. Add `.notNull()` to schema. [db/schema.ts:47]
- **No server-route tests for new execution endpoints** — Story added UI tests only. The IDOR scoping bug fixed in this review (executionId not filtered by workflowId) would have been caught by one server test.
- **Test coverage gaps in ExecutionDetail** — No test for "node-in-workflow-but-not-in-execution" gray-dashed styling, `pending`/`cancelled` status rendering, or the new "workflow deleted" degraded view.
- **`miniMapNodeColor` weakly typed** — Parameter typed as `{ type?: string }`; should be `Node` from `@xyflow/react`. [pages/ExecutionDetail.tsx:121]
- **`StatusBadge` duplicated** — Reimplemented identically in `ExecutionHistory.tsx` and `NodeTracePanel.tsx`. Extract to shared component to prevent drift.

## Deferred from: code review of story-2-2 (2026-04-08)

- **M1 — `apply_fix` missing workflow-existence preamble check** — `get_review_context`, `save_annotations`, and `get_health_score` all verify the workflow exists before doing work; `apply_fix` relies on the downstream handler throw and funnels "not found" through the generic `Fix failed: …` catch. Add the standard `workflows.id` lookup at the top of the `apply_fix` callback. [packages/server/src/mcp/tools/review.ts:224]
- **M2 — `apply_fix` wraps handler validation errors as "Fix failed: …"** — When `handleUpdateNode` throws `Node n1 not found` on a stale annotation, Claude sees a wrapped message and must parse to distinguish dispatch failures from target-state failures. Consider forwarding `err.message` unwrapped or returning a structured `{ error, cause }` payload. [packages/server/src/mcp/tools/review.ts:247-252]
- **L1 — `handleUpdateNode` (and siblings) mutate `wf.nodes` in place** — Pre-existing from Stories 5-6 but now reachable via a second entry point (the fix dispatcher), doubling the call sites sharing mutable `WorkflowNode[]` references. No concrete bug today because each handler re-reads the row, but it is a trap for future batched-fix callers. Consider cloning nodes on load. [packages/server/src/mcp/index.ts:110-125]
- **L2 — Duplicate "Unknown fix tool" message construction** — `UnknownFixToolError` constructor already builds `Unknown fix tool: ${toolName}`; `apply_fix` catch rebuilds the same string from `err.toolName` instead of using `err.message`. Collapse to `return mcpError(err.message)`. [packages/server/src/review/fix-dispatcher.ts:16, packages/server/src/mcp/tools/review.ts:249]
- **L3 — `fix-dispatcher` uses module-level global `handlers` Map** — Fine for one-server-per-process MVP, but `clearFixHandlers()` is a test-only leak and multiple `McpServer` instances in the same process would stomp each other. Either document the constraint or move the map onto a `FixDispatcher` instance threaded through `createMcpServer()` + `registerReviewTools()`. [packages/server/src/review/fix-dispatcher.ts:21]
- **L4 — `HealthScoreResult.review_type` typed `string | null` but store returns non-null** — `getLatestReview` types `reviewType` as `string`; the wire shape widens it to `string | null` to accommodate the "no review" all-null branch. Harmless; could be split into `HealthScoreResult` (present) and `HealthScoreEmptyResult` (absent) for precision. [packages/shared/src/types/annotation.ts:52]

## Deferred from: code review of story-1-8 (2026-04-08)

- **Server smoke test for settings/audit is mock-heavy** — `packages/server/src/__tests__/settings-and-audit.test.ts` stubs out `db`, `db/schema`, and `drizzle-orm` entirely, so it only validates Fastify glue, not real drizzle/SQL wiring. A refactor of `settings.ts` could break the actual DB and tests would still pass. Migrate to the project's shared in-memory test DB harness when one is established. [packages/server/src/__tests__/settings-and-audit.test.ts]
- **Out-of-scope schema additions rode this story** — `taskNodeLinks` table and `executions.workflowId.notNull()` tightening landed in `db/schema.ts` alongside `instanceSettings`. They belong to other stories; flag for sprint hygiene. [db/schema.ts]
- **`audit.ts` masks NULL timestamps with `new Date()`** — `toEntry` coalesces a null `row.timestamp` to "now", which corrupts sort order and hides data integrity issues. Either filter NULLs at the query layer or surface them as null in the response. [api/routes/audit.ts:10]
- **`EditorBreadcrumb` uses unsafe cast for `workflow.review`** — Acknowledged in story (Epic 2 will add the field). Add `// TODO(Epic 2)` comment and remove the cast when `Workflow.review` ships in shared types. [components/editor/EditorBreadcrumb.tsx:25]
- **Settings page test selects inputs by index** — `screen.getAllByRole('textbox')[1]` is brittle. Add `aria-label="Error workflow ID"` to the input and switch test to `getByLabelText`. [pages/Settings.tsx, __tests__/settings-page.test.ts]
- **ExportDialog has no outside-click / Esc to close** — Other modals in the app should be checked for consistency; pick a pattern and apply uniformly. [components/editor/ExportDialog.tsx]

## Deferred from: code review of story-2-3 (2026-04-08)

- No auth/authorization on review REST routes — project-wide, Epic 5 [packages/server/src/api/routes/review.ts]
- No Fastify schema validation on params/body — project-wide pattern [packages/server/src/api/routes/review.ts]
- `getReviewContext` orders by nullable `startedAt` — pre-existing from Story 2.1 [packages/server/src/mcp/tools/review.ts:308-313]
- `toWorkflow` substitutes `new Date().toISOString()` for null timestamps — pre-existing [packages/server/src/mcp/tools/review.ts:201-202]
- Dead `annotation_added` handler / payload shape drift — server never emits this event [packages/ui/src/store/review.ts:649-656]
- Orphan annotation when target node deleted has no recovery UI [packages/ui/src/components/canvas/review/ReactFlowAnnotationLayer.tsx:932-934]
- `/review/request` has no server-side throttle; no `review_requested` store visualization (Story 2.4) [packages/server/src/api/routes/review.ts:143-155]
- Missing error-path test coverage: apply-on-applied, cross-workflow annotation id, concurrent apply, clipboard-undefined branch

## Deferred from: code review of story-4-2 (2026-04-09)

- **M1: Dead-end check stricter than AC#4 literal wording** — `validation/checks/dead-ends.ts:24-31` anchors on `respond-webhook` nodes only; AC#4 also mentions terminal non-trigger nodes. Intentional simplification per Dev Notes ("anchors = respond-webhook nodes only"); workflows without any respond-webhook skip the check entirely. Document as intentional or amend AC in a future doc pass. [packages/server/src/validation/checks/dead-ends.ts]
- **M2: Recursive DFS in `findCycles` can overflow the stack on deep graphs** — `validation/checks/cycles.ts:23-49` uses recursion with no depth bound. Fine for MVP; convert to iterative with an explicit stack if a large imported n8n workflow ever trips Node's default frame limit. [packages/server/src/validation/checks/cycles.ts]
- **M3: `expression-syntax-error` can false-positive on unsupported-node placeholders** — `import/n8n-mapper.ts:75-83` embeds original n8n parameters as JSON inside the generated `code` string. If original params contain unbalanced `{{` / `}}`, the validator will warn on the placeholder. Low-severity (warning, not error). Consider adding a comment in `n8n-mapper.ts` or skipping the check for nodes with the "Imported from n8n" header. [packages/server/src/import/n8n-mapper.ts, packages/server/src/validation/checks/expressions.ts]
- **M4: Imported n8n `if` nodes always fail `missing-required-config`** — n8n's `if` uses `conditions` (plural, structured); flowAIbuilder requires `condition` (singular). The importer copies parameters verbatim, so every imported n8n `if` surfaces a validation error. Intentional "mismatches surface via validation" pattern per Dev Notes, but the UI import toast currently only lists *type-unsupported* warnings, not *config-mismatched* nodes. Consider enriching the import warnings array to hint at known field-name mismatches. [packages/server/src/import/n8n-mapper.ts]
- **M5: `findCycles` dedupes cycles by sorted node set** — `validation/checks/cycles.ts:32` collapses two distinct cycles that share the same node set (e.g., A→B→C→A and A→C→B→A in a fully-connected triangle) into one issue. Probably desired to avoid noise; document intent or revisit if edge cases surface. [packages/server/src/validation/checks/cycles.ts]
- **Nit: Duplicated `text()` / `mcpError()` helpers across MCP tool files** — `mcp/tools/import.ts`, `mcp/tools/validate.ts`, and `mcp/tools/export.ts` each redeclare the same 3-line helpers. Matches existing pattern; consolidate all three at once if ever extracted to a shared util. [packages/server/src/mcp/tools/]

## Deferred from: code review of story-2-4 (2026-04-08)

- **Continuous-review debounce timer is module-global** — `let continuousReviewTimer` in `packages/ui/src/store/workflow.ts:39` lives at module scope rather than per-store state. Works today (single store instance, cleared by `cancelPendingSaves`), but leaks across Vitest cases sharing the module and would break if multiple stores ever existed. Move onto store state when convenient.

## Deferred from: code review of story-5-2-authentication-rbac (2026-04-09)

- **No rate limiting on `/api/auth/login`, `/api/auth/register`, and SSO routes** — scrypt is expensive on purpose, but also runs on the libuv thread pool (4 workers by default); concurrent login attempts saturate crypto workers and DoS the server, and there is nothing in front of brute-force attempts. Add `@fastify/rate-limit` with per-IP limits on auth endpoints.
- **No CSRF protection for cookie-based mutating endpoints** — session cookie is `SameSite=Lax` only; state-changing endpoints accept the cookie with no CSRF token. Add a CSRF token mechanism (double-submit or `@fastify/csrf-protection`) for browser clients.
- **`captureBefore` snapshot missing for `PUT/DELETE /api/users/:id`** — existing audit middleware only captures before-state for workflow routes. User updates/deletes log `changes.before = null`. Already flagged in story Completion Notes as a follow-up tied to the audit-middleware refactor in 5.3/5.4.
- **Password policy is `min(8)` only** — no complexity, no breach-list check, no max-length enforcement in the register schema (covered separately as a patch). Revisit with a proper policy.
- **`verifyPassword` trusts scrypt `N/r/p` from the stored hash string** — an attacker with DB write access can set `N=2^30` to DoS verify or `N=1` to downgrade. Add bounds on accepted parameters in `auth/password.ts`.
- **RBAC matrix uses `startsWith('/api/users')`** — matches any future `/api/users-foo`, `/api/usersettings` routes as admin-only. No such routes today; tighten to exact-prefix (`/api/users/` or `=== '/api/users'`) when any are added.
- **stdio MCP mode still opens the HTTP listener** — `isStdio` branch in `packages/server/src/index.ts` does not suppress `server.listen`. Pure stdio workflows shouldn't expose HTTP MCP endpoints from the same process.
- **`touchSession` writes on every authenticated request** — no throttling, creates write amplification on busy sessions. Add a 60s skip window (compare `lastSeenAt` before updating).

## Deferred from: code review of story 5-4 (2026-04-10)

- **MCP routes bypass RBAC entirely** — `rbac-routes.ts` returns null for `/mcp/*`. Pre-existing design; MCP has its own RBAC via `minRoleForMcpTool` in `mcp/rbac.ts`. Not caused by story 5.4.
- **`request.user` fallback to 'api' when auth middleware absent** — Pre-existing pattern across all routes. Operations succeed with actor "api" when auth is not configured. Revisit with auth hardening.
- **Decryption failures silently swallowed in loadSecrets** — `executor.ts` catches and discards decrypt errors. Workflows referencing failed secrets get "not found" instead of "decrypt failed". Add structured logging.

## Deferred from: code review of story 5-5 (2026-04-10, Group A)

- **W1: `manage_secrets` mapped as viewer in RBAC readOnly set** — `mcp/rbac.ts:66`. Pre-existing from Story 5.4. Secret management should require editor role.
- **W2: `maxRetriesPerRequest: null` causes indefinite hangs when Redis unreachable** — `queue/manager.ts:20`, `queue/worker.ts:22`. Required by BullMQ but no startup health check or timeout exists.
- **W3: Destination cache stale for 10s after config update** — `logging/streamer.ts:22`. Acceptable tradeoff per spec, but no cache invalidation on write.
- **W4: stdio transport unconditionally bypasses RBAC** — `mcp/rbac.ts:30`. By design per Story 5.2; document security assumption.

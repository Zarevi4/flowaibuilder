# Story 5.1: Audit Logging & Execution Traces

Status: done

## Story

As an operator,
I want every API and MCP action logged with full context and queryable execution traces,
so that I have a complete audit trail for compliance and debugging.

## Acceptance Criteria

1. **Given** any REST API or MCP tool call is made, **When** the request is processed, **Then** an audit entry is written to the `audit_log` table containing: `timestamp`, `actor` (user email or `mcp:claude-code`), `action` (e.g. `workflow.created`, `node.updated`, `execution.started`), `resource_type`, `resource_id`, `changes` (`{ before, after }` for mutations), and `metadata` (`{ ip, user_agent, mcp_tool }`).

2. **Given** a REST mutation fails (validation error, 4xx/5xx), **When** the handler returns, **Then** no audit entry is written for that failed mutation (audit reflects actual state changes only); read-only GETs are NOT audited to avoid log flood.

3. **Given** the audit log has entries, **When** the MCP tool `flowaibuilder.get_audit_log({ workflow_id?, user?, action?, since?, limit? })` is called, **Then** matching entries are returned — `workflow_id` filters by `resource_id` (when `resource_type='workflow'`) OR by entries whose `metadata.workflow_id` matches; `user` filters by `actor`; `since` filters entries newer than the ISO timestamp; `limit` caps at 500, defaults to 100; results ordered by `timestamp DESC`.

4. **Given** the audit log has entries, **When** `GET /api/audit-log?workflow_id=&user=&since=&limit=` is called, **Then** the same filter semantics apply as the MCP tool and the existing REST route is extended accordingly.

5. **Given** an execution has completed (row exists in `executions`), **When** `flowaibuilder.get_execution_log({ execution_id, detail_level })` is called, **Then**:
   - `summary` → `{ id, workflow_id, status, started_at, finished_at, duration_ms, node_count, error? }`
   - `full` → summary + `node_executions[]` with per-node `{ nodeId, status, input, output, duration_ms, error? }`
   - `debug` → full + `trigger_data`, `result_data`, and any engine metadata present on the row
   - Missing `execution_id` → MCP error `Execution <id> not found`.

6. **Given** the audit logger, **When** serializing `changes` for mutation events, **Then** fields containing secrets/credentials (`password_hash`, `$secrets.*` values, `value` on credentials table) are redacted to `"[REDACTED]"` before being written — the plaintext never reaches the DB.

7. **Given** any write to `audit_log`, **When** the logger throws (DB down, serialization failure), **Then** the error is caught, logged to `app.log.error`, and the triggering request still succeeds — audit failures MUST NOT break user operations.

## Tasks / Subtasks

- [x] Task 1: Audit logger service (AC: #1, #6, #7)
  - [x] 1.1 Create `packages/server/src/audit/logger.ts` exporting `AuditLogger` with `log(entry: AuditEntryInput): Promise<void>` that inserts into `auditLog`; catch & swallow errors via `app.log.error`.
  - [x] 1.2 Export `AuditEntryInput` type (actor, action, resourceType, resourceId, changes?, metadata?).
  - [x] 1.3 Implement `redactSecrets(obj)` helper that deep-clones and replaces any key matching `/password|secret|api_?key|token|credential|value$/i` with `"[REDACTED]"`; use it on `changes.before` and `changes.after` before insert.
  - [x] 1.4 Register the logger on the Fastify instance: `app.decorate('audit', new AuditLogger(app))` in `packages/server/src/index.ts`.
  - [x] 1.5 Augment the Fastify type declarations in `packages/server/src/types/fastify.d.ts` (create if missing) so `app.audit` is typed.

- [x] Task 2: REST auto-logging plugin (AC: #1, #2)
  - [x] 2.1 Create `packages/server/src/api/middleware/audit.ts` as a Fastify plugin using the `onResponse` hook.
  - [x] 2.2 Skip if `request.method === 'GET'`, if `reply.statusCode >= 400`, or if `request.url` starts with `/api/audit-log` (to avoid recursion) or `/api/health`.
  - [x] 2.3 Map URL + method to action string via a small resolver (e.g. `POST /api/workflows` → `workflow.created`, `PUT /api/workflows/:id` → `workflow.updated`, `DELETE` → `workflow.deleted`, `POST /api/workflows/:id/execute` → `execution.started`, etc.). Unknown routes → `api.<method>.<firstSegment>`.
  - [x] 2.4 Extract `actor` from `request.user?.email` when auth is wired; fall back to `"anonymous"` (auth lands in Story 5.2 — leave the hook in place).
  - [x] 2.5 Populate `metadata`: `{ ip: request.ip, user_agent: request.headers['user-agent'], route: request.routeOptions?.url }`.
  - [x] 2.6 For mutations on `/api/workflows/:id`, capture `before` snapshot in a `preHandler` hook (read current row) and `after` from `reply.payload`; for create/delete only one side is populated.
  - [x] 2.7 Register the plugin in `packages/server/src/index.ts` AFTER routes are registered.

- [x] Task 3: MCP tool auto-logging (AC: #1)
  - [x] 3.1 In `packages/server/src/mcp/index.ts`, create a `wrapTool(name, handler)` helper that logs `{ actor: 'mcp:claude-code', action: name, metadata: { mcp_tool: name, args: redactSecrets(args) } }` after a successful handler invocation.
  - [x] 3.2 Apply `wrapTool` around every `server.tool(...)` registration in `mcp/index.ts` and `mcp/tools/*.ts`. Do NOT log if the handler throws.
  - [x] 3.3 For mutating tools that touch a specific resource (e.g. `update_workflow`, `add_node`, `pin_node`), set `resource_type`/`resource_id` from the tool args.

- [x] Task 4: Extend REST `/api/audit-log` route (AC: #3, #4)
  - [x] 4.1 In `packages/server/src/api/routes/audit.ts`, add query params `workflow_id` and `since` to `AuditQuery`.
  - [x] 4.2 When `workflow_id` is present, add filter: `(resource_type = 'workflow' AND resource_id = :wf) OR metadata->>'workflow_id' = :wf`. Use Drizzle `sql` template for the JSON lookup.
  - [x] 4.3 When `since` is present, parse as ISO date and add `timestamp >= :since` filter; 400 on invalid date.
  - [x] 4.4 Rename existing `actor` param to also accept `user` alias for parity with the MCP tool.

- [x] Task 5: MCP tool `flowaibuilder.get_audit_log` (AC: #3)
  - [x] 5.1 Create `packages/server/src/mcp/tools/audit.ts` exporting `registerAuditTools(server, app)`.
  - [x] 5.2 Define zod schema: `{ workflow_id?: string, user?: string, action?: string, since?: string (iso), limit?: number (1-500, default 100) }`.
  - [x] 5.3 Reuse the same filter builder as the REST route — extract it into `audit/query.ts` so both call sites share logic.
  - [x] 5.4 Return `{ entries: AuditLogEntry[] }` matching the shared type.
  - [x] 5.5 Wire `registerAuditTools` into `packages/server/src/mcp/index.ts`.

- [x] Task 6: MCP tool `flowaibuilder.get_execution_log` (AC: #5)
  - [x] 6.1 In `packages/server/src/mcp/tools/audit.ts`, add a second tool with schema `{ execution_id: string, detail_level: 'summary'|'full'|'debug' (default 'summary') }`.
  - [x] 6.2 Load the row from `executions` via `db.select().from(executions).where(eq(executions.id, execution_id))`; throw `McpError('Execution <id> not found')` on miss.
  - [x] 6.3 Build the response shape per detail level exactly as in AC #5. Redact via `redactSecrets` on `input`/`output`/`trigger_data`/`result_data` before returning.
  - [x] 6.4 Emit an audit entry for `execution.log.read` with `resource_id = execution_id` and `metadata.detail_level`.

- [x] Task 7: Tests (AC: #1, #2, #3, #5, #6, #7)
  - [x] 7.1 Extend `packages/server/src/__tests__/settings-and-audit.test.ts`:
    - POST `/api/workflows` writes a `workflow.created` audit entry; DELETE writes `workflow.deleted` with `before` snapshot.
    - GET `/api/workflows` writes NO entry.
    - Failed POST (400) writes NO entry.
    - `/api/audit-log?workflow_id=X&since=...` returns filtered entries.
  - [x] 7.2 New test file `packages/server/src/__tests__/audit-mcp.test.ts` exercising `get_audit_log` and `get_execution_log` via the MCP server in-process. Include detail_level matrix and missing-execution error case.
  - [x] 7.3 Unit test `redactSecrets`: nested objects, arrays, case-insensitive key match, non-mutation of input.
  - [x] 7.4 Fault-injection test: logger insert rejects → request still returns 200 and `app.log.error` is called.

## Dev Notes

### Context & constraints

- Audit log table already exists in `packages/server/src/db/schema.ts:53` (`auditLog`). Do NOT alter the schema — use it as-is. Fields: `id, timestamp, actor, action, resourceType, resourceId, changes, metadata`.
- REST `GET /api/audit-log` is already wired at `packages/server/src/api/routes/audit.ts:28`. This story EXTENDS it with `workflow_id` + `since`; it does NOT rewrite it.
- Shared type `AuditLogEntry` lives in `@flowaibuilder/shared` and is already imported — keep MCP + REST responses on this type.
- Zero-cost AI model: the audit logger never calls Claude. It only writes to Postgres. See `CLAUDE.md` → "Zero-cost AI model".
- MCP-first principle: both tools must exist as MCP tools FIRST, REST extension second (the REST route already existed so it's a parallel track). See `CLAUDE.md` → "MCP-first".
- Protected Zones: this story does NOT touch zones. Zone enforcement is unrelated here; audit logging runs regardless of zone state. Do not import `ZoneEnforcer`.
- Auth is not in place yet (Story 5.2). Use `request.user?.email ?? 'anonymous'` so the plugin is ready when auth lands — don't block on it.

### Why audit failures must not break requests (AC #7)

If a DB hiccup takes out audit inserts and that bubbles into user requests, a logging subsystem becomes an availability problem. Catch, log, continue. The audit trail is "best effort with alerting", not "blocking write".

### Redaction is mandatory even before Story 5.4

Story 5.4 introduces `$secrets.*` — but HTTP Request nodes today may already contain `Authorization` headers in their config, and Code nodes may print tokens. Add redaction NOW so enabling audit logging doesn't become a credential exfiltration vector the moment secrets land.

### Source tree touched

```
packages/server/src/
  audit/
    logger.ts            # NEW — AuditLogger service + redactSecrets
    query.ts             # NEW — shared filter builder (REST + MCP)
  api/
    middleware/
      audit.ts           # NEW — Fastify plugin, auto-logs mutations
    routes/
      audit.ts           # EXTEND — add workflow_id + since filters
  mcp/
    index.ts             # EXTEND — wrapTool helper, register audit tools
    tools/
      audit.ts           # NEW — get_audit_log + get_execution_log
  __tests__/
    settings-and-audit.test.ts  # EXTEND
    audit-mcp.test.ts           # NEW
  types/
    fastify.d.ts         # NEW (or extend) — declare app.audit
  index.ts               # EXTEND — decorate + register plugin
```

### Testing standards

- Framework: existing tests use node's built-in test runner with an in-memory stub DB (see `__tests__/settings-and-audit.test.ts` lines 69-116 for the pattern). Continue that pattern — do NOT introduce a new test framework.
- Each AC maps to at least one test.
- Prefer in-process Fastify `app.inject` for REST tests and direct `server.tool` handler invocation for MCP tests.

### Project Structure Notes

- The `audit/` directory is new at `packages/server/src/audit/` per the architecture doc (`architecture.md` line 91-93). Keep it co-located with the service layer.
- `wrapTool` lives in `mcp/index.ts` next to the MCP server bootstrap — do not create a separate `mcp/middleware.ts` for a single helper.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.1]
- [Source: _bmad-output/planning-artifacts/architecture.md#audit_log (line 260-272)]
- [Source: _bmad-output/planning-artifacts/architecture.md#audit folder (line 91-93)]
- [Source: CLAUDE.md#Zero-cost AI model]
- [Source: CLAUDE.md#MCP-first]
- [Source: packages/server/src/db/schema.ts:53 — auditLog table]
- [Source: packages/server/src/api/routes/audit.ts — existing GET route to extend]

## Dev Agent Record

### Agent Model Used

claude-opus-4-6[1m]

### Debug Log References

- Initial test run failures: audit-mcp used top-level state var inside vi.mock (hoisting) — fixed with vi.hoisted.
- Pre-existing stale `dist/` compiled tests were being picked up by vitest — added `packages/server/vitest.config.ts` with `exclude: ['dist/**']`.
- Pre-existing `settings-and-audit.test.ts` mock lacked `onConflictDoNothing` — added to the insert chain so `getOrCreateSettings()` now resolves correctly under the mock.

### Completion Notes List

- Implemented `AuditLogger` + `redactSecrets` in `packages/server/src/audit/logger.ts`. Redaction is deep, case-insensitive, and non-mutating. Keys matching `password|secret|api_key|token|credential|authorization` plus bare `value` are replaced with `"[REDACTED]"` before insertion. Errors in the DB insert are caught and routed through `app.log.error` — the triggering request still completes (AC #7).
- Built a shared query builder in `packages/server/src/audit/query.ts` with `buildAuditFilters` + `queryAuditLog`. The REST route and the `get_audit_log` MCP tool both call into this single implementation, so filter semantics for `workflow_id`, `user`/`actor`, `action`, `since`, and `limit` stay in lockstep (AC #3/#4). `workflow_id` matches either `resource_type='workflow' AND resource_id` OR `metadata->>'workflow_id'`.
- REST route `/api/audit-log` (`packages/server/src/api/routes/audit.ts`) extended with `workflow_id`, `since`, and `user` alias for `actor`. Invalid `since` dates return 400.
- REST auto-audit plugin at `packages/server/src/api/middleware/audit.ts` (`registerAuditMiddleware`). Uses `preHandler` to capture before-snapshots on workflow mutations, `onSend` to snapshot response bodies, and `onResponse` to write the audit entry. It skips GETs, 4xx/5xx responses, `/api/audit-log`, `/api/health`, and `/mcp/*` (AC #1/#2). Actor falls back to `anonymous` until Story 5.2 wires auth. `resolveAction` exposed for testability.
- MCP auto-audit via `wrapTool` inside `createMcpServer` — overrides `server.tool` so every tool handler is wrapped. Successful invocations write an audit entry tagged `actor='mcp:claude-code'`, with `resource_type`/`resource_id` inferred from `workflow_id`/`execution_id`/`node_id` args. Failing handlers do NOT log. `get_audit_log` and `get_execution_log` are excluded to avoid recursion.
- `flowaibuilder.get_audit_log` and `flowaibuilder.get_execution_log` MCP tools live in `packages/server/src/mcp/tools/audit.ts` (`registerAuditTools`), registered inside `createMcpServer` with a reference to the Fastify app so the execution-log read emits its own audit entry. `get_execution_log` supports `summary`/`full`/`debug` detail levels, redacts `input`/`output`/`trigger_data`/`result_data`, and throws `Execution <id> not found` on misses (AC #5).
- Wired the logger + middleware in `packages/server/src/index.ts`: `registerAuditLogger(server)` before routes, `registerAuditMiddleware(server)` after all REST routes, and `createMcpServer(server)` so MCP tools get access to `app.audit`.
- Added Fastify type augmentation in `packages/server/src/types/fastify.d.ts` for `app.audit`, `request.auditBefore`, `request.auditSkip`, `request.auditMeta`.
- Tests: `audit-logger.test.ts` (redaction matrix + fault-injection for AC #7), `audit-middleware.test.ts` (resolveAction mapping, success/GET/4xx behaviour, before-snapshot on DELETE), `audit-mcp.test.ts` (get_audit_log + all three detail levels for get_execution_log + missing execution error), and extended `settings-and-audit.test.ts` with `workflow_id`/`since`/`limit` filter-accepting + invalid-date 400 cases. Full server suite: **211/211 passing**.
- Added `packages/server/vitest.config.ts` to exclude stale `dist/**` from test collection — this was masking stale compiled tests that still referenced old sources.

### File List

**New:**
- packages/server/src/audit/logger.ts
- packages/server/src/audit/query.ts
- packages/server/src/api/middleware/audit.ts
- packages/server/src/mcp/tools/audit.ts
- packages/server/src/types/fastify.d.ts
- packages/server/src/__tests__/audit-logger.test.ts
- packages/server/src/__tests__/audit-middleware.test.ts
- packages/server/src/__tests__/audit-mcp.test.ts
- packages/server/vitest.config.ts

**Modified:**
- packages/server/src/index.ts
- packages/server/src/mcp/index.ts
- packages/server/src/api/routes/audit.ts
- packages/server/src/__tests__/settings-and-audit.test.ts

## Change Log

| Date       | Author            | Description                                                                                                 |
|------------|-------------------|-------------------------------------------------------------------------------------------------------------|
| 2026-04-09 | dev-story (Opus)  | Story 5.1 implementation: audit logger, REST + MCP auto-audit, get_audit_log / get_execution_log MCP tools. |
| 2026-04-09 | code-review (Opus) | P1/P2 fixes: scoped `value`-key redaction to `credentials` parent, added circular-ref WeakSet guard, Date/Buffer/Map/Set passthrough, moved redaction inside try/catch, dropped SQLite dev claim in CLAUDE.md. 213/213 tests passing. Story → done. |

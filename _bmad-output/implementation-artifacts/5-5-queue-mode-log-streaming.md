# Story 5.5: Queue Mode & Log Streaming

Status: done

## Story

As an operator scaling flowAIbuilder,
I want BullMQ-based parallel execution and configurable log streaming,
so that I can handle high workflow volume and centralize operational logs.

## Acceptance Criteria

1. **Given** queue mode is enabled (`QUEUE_MODE=true` env var), **When** a workflow execution is triggered via `POST /api/workflows/:id/execute` or the MCP `flowaibuilder.execute_workflow` tool, **Then** the workflow is enqueued as a BullMQ job in Redis (queue name `workflow-executions`) rather than executed inline, the API returns immediately with `{ id, status: 'queued', workflowId }`, and a `execution_queued` WS broadcast is emitted. The execution record is created with status `'queued'` before enqueueing. When `QUEUE_MODE` is falsy or unset, execution remains inline (current behavior, unchanged).

2. **Given** multiple workflows are triggered simultaneously with queue mode active, **When** the worker processes jobs, **Then** workflows execute in parallel up to the configured concurrency limit (`QUEUE_CONCURRENCY` env var, default `5`). Each worker job calls `workflowExecutor.execute()` with the same arguments as inline mode — the executor is reused, not duplicated.

3. **Given** a BullMQ job fails (executor throws), **When** the job has retries configured, **Then** BullMQ retries according to `QUEUE_RETRY_ATTEMPTS` (default `2`) with exponential backoff (`QUEUE_RETRY_BACKOFF_MS`, default `5000`). On final failure the execution record is updated to `'error'` status and a `execution_completed` WS broadcast with `status: 'error'` is emitted.

4. **Given** log streaming is configured in `instance_settings` via `PUT /api/settings` with `{ logStreamDestinations: [...] }`, **When** execution events occur (execution started, node started, node completed, node error, execution completed), **Then** structured log entries are streamed to ALL configured destinations in near-real-time. Supported destination types: `stdout` (JSON lines to process stdout), `webhook` (HTTP POST to a URL), `s3` (JSON lines uploaded to an S3 bucket with key pattern `logs/{workflowId}/{executionId}/{timestamp}.jsonl`).

5. **Given** multiple log destinations are configured, **When** logs are generated, **Then** they are sent to all configured destinations concurrently. Failures on one destination do not block others. Destination errors are logged to the server's own stdout but do not fail the execution.

6. **Given** queue mode is active, **When** a user calls `GET /api/queue/status`, **Then** the response includes `{ enabled: true, concurrency, waiting, active, completed, failed, delayed, workers }` with counts from BullMQ. When queue mode is off, returns `{ enabled: false }`. Viewers can access this (GET endpoint).

7. **Given** the MCP surface, **When** clients invoke queue/log tools, **Then** the following are registered in `packages/server/src/mcp/tools/queue.ts`:
   - `flowaibuilder.get_queue_status()` — same as `GET /api/queue/status`.
   - `flowaibuilder.configure_log_streaming({ destinations: [...] })` — same as `PUT /api/settings` for log stream config.
   All MCP tools: `get_queue_status` → `viewer`, `configure_log_streaming` → `editor`. Stdio transport bypasses RBAC.

8. **Given** every log streaming configuration change, **When** it completes, **Then** a `log_streaming.configured` audit entry is written with `metadata: { destinations: [{ type, url? }] }` (S3 bucket name and webhook URLs are logged; no secret values). The audit `resolveAction` in `audit.ts` is extended.

9. **Given** the UI, **When** a user navigates to the Settings page, **Then** a new "Log Streaming" section (below Secrets) allows adding/removing log destinations with type selector (stdout/webhook/S3) and type-specific config fields (webhook URL, S3 bucket/region/prefix). A "Queue Status" card on the Dashboard page shows queue health when queue mode is enabled (waiting/active/failed counts, refresh button).

## Tasks / Subtasks

- [x] **Task 1: Shared types & ExecutionMode update** (AC #1, #4, #6)
  - [x] 1.1 Add `'queued'` to the `ExecutionStatus` union in `packages/shared/src/types/execution.ts` — it is needed for the intermediate state between enqueue and worker pickup. The existing union is `'pending' | 'running' | 'success' | 'error' | 'cancelled'`.
  - [x] 1.2 Add `'execution_queued'` to the `WebSocketEventType` union in `packages/shared/src/types/mcp.ts`.
  - [x] 1.3 Create `packages/shared/src/types/queue.ts` exporting:
    - `QueueStatus` interface: `{ enabled: boolean; concurrency?: number; waiting?: number; active?: number; completed?: number; failed?: number; delayed?: number; workers?: number }`
    - `LogDestination` interface: `{ type: 'stdout' | 'webhook' | 's3'; url?: string; bucket?: string; region?: string; prefix?: string; enabled: boolean }`
    - `LogStreamConfig` interface: `{ destinations: LogDestination[] }`
  - [x] 1.4 Re-export from `packages/shared/src/index.ts`.

- [x] **Task 2: DB schema — add log stream columns to instance_settings** (AC #4)
  - [x] 2.1 Add `logStreamDestinations` column to `instanceSettings` in `packages/server/src/db/schema.ts`: `logStreamDestinations: jsonb('log_stream_destinations').default([])` — stores an array of `LogDestination` objects. This is a JSONB column on the existing singleton `instance_settings` table, same pattern as other settings.
  - [x] 2.2 Extend the `InstanceSettings` interface in `packages/shared/src/types/instance-settings.ts` to add `logStreamDestinations?: LogDestination[]`.
  - [x] 2.3 Update `toSettings()` in `packages/server/src/api/routes/settings.ts` to include `logStreamDestinations` (default `[]`).
  - [x] 2.4 Update `PUT /api/settings` handler to accept and persist `logStreamDestinations`. Validate each destination: `type` must be one of `stdout|webhook|s3`; if `type === 'webhook'`, `url` is required and must be `https://` (security); if `type === 's3'`, `bucket` is required. Return 400 on validation failure.

- [x] **Task 3: Queue manager — BullMQ setup** (AC #1, #2, #3, #6)
  - [x] 3.1 Create `packages/server/src/queue/manager.ts`:
    - Initialize `Queue` from `bullmq` with connection from `REDIS_URL` (parse with `ioredis` — the Redis instance is already in docker-compose).
    - Queue name: `workflow-executions`.
    - Export `enqueueExecution(job: { workflowId: string; executionId: string; triggerData?: unknown; mode: ExecutionMode; triggeredBy: string }): Promise<Job>`.
    - Export `getQueueStatus(): Promise<QueueStatus>` — calls `queue.getJobCounts()` plus worker count.
    - Export `isQueueMode(): boolean` — reads `process.env.QUEUE_MODE === 'true'`.
    - Export `closeQueue(): Promise<void>` for graceful shutdown.
  - [x] 3.2 Create `packages/server/src/queue/worker.ts`:
    - Initialize `Worker` from `bullmq` on the same queue name.
    - Concurrency: `parseInt(process.env.QUEUE_CONCURRENCY || '5', 10)`.
    - Retry: `attempts: parseInt(process.env.QUEUE_RETRY_ATTEMPTS || '2', 10)`, `backoff: { type: 'exponential', delay: parseInt(process.env.QUEUE_RETRY_BACKOFF_MS || '5000', 10) }` — set as default job options on the Queue (not the Worker).
    - Job processor: load workflow from DB by `workflowId`, call `workflowExecutor.execute(workflow, triggerData, mode, triggeredBy)`. On success, the executor already updates the execution record. On failure (thrown error), update the execution record to `'error'` status and broadcast `execution_completed` with error.
    - Import `registerAllNodes()` at the top so node handlers are available.
    - Export `startWorker(): Worker` and `closeWorker(): Promise<void>`.
  - [x] 3.3 Create `packages/server/src/queue/index.ts` re-exporting from manager and worker.

- [x] **Task 4: Wire queue mode into execution path** (AC #1)
  - [x] 4.1 In `packages/server/src/api/routes/workflows.ts`, modify `POST /api/workflows/:id/execute`:
    - Import `isQueueMode`, `enqueueExecution` from `../../queue/manager.js`.
    - If `isQueueMode()`: create execution record with status `'queued'`, enqueue the job, broadcast `execution_queued`, return `{ id, status: 'queued', workflowId }` immediately.
    - If not queue mode: current inline behavior (unchanged).
  - [x] 4.2 In `packages/server/src/mcp/index.ts`, modify the `flowaibuilder.execute_workflow` tool handler to use the same queue-mode branching. The tool currently calls `workflowExecutor.execute()` directly — wrap with the same `isQueueMode()` check, enqueue if true, return the execution ID with queued status.
  - [x] 4.3 Start the worker in `packages/server/src/index.ts`: import `startWorker`, `closeQueue`, `closeWorker` from `./queue/index.js`. If `isQueueMode()`, call `startWorker()` at startup. Add `closeWorker()` and `closeQueue()` to the shutdown handler.

- [x] **Task 5: Queue status REST endpoint** (AC #6)
  - [x] 5.1 Add `GET /api/queue/status` in `packages/server/src/api/routes/workflows.ts` (or a new `packages/server/src/api/routes/queue.ts` if cleaner):
    - If queue mode off: `{ enabled: false }`.
    - If on: call `getQueueStatus()`, return the full `QueueStatus` object.
  - [x] 5.2 RBAC: this is a GET, so the default viewer-for-GET mapping in `rbac-routes.ts` already applies. No override needed.

- [x] **Task 6: Log streaming service** (AC #4, #5)
  - [x] 6.1 Create `packages/server/src/logging/streamer.ts`:
    - `LogStreamer` class that loads destinations from `instance_settings.logStreamDestinations` on init and re-reads on each execution (or caches with short TTL — no stale config).
    - `emit(entry: LogEntry): void` — fans out to all enabled destinations concurrently via `Promise.allSettled`.
    - `LogEntry` shape: `{ timestamp: string; level: 'info' | 'error'; event: string; workflowId: string; executionId: string; nodeId?: string; nodeName?: string; message: string; data?: unknown }`.
    - Stdout destination: `console.log(JSON.stringify(entry))` — one JSON line per event.
    - Webhook destination: `fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry), signal: AbortSignal.timeout(5000) })`. Fire-and-forget, log errors to stderr.
    - S3 destination: use `@aws-sdk/client-s3` `PutObjectCommand` to upload. Key: `${prefix}/${workflowId}/${executionId}/${Date.now()}.jsonl`. **NOTE**: `@aws-sdk/client-s3` is a new dependency — add to `packages/server/package.json`. The S3 client reads `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` from env (standard AWS SDK credential chain).
  - [x] 6.2 Create `packages/server/src/logging/index.ts` re-exporting the streamer.
  - [x] 6.3 Wire the streamer into `WorkflowExecutor`: import the log streamer singleton and call `emit()` at key lifecycle points — execution started, node started (before `runNode`), node completed (after `runNode`), execution completed/error. The streamer is additive; it must not break execution if it fails (wrap in try/catch).

- [x] **Task 7: MCP tools** (AC #7)
  - [x] 7.1 Create `packages/server/src/mcp/tools/queue.ts` exporting `registerQueueTools(server, app)`:
    - `flowaibuilder.get_queue_status()` — calls `getQueueStatus()`, returns result.
    - `flowaibuilder.configure_log_streaming({ destinations: LogDestination[] })` — validates destinations (same rules as PUT /api/settings), updates `instance_settings.logStreamDestinations`, writes `log_streaming.configured` audit entry, returns `{ success: true, destinations }`.
  - [x] 7.2 Register in `packages/server/src/mcp/index.ts` after `registerSecretsTools`.
  - [x] 7.3 Extend `minRoleForMcpTool` in `mcp/rbac.ts`: `flowaibuilder.get_queue_status` → add to readOnly set (viewer), `flowaibuilder.configure_log_streaming` → editor (default).

- [x] **Task 8: Audit** (AC #8)
  - [x] 8.1 Extend `resolveAction` in `api/middleware/audit.ts`:
    - `PUT /api/settings` already resolves to `settings.updated` — no change needed if log stream config is part of settings. However, for granular tracking, when the `logStreamDestinations` field is in the PUT body, also write a `log_streaming.configured` audit entry via manual `app.audit.write` (similar to how secrets does it).
  - [x] 8.2 MCP tool audit: `configure_log_streaming` calls `app.audit.write` directly with `action: 'log_streaming.configured'`, `metadata: { destinations }`. Redact any URLs that look like they contain tokens (check with existing `redactSecrets`).

- [x] **Task 9: UI — Log Streaming settings + Queue Status card** (AC #9)
  - [x] 9.1 Add API client methods to `packages/ui/src/lib/api.ts`: `getQueueStatus`, `updateLogStreamConfig`.
  - [x] 9.2 Create `packages/ui/src/components/logging/LogStreamPanel.tsx`:
    - Renders current log destinations from settings.
    - "Add Destination" button with type selector dropdown (stdout / webhook / S3).
    - Webhook type shows URL input field (required, must be https://).
    - S3 type shows bucket (required), region (optional, default `us-east-1`), prefix (optional, default `logs/`).
    - Stdout type has no extra fields — just an enable/disable toggle.
    - Each destination row has a remove button.
    - Save button calls `PUT /api/settings` with updated `logStreamDestinations`.
    - Viewers see the list but buttons are disabled (same pattern as SecretsPanel).
  - [x] 9.3 Mount `LogStreamPanel` in `packages/ui/src/pages/Settings.tsx` below the Secrets section.
  - [x] 9.4 Create `packages/ui/src/components/queue/QueueStatusCard.tsx`:
    - Shows queue health: waiting, active, failed, completed counts.
    - "Queue Mode" badge (enabled/disabled).
    - Auto-refresh every 10 seconds when visible (useEffect + interval, or use the WS `execution_queued` events as trigger).
    - When queue mode is off, shows "Queue mode is disabled. Set QUEUE_MODE=true to enable."
  - [x] 9.5 Mount `QueueStatusCard` on the Dashboard page (`packages/ui/src/pages/Dashboard.tsx`), conditionally visible when queue status returns `enabled: true` (or always visible with disabled state message).

- [x] **Task 10: Tests** (AC #1-8)
  - [x] 10.1 `packages/server/src/__tests__/queue-manager.test.ts` — unit: mock BullMQ Queue, test `enqueueExecution` creates job with correct data, `getQueueStatus` returns counts, `isQueueMode` reads env var.
  - [x] 10.2 `packages/server/src/__tests__/queue-worker.test.ts` — unit: mock Worker, verify processor calls `workflowExecutor.execute` with correct args, handles executor error by updating execution record.
  - [x] 10.3 `packages/server/src/__tests__/queue-route.test.ts` — app.inject(): `GET /api/queue/status` returns `{ enabled: false }` when QUEUE_MODE unset; returns counts when enabled (mock `getQueueStatus`).
  - [x] 10.4 `packages/server/src/__tests__/log-streamer.test.ts` — unit: mock fetch for webhook, mock console.log for stdout, verify all destinations receive entries, verify one destination failure doesn't block others.
  - [x] 10.5 `packages/server/src/__tests__/queue-execute.test.ts` — integration-style: with QUEUE_MODE=true, POST /api/workflows/:id/execute returns `{ status: 'queued' }` instead of full execution result; verify execution record created with `queued` status.
  - [x] 10.6 `packages/server/src/__tests__/queue-mcp.test.ts` — exercise `get_queue_status` and `configure_log_streaming` via `setActiveMcpContext` pattern.

## Dev Notes

### Context & motivation

This is the final story in Epic 5 (Enterprise Features). It adds two operational capabilities: BullMQ-based queue mode for horizontal scaling of workflow execution, and configurable log streaming for centralized operational observability. Both are features that n8n charges $333+/month for — we ship them free.

Queue mode wraps the existing `WorkflowExecutor.execute()` — the executor itself is unchanged. The queue layer is purely about async dispatch (enqueue instead of inline call) and worker scaling (BullMQ Worker with configurable concurrency). When `QUEUE_MODE` is off (default), the system behaves exactly as it does today.

Log streaming is independent of queue mode — it works in both inline and queue execution. It hooks into the executor's lifecycle events and fans out structured log entries to configured destinations.

### Architecture compliance

- **DB:** Postgres only. Log stream destinations are stored as JSONB on the existing `instance_settings` singleton row — no new tables.
- **MCP-first:** Queue status and log config have MCP tools (Task 7) in addition to REST.
- **Zero-cost AI:** This story does NOT introduce `@anthropic-ai/sdk`. No Claude API calls.
- **Protected Zones:** Queue mode does not modify the workflow graph — it only changes the execution dispatch path. Zones are not involved.
- **Auth / RBAC:** Story 5.2 landed `request.user`, `rolePermits`, `applyRouteRbac`. Queue status is a GET (viewer). Log config changes go through PUT /api/settings which is already gated as editor.

### Library decisions

- **BullMQ v5.30.0** — already in `packages/server/package.json`. No version change needed.
- **ioredis v5.4.0** — already in `packages/server/package.json`. BullMQ uses ioredis internally.
- **@aws-sdk/client-s3** — NEW dependency for S3 log streaming. Add `^3.700.0` (latest stable) to `packages/server/package.json`. Only imported dynamically when an S3 destination is configured (no cold-start cost when unused). If the operator doesn't use S3 streaming, this dep is never loaded.
- **No Bull Board** — out of scope for this story. The architecture mentions it's available but the simple `GET /api/queue/status` endpoint plus the UI card covers the MVP need. Bull Board can be added later as a nice-to-have.

### Key implementation patterns

**Queue mode toggle**: Read `process.env.QUEUE_MODE === 'true'` at call time (not at import time). This allows toggling in tests without restarting.

**Worker lifecycle**: The worker starts inside the same server process (not a separate binary). This simplifies deployment — one container, one entrypoint. For horizontal scaling, operators run additional server instances with `QUEUE_MODE=true` — each spawns its own worker. BullMQ handles job distribution across workers automatically.

**Redis connection**: Parse `REDIS_URL` env var (already set in docker-compose as `redis://redis:6379`). Use `new IORedis(process.env.REDIS_URL)` for both Queue and Worker. Reuse one connection for both if BullMQ allows, otherwise two connections (BullMQ docs recommend separate connections for Queue and Worker).

**Log entry format**: Structured JSON matching common observability patterns:
```json
{
  "timestamp": "2026-04-10T12:00:00.000Z",
  "level": "info",
  "event": "node_completed",
  "workflowId": "uuid",
  "executionId": "uuid",
  "nodeId": "node-1",
  "nodeName": "HTTP Request",
  "message": "Node completed in 234ms",
  "data": { "status": "success", "durationMs": 234 }
}
```

**S3 upload strategy**: Batch log entries per execution and upload on execution completion (not per-event). This reduces S3 API calls. Use a `Map<executionId, LogEntry[]>` buffer in the streamer, flush on `execution_completed` or `execution_error` events.

### Previous story intelligence

From Story 5.4:
- `crypto/aes.ts` encrypt/decrypt is production-ready. Not directly relevant but the pattern of loading secrets in-memory before execution is the same kind of pre-execution setup the queue worker needs.
- `mcpActor()` from `mcp/index.ts` — use it for actor attribution in `configure_log_streaming` audit writes.
- The `shouldVersion` / `recordSnapshot` pattern is not needed here (queue/log config are operational settings, not workflow content).
- Settings route (`settings.ts`) already handles the singleton `instance_settings` row with `getOrCreateSettings()` + `toSettings()` + `PUT` handler. The log stream destinations are simply new fields on this same row.
- RBAC walker auto-maps GETs to viewer and non-GETs to editor. `GET /api/queue/status` is a new GET path — verify the walker doesn't block it. It should fall through to the default viewer mapping.

### Anti-patterns to avoid

- **Do NOT** create a separate process/binary for the worker. Run it in-process. Operators scale by running more server instances.
- **Do NOT** duplicate the execution logic. The worker calls `workflowExecutor.execute()` — the same function inline mode uses.
- **Do NOT** make queue mode the default. It must be opt-in via `QUEUE_MODE=true`. When unset, existing inline behavior is preserved exactly.
- **Do NOT** block execution on log streaming failures. Log streaming is fire-and-forget. Wrap every destination call in try/catch.
- **Do NOT** store AWS credentials in the DB or `instance_settings`. S3 streaming uses the standard AWS SDK credential chain (env vars / instance profile / config file).
- **Do NOT** send plaintext secret values through log entries. The log entry `data` field should contain execution metadata (status, duration, node names), never `$secrets` values. Reuse the `scrubSecrets` pattern from the executor if node output is included.
- **Do NOT** add `@aws-sdk/client-s3` as a hard import at the top of the streamer. Use dynamic `import()` so it's only loaded when an S3 destination is configured.

### Testing standards

- Vitest. Co-located under `packages/server/src/__tests__/`.
- Follow the `app.inject()` + in-memory stub DB pattern from `versioning-routes.test.ts`.
- Mock BullMQ's `Queue` and `Worker` classes — do not require a real Redis in tests.
- Mock `fetch` for webhook destination tests.
- Set `process.env.QUEUE_MODE = 'true'` / `'false'` in individual tests to verify both paths.

### Files to create

- `packages/shared/src/types/queue.ts`
- `packages/server/src/queue/manager.ts`
- `packages/server/src/queue/worker.ts`
- `packages/server/src/queue/index.ts`
- `packages/server/src/logging/streamer.ts`
- `packages/server/src/logging/index.ts`
- `packages/server/src/mcp/tools/queue.ts`
- `packages/ui/src/components/logging/LogStreamPanel.tsx`
- `packages/ui/src/components/queue/QueueStatusCard.tsx`
- Test files listed in Task 10.

### Files to modify

- `packages/shared/src/types/execution.ts` — add `'queued'` to `ExecutionStatus`.
- `packages/shared/src/types/mcp.ts` — add `'execution_queued'` to `WebSocketEventType`.
- `packages/shared/src/types/instance-settings.ts` — add `logStreamDestinations` field.
- `packages/shared/src/index.ts` — re-export queue types.
- `packages/server/src/db/schema.ts` — add `logStreamDestinations` JSONB column to `instanceSettings`.
- `packages/server/src/api/routes/settings.ts` — extend `toSettings()` and `PUT` handler for log stream config.
- `packages/server/src/api/routes/workflows.ts` — modify execute endpoint for queue mode branching, add `GET /api/queue/status`.
- `packages/server/src/engine/executor.ts` — add log streamer hooks at lifecycle points.
- `packages/server/src/mcp/index.ts` — register queue tools, modify `execute_workflow` for queue mode.
- `packages/server/src/mcp/rbac.ts` — extend `minRoleForMcpTool` for queue tools.
- `packages/server/src/api/middleware/audit.ts` — extend `resolveAction` for `log_streaming.configured`.
- `packages/server/src/index.ts` — import and start worker if queue mode, add to shutdown handler.
- `packages/server/package.json` — add `@aws-sdk/client-s3` dependency.
- `packages/ui/src/lib/api.ts` — add `getQueueStatus`, `updateLogStreamConfig`.
- `packages/ui/src/pages/Settings.tsx` — mount LogStreamPanel.
- `packages/ui/src/pages/Dashboard.tsx` — mount QueueStatusCard.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#story-55-queue-mode-log-streaming] — ACs baseline
- [Source: _bmad-output/planning-artifacts/architecture.md#105-107] — queue/worker file structure
- [Source: _bmad-output/planning-artifacts/architecture.md#1202-1207] — BullMQ rationale
- [Source: packages/server/package.json#24,28] — existing bullmq v5.30.0 + ioredis v5.4.0 deps
- [Source: packages/server/src/engine/executor.ts] — current inline executor (reuse in worker)
- [Source: packages/server/src/api/routes/workflows.ts#521-531] — current execute endpoint
- [Source: packages/server/src/api/ws/broadcaster.ts] — WS broadcast pattern
- [Source: packages/shared/src/types/execution.ts] — ExecutionStatus/ExecutionMode types
- [Source: packages/shared/src/types/mcp.ts#7-34] — WebSocketEventType union
- [Source: packages/server/src/db/schema.ts#173-186] — instanceSettings table
- [Source: packages/server/src/api/routes/settings.ts] — settings CRUD pattern (toSettings, PUT handler)
- [Source: packages/server/src/mcp/rbac.ts] — minRoleForMcpTool pattern
- [Source: packages/server/src/index.ts] — server bootstrap and shutdown
- [Source: docker-compose.yml#18-28] — Redis service config
- [Source: _bmad-output/implementation-artifacts/5-4-environments-secrets-management.md] — previous story context

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

### Completion Notes List

- All 10 tasks completed with all subtasks implemented
- 6 test files with 20 tests — all passing
- BullMQ queue mode: opt-in via QUEUE_MODE=true env var, in-process worker, configurable concurrency/retries
- Log streaming: stdout, webhook (https:// required), S3 (dynamic import, buffered per execution) destinations
- MCP tools: get_queue_status (viewer), configure_log_streaming (editor) with RBAC
- Audit: log_streaming.configured written on config changes via REST and MCP
- UI: LogStreamPanel on Settings page, QueueStatusCard on Dashboard (auto-refreshes every 10s)
- No regressions introduced; pre-existing test failures are unrelated (isomorphic-git import issues)

### Change Log

- 2026-04-10: Implemented Story 5.5 — Queue Mode & Log Streaming (all 10 tasks)

### File List

**New files:**
- packages/shared/src/types/queue.ts
- packages/server/src/queue/manager.ts
- packages/server/src/queue/worker.ts
- packages/server/src/queue/index.ts
- packages/server/src/logging/streamer.ts
- packages/server/src/logging/index.ts
- packages/server/src/mcp/tools/queue.ts
- packages/ui/src/components/logging/LogStreamPanel.tsx
- packages/ui/src/components/queue/QueueStatusCard.tsx
- packages/server/src/__tests__/queue-manager.test.ts
- packages/server/src/__tests__/queue-worker.test.ts
- packages/server/src/__tests__/queue-route.test.ts
- packages/server/src/__tests__/log-streamer.test.ts
- packages/server/src/__tests__/queue-execute.test.ts
- packages/server/src/__tests__/queue-mcp.test.ts

**Modified files:**
- packages/shared/src/types/execution.ts (added 'queued' to ExecutionStatus)
- packages/shared/src/types/mcp.ts (added 'execution_queued' to WebSocketEventType)
- packages/shared/src/types/instance-settings.ts (added logStreamDestinations field)
- packages/shared/src/index.ts (re-exported queue types)
- packages/server/src/db/schema.ts (added logStreamDestinations JSONB column)
- packages/server/src/api/routes/settings.ts (extended toSettings, PUT handler for log stream config)
- packages/server/src/api/routes/workflows.ts (queue mode branching in execute, GET /api/queue/status)
- packages/server/src/engine/executor.ts (log streamer hooks at lifecycle points)
- packages/server/src/mcp/index.ts (queue mode in execute_workflow, registered queue tools)
- packages/server/src/mcp/rbac.ts (added get_queue_status to viewer readOnly set)
- packages/server/src/index.ts (worker startup, queue shutdown)
- packages/server/package.json (added @aws-sdk/client-s3 dependency)
- packages/ui/src/lib/api.ts (added getQueueStatus, updateLogStreamConfig)
- packages/ui/src/pages/Settings.tsx (mounted LogStreamPanel)
- packages/ui/src/pages/Dashboard.tsx (mounted QueueStatusCard)

### Review Findings

_Code review: 2026-04-10 (Group A: Core Backend) — Blind Hunter + Edge Case Hunter + Acceptance Auditor_

- [x] [Review][Decision] **D1: Duplicate execution record in queue mode** — Fixed: executor.execute() now accepts optional `existingExecutionId` param; skips INSERT and reuses pre-created record in queue mode. (Option A applied)
- [x] [Review][Patch] **P1: Worker error path creates orphan records on BullMQ retry** — Fixed: worker passes `executionId` to executor via `existingExecutionId`; error catch is best-effort.
- [x] [Review][Patch] **P2: TOCTOU race in configure_log_streaming upsert** — Fixed: replaced SELECT+INSERT+UPDATE with single `onConflictDoUpdate` upsert.
- [x] [Review][Patch] **P3: S3 buffer never flushed on worker error path** — Fixed: worker catch block now emits `execution_error` log event to flush S3 buffer.
- [x] [Review][Patch] **P4: S3 buffer key collision with multiple S3 destinations sharing a bucket** — Fixed: key now includes prefix+region.
- [x] [Review][Patch] **P5: New S3Client instantiated on every flush — no connection reuse** — Fixed: S3 clients cached per region.
- [x] [Review][Patch] **P6: Duplicate audit entries for log stream config via REST** — Fixed: `auditSkip` set when log stream is the sole change.
- [x] [Review][Patch] **P7: workflowVersion missing from queued execution record** — Fixed: added `workflowVersion` to INSERT in workflows.ts and mcp/index.ts.
- [x] [Review][Defer] **W1: manage_secrets mapped as viewer in RBAC readOnly set** [mcp/rbac.ts:66] — deferred, pre-existing (Story 5.4)
- [x] [Review][Defer] **W2: maxRetriesPerRequest: null causes hangs when Redis unreachable** [queue/manager.ts:20] — deferred, BullMQ requirement; needs startup health check
- [x] [Review][Defer] **W3: Destination cache stale for 10s after config update** [logging/streamer.ts:22] — deferred, acceptable per spec TTL guidance
- [x] [Review][Defer] **W4: stdio transport unconditionally bypasses RBAC** [mcp/rbac.ts:30] — deferred, by design per Story 5.2

_Code review: 2026-04-10 (Group B: UI) — all three layers self-conducted_

- [x] [Review][Patch] **B-P1: handleUpdate mutates destination object in-place** — Fixed: spread destination object on update
- [x] [Review][Patch] **B-P4: QueueStatusCard polls every 10s even when disabled** — Fixed: interval only runs when queue is enabled or status unknown

_Code review: 2026-04-10 (Group C: Tests) — all three layers self-conducted_

- [x] [Review][Patch] **C-P1: Worker test should verify existingExecutionId passed to executor** — Fixed: assert `toHaveBeenCalledWith` includes 5th arg
- [x] [Review][Patch] **C-P2: Worker test missing logging/index.js mock** — Fixed: added mock
- [x] [Review][Patch] **C-P4: No test for S3 buffering/flushing** — Fixed: added S3 buffer+flush test

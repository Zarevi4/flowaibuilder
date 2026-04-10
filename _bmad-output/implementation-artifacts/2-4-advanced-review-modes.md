# Story 2.4: Advanced Review Modes

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a workflow user,
I want automatic, continuous, post-execution and pre-deploy reviews,
so that my workflow quality is continuously monitored without manual intervention.

## Acceptance Criteria

1. **Auto-review on save (instance-wide).** **Given** the `instanceSettings.autoReviewEnabled` flag is `true` (read via the existing `getOrCreateSettings()` helper in `packages/server/src/api/routes/settings.ts:19`), **When** a workflow is mutated by any of the existing routes that already broadcast a workflow/node change — `PUT /api/workflows/:id`, `POST /api/workflows/:id/nodes`, `PATCH /api/workflows/:id/nodes/:nodeId`, `DELETE /api/workflows/:id/nodes/:nodeId`, `POST /api/workflows/:id/connections`, `DELETE /api/workflows/:id/connections/:connectionId` — **Then** the server emits a single `review_requested` WebSocket broadcast (the same event added in Story 2.3) with `data = { workflow_id, trigger: 'auto-save', context_type: 'on-save', requested_at }`. The same trigger fires when a workflow is mutated via the equivalent MCP tools (`update_workflow`, `add_node`, `update_node`, `remove_node`, `connect_nodes`, `disconnect_nodes`) — auto-review must be triggered uniformly regardless of whether the mutation came from REST or MCP. When `autoReviewEnabled === false`, NO `review_requested` event is emitted from these mutations. The setting is fetched once per request (no caching, no module-level memoization) so a freshly saved settings change takes effect on the next mutation. No DB write, no AI call, zero-cost invariant preserved (`grep -R "@anthropic-ai/sdk" packages/server` must remain empty).

2. **Continuous review (per-workflow, debounced).** **Given** a workflow's `workflow.settings.continuousReviewEnabled === true` (a new optional boolean field on `Workflow.settings`, no schema migration needed — `workflow.settings` is already a `jsonb` blob) and the user is editing on the canvas, **When** any node `add`/`update`/`remove`/`move` or `connection` mutation occurs in the UI, **Then** a 2000 ms trailing-edge debounced call is made to `POST /api/workflows/:id/review/request` with body `{ trigger: 'continuous', context_type: 'on-edit' }`. The debounce timer resets on every subsequent edit and is cancelled on workflow change/unmount. The request body is forwarded into the `review_requested` event payload (server merges body into the existing payload). Continuous review never fires when the toggle is `false` or the workflow id is unset. The toggle is exposed in the editor as a small checkbox in the canvas toolbar (label: `"Continuous review"`, `data-testid="continuous-review-toggle"`); flipping it persists via `PUT /api/workflows/:id` setting `settings: { ...settings, continuousReviewEnabled }`. Auto-save (AC#1) and continuous review can both fire for the same edit — that's intentional, the receiving Claude Code session deduplicates client-side.

3. **Post-execution review on failure.** **Given** the `WorkflowExecutor.execute()` method in `packages/server/src/engine/executor.ts:21` finishes an execution, **When** the resolved `executionStatus === 'error'`, **Then** immediately after the existing `execution_completed` broadcast at `executor.ts:160`, the executor emits `getBroadcaster()?.broadcast('review_requested', workflow.id, { workflow_id, trigger: 'post-execution', context_type: 'post-execution', execution_id, requested_at })`. Successful executions DO NOT emit this event. The MCP tool `flowaibuilder.get_review_context` in `packages/server/src/mcp/tools/review.ts` is extended to accept two new optional input fields: `execution_id?: string` and `context_type?: 'on-save' | 'on-edit' | 'post-execution' | 'pre-deploy' | 'general'` (default `'general'`). When `context_type === 'post-execution'` AND `execution_id` is provided, the returned `ReviewContext` includes a new optional field `failed_execution: { execution_id, status, error, node_errors, duration_ms, started_at, bottleneck_node_id }` populated by loading that single execution row from the `executions` table and selecting the slowest non-`success` `nodeExecutions[]` entry as the bottleneck. If `execution_id` does not exist, the tool throws a `ReviewNotFoundError` (re-using the class added in Story 2.3 at `packages/server/src/mcp/tools/review.ts`). The shared type `ReviewContext` in `packages/shared/src/types/annotation.ts` gains the optional `failed_execution?` field; existing consumers compile unchanged.

4. **Pre-deploy review on activate.** **Given** the editor exposes an "Activate" affordance, **When** the user clicks it to set `workflow.active = true`, **Then** the UI calls a new `POST /api/workflows/:id/activate` endpoint (instead of patching `active` directly). The endpoint (a) emits `review_requested` with `{ trigger: 'pre-deploy', context_type: 'pre-deploy' }`, (b) reads `annotationStore.getLatestReview(id)`, and (c) returns `{ healthScore: number | null, requiresConfirmation: boolean, warning: string | null, activated: boolean }`. If `healthScore !== null && healthScore < 50` AND the request body does NOT include `{ force: true }`, the response is `{ healthScore, requiresConfirmation: true, warning: 'Health score is below 50. Activating may deploy a workflow with critical issues.', activated: false }` (HTTP 200, no DB write). When `force: true` OR `healthScore >= 50` OR `healthScore === null`, the workflow row's `active` column is updated to `true`, a `workflow_updated` broadcast is emitted with the fresh row, and the response is `{ healthScore, requiresConfirmation: false, warning: null, activated: true }`. The UI shows a confirm dialog when `requiresConfirmation === true`, then re-calls the endpoint with `{ force: true }` if the user confirms. Deactivating (active → false) bypasses the pre-deploy check entirely and goes through the existing `PUT /api/workflows/:id`. The pre-deploy `get_review_context` call (issued by the MCP-connected Claude when it picks up the broadcast) MUST include the security/reliability/data-integrity dimensions already produced by `buildReviewContext` — no change to that function is required for AC#4 because `current_annotations` and `protected_zones` already cover those dimensions; the `context_type='pre-deploy'` flag is purely advisory metadata included in the review context output so Claude can adjust its analysis prompt.

5. **Triggers are visible in WS payloads.** **Given** any of AC#1–#4 fires a `review_requested` broadcast, **When** the UI receives the message in `packages/ui/src/store/ws.ts`, **Then** the payload is logged at `console.debug` with `[review-trigger] {trigger} {context_type} {workflow_id}` and is otherwise ignored by the UI store (the existing Story 2.3 routing already drops `review_requested` for the UI — this story does NOT change that). The new `trigger` and `context_type` fields are added to the shared `WebSocketMessage`-related typing as a discriminated optional payload shape on `review_requested` events: define `interface ReviewRequestedPayload { workflow_id: string; trigger: 'manual' | 'auto-save' | 'continuous' | 'post-execution' | 'pre-deploy'; context_type: 'general' | 'on-save' | 'on-edit' | 'post-execution' | 'pre-deploy'; execution_id?: string; requested_at: string }` exported from `packages/shared/src/types/mcp.ts`. The Story 2.3 manual-review path in `packages/server/src/api/routes/review.ts:117` is updated to include `trigger: 'manual', context_type: 'general'` in its emitted payload (backward-compatible — additional fields, no removals).

6. **Settings UI surface.** **Given** the existing `/settings` page (`packages/ui/src/pages/Settings.tsx`) already renders the `autoReviewEnabled` toggle bound to `instanceSettings`, **When** the page renders after this story, **Then** an explanatory hint is added directly below the toggle: `"Triggers a review_requested event whenever any workflow is saved. Claude Code sessions connected via MCP will be notified."` No new fields added to `instanceSettings` (the schema already has `autoReviewEnabled`). The continuous-review toggle is NOT added to the global settings page — it lives on the canvas toolbar per AC#2 because it's per-workflow.

7. **Tests.** **Given** Vitest is configured for both server and UI packages, **When** the test suites run, **Then** the following tests exist and pass:
   - `packages/server/src/__tests__/auto-review.test.ts` — boots the Fastify app + in-memory DB harness used by `review-rest.test.ts`. Seeds a workflow. Spies on `getBroadcaster()` (mock `broadcast` method). Asserts: (a) with `autoReviewEnabled=false`, mutating the workflow via `PUT /api/workflows/:id` does NOT call `broadcast('review_requested', …)`; (b) with `autoReviewEnabled=true`, the same mutation DOES call it once with `data.trigger === 'auto-save'`; (c) the same matrix for `POST /api/workflows/:id/nodes` and `PATCH /api/workflows/:id/nodes/:nodeId`. Toggle the setting between sub-tests via the existing `PUT /api/settings` endpoint, NOT by patching the row directly.
   - `packages/server/src/__tests__/post-execution-review.test.ts` — runs `workflowExecutor.execute()` against a 2-node workflow where the second node throws (re-use the failing-node fixture from `packages/server/src/__tests__/executor.test.ts` if present, otherwise build one with a Code-JS node that throws). Spies on the broadcaster. Asserts `broadcast('review_requested', wf.id, …)` is called exactly once with `data.trigger === 'post-execution'` AND `data.execution_id === <returned id>`. Also asserts that for a successful execution NO `review_requested` event is emitted.
   - `packages/server/src/__tests__/activate-review.test.ts` — POST `/api/workflows/:id/activate` against (a) a workflow with no review row → `{ requiresConfirmation: false, activated: true, healthScore: null }` and DB row updated; (b) a workflow with a `workflow_reviews` row at `healthScore = 30` → `{ requiresConfirmation: true, activated: false }` and DB row UNCHANGED; (c) the same low-score workflow with `body.force = true` → `{ activated: true }`. Asserts `broadcast('review_requested', …)` always fires once with `trigger: 'pre-deploy'`, and `broadcast('workflow_updated', …)` fires only on successful activation.
   - `packages/server/src/__tests__/get-review-context.test.ts` (extend the existing `review-mcp.test.ts` rather than creating a new file if it covers `get_review_context`) — asserts that calling the handler with `{ context_type: 'post-execution', execution_id }` returns a `failed_execution` field populated from the seeded executions row, and that calling with an unknown `execution_id` throws `ReviewNotFoundError`.
   - `packages/ui/src/__tests__/continuous-review.test.tsx` — uses `vi.useFakeTimers()`. Mounts `<CanvasToolbar>` with the new continuous-review toggle on, mocks `api.requestReview`, dispatches three rapid synthetic edits via the `useWorkflowStore` action surface, advances timers by 1900 ms (assert 0 calls), then 200 ms more (assert exactly 1 call with `{ trigger: 'continuous', context_type: 'on-edit' }`).
   - `packages/ui/src/__tests__/activate-flow.test.tsx` — mocks `api.activateWorkflow` to return `{ requiresConfirmation: true, healthScore: 30, warning: 'Health score is below 50…', activated: false }` on first call and `{ activated: true, healthScore: 30 }` on second. Renders the activate affordance, clicks it, asserts a confirm dialog appears with the warning text, clicks "Activate anyway", asserts the second call was made with `{ force: true }`, asserts the workflow store reflects `active = true`.

8. **Build & invariants.** **Given** the build, **When** `npm run build` runs across all workspaces, **Then** `packages/shared`, `packages/server`, and `packages/ui` compile cleanly with no new TypeScript errors and no new dependencies in any `package.json`. `grep -R "@anthropic-ai/sdk\|OpenAI\|openai" packages/server packages/ui` must not match any new code. No new DB columns or migrations are introduced (this story rides entirely on existing `instanceSettings`, `workflows.settings` jsonb, `executions`, and `workflow_reviews` tables).

## Tasks / Subtasks

- [x] **Task 1: Shared types — review trigger payload + ReviewContext extension** (AC: #3, #5)
  - [x] 1.1 In `packages/shared/src/types/mcp.ts`, export the new `ReviewRequestedPayload` interface with the union types for `trigger` and `context_type`. Do not change `WebSocketEventType` (the `'review_requested'` literal is already there from Story 2.3).
  - [x] 1.2 In `packages/shared/src/types/annotation.ts`, add an optional `failed_execution?: { execution_id: string; status: string; error: unknown; node_errors: unknown; duration_ms: number | null; started_at: string | null; bottleneck_node_id: string | null }` field to the existing `ReviewContext` interface. Re-export remains unchanged.
  - [x] 1.3 `npm run --workspace packages/shared build` to refresh `dist/`. Confirm `packages/server` and `packages/ui` still type-check.

- [x] **Task 2: Server — auto-review trigger helper** (AC: #1)
  - [x] 2.1 Create `packages/server/src/review/triggers.ts` exporting `async function maybeEmitAutoReview(workflowId: string): Promise<void>`. Implementation: select the singleton `instanceSettings` row directly via `db.select().from(instanceSettings).where(eq(instanceSettings.id, 'singleton'))`. If `row?.autoReviewEnabled === true`, call `getBroadcaster()?.broadcast('review_requested', workflowId, { workflow_id: workflowId, trigger: 'auto-save', context_type: 'on-save', requested_at: new Date().toISOString() } satisfies ReviewRequestedPayload)`. Catches and swallows DB/broadcast errors with a `console.warn('[auto-review] failed:', err)` so workflow mutations are never blocked by a review-trigger failure.
  - [x] 2.2 Wire `maybeEmitAutoReview(id)` into every mutation handler in `packages/server/src/api/routes/workflows.ts`: `PUT /api/workflows/:id` (after the existing `db.update`), `POST /api/workflows/:id/nodes` (after `node_added` broadcast), `PATCH /api/workflows/:id/nodes/:nodeId` (after `node_updated`), `DELETE /api/workflows/:id/nodes/:nodeId` (after `node_removed`), `POST /api/workflows/:id/connections` (after `connection_added`), `DELETE /api/workflows/:id/connections/:connectionId` (after `connection_removed`). Awaited but errors caught — a thrown exception inside `maybeEmitAutoReview` must NOT 500 the mutation.
  - [x] 2.3 Wire `maybeEmitAutoReview` into the equivalent MCP tools in `packages/server/src/mcp/tools/` (search for `update_workflow`, `add_node`, `update_node`, `remove_node`, `connect_nodes`, `disconnect_nodes` registrations — they likely live in `workflow.ts` or similar). Same pattern: call the helper after the existing per-tool broadcast.
  - [x] 2.4 Update the existing manual-review route at `packages/server/src/api/routes/review.ts:117` (`POST /api/workflows/:id/review/request`) to (a) accept an optional body `{ trigger?, context_type? }`, (b) merge into the broadcast payload, (c) default `trigger='manual'`, `context_type='general'`. Continue to return `{ prompt }` unchanged.

- [x] **Task 3: Server — post-execution trigger in WorkflowExecutor** (AC: #3)
  - [x] 3.1 In `packages/server/src/engine/executor.ts`, immediately after the `execution_completed` broadcast at `executor.ts:160`, add: `if (executionStatus === 'error') { getBroadcaster()?.broadcast('review_requested', workflow.id, { workflow_id: workflow.id, trigger: 'post-execution', context_type: 'post-execution', execution_id: updated.id, requested_at: new Date().toISOString() }); }`. Use `satisfies ReviewRequestedPayload` for the literal.
  - [x] 3.2 Do NOT alter retry logic, the topological sort, or the execution result return value. The new broadcast is fire-and-forget and must not throw.

- [x] **Task 4: Server — extend get_review_context for failed_execution** (AC: #3)
  - [x] 4.1 In `packages/server/src/mcp/tools/review.ts`, extend the `flowaibuilder.get_review_context` Zod input schema with `execution_id: z.string().optional()` and `context_type: z.enum(['general','on-save','on-edit','post-execution','pre-deploy']).optional()`.
  - [x] 4.2 In the handler, if `context_type === 'post-execution' && execution_id`, load the row: `const [exec] = await db.select().from(executions).where(and(eq(executions.id, execution_id), eq(executions.workflowId, workflow_id)))`. If missing, `throw new ReviewNotFoundError('execution not found')`. Otherwise compute `bottleneck_node_id` by scanning `exec.nodeExecutions ?? []` for the entry with the largest `duration` whose `status !== 'success'` (fall back to `null` if none).
  - [x] 4.3 Pass the extracted `failed_execution` object into `buildReviewContext` via a new optional 5th parameter `failed_execution?: ReviewContext['failed_execution']`. Update `packages/server/src/review/context-builder.ts` `buildReviewContext` signature to accept and pass-through that field on the returned `ReviewContext`. All other callers continue to compile because the parameter is optional.
  - [x] 4.4 No change required for `context_type === 'pre-deploy'` — the existing `buildReviewContext` output already covers security/reliability/data-integrity via `current_annotations` + `protected_zones` + `credentials_used`. The `context_type` is included in the response only if non-default; add it as an optional `review_request_context?: { type, execution_id? }` field on `ReviewContext` so Claude can see what triggered the call.

- [x] **Task 5: Server — POST /api/workflows/:id/activate** (AC: #4)
  - [x] 5.1 In `packages/server/src/api/routes/workflows.ts`, add a new route `POST /api/workflows/:id/activate` with body `{ force?: boolean }`. Verify workflow exists (404 on miss). Emit `review_requested` with `trigger: 'pre-deploy', context_type: 'pre-deploy'` via `getBroadcaster()?.broadcast(...)`.
  - [x] 5.2 Read `await annotationStore.getLatestReview(id)` (`packages/server/src/review/store.ts:159`). Compute `healthScore = latest?.healthScore ?? null`.
  - [x] 5.3 If `healthScore !== null && healthScore < 50 && body.force !== true` → return `{ healthScore, requiresConfirmation: true, warning: 'Health score is below 50. Activating may deploy a workflow with critical issues.', activated: false }`. No DB write.
  - [x] 5.4 Else update the workflow row `active=true, updatedAt=now`, broadcast `workflow_updated` with the `toWorkflow(updated)` payload (mirror the pattern from the existing PUT route), return `{ healthScore, requiresConfirmation: false, warning: null, activated: true }`.
  - [x] 5.5 Deactivation continues to flow through the existing `PUT /api/workflows/:id` route — do NOT add an explicit deactivate endpoint.

- [x] **Task 6: UI — API client + workflow store wiring** (AC: #2, #4)
  - [x] 6.1 In `packages/ui/src/lib/api.ts`, extend `requestReview(workflowId, body?: { trigger?: string; context_type?: string }): Promise<{ prompt: string }>` to forward the optional body. Add `activateWorkflow(workflowId, body?: { force?: boolean }): Promise<{ healthScore: number | null; requiresConfirmation: boolean; warning: string | null; activated: boolean }>` using the existing `request<T>` helper. Re-use the existing `Workflow` type.
  - [x] 6.2 In `packages/ui/src/store/workflow.ts`, add a `continuousReviewDebounceMs = 2000` module constant and a per-store `_continuousReviewTimer: ReturnType<typeof setTimeout> | null` field. Add an internal `_scheduleContinuousReview(workflowId: string)` action that clears any pending timer and schedules a new `setTimeout` to call `api.requestReview(workflowId, { trigger: 'continuous', context_type: 'on-edit' })`. Do NOT propagate errors — wrap in try/catch and `console.warn`.
  - [x] 6.3 Call `_scheduleContinuousReview` from inside the existing node/connection mutation actions (`addNode`, `updateNode`, `removeNode`, `moveNode`, `addConnection`, `removeConnection`) ONLY when `workflow?.settings?.continuousReviewEnabled === true`. Cancel the pending timer in `clearWorkflow`/unmount and on workflow change.

- [x] **Task 7: UI — Canvas toolbar continuous-review toggle + activate flow** (AC: #2, #4)
  - [x] 7.1 In `packages/ui/src/components/toolbar/CanvasToolbar.tsx`, add a small labelled checkbox `data-testid="continuous-review-toggle"` reading `workflow?.settings?.continuousReviewEnabled === true`. On change, call `api.updateWorkflow(id, { settings: { ...workflow.settings, continuousReviewEnabled: next } })` (use the existing update helper if present, otherwise the raw `PUT` via `api.ts`) and update the workflow store optimistically.
  - [x] 7.2 Add an "Activate"/"Deactivate" button (separate from the existing toolbar buttons; place it after the AI Review button from Story 2.3). When the workflow is inactive, clicking it calls `api.activateWorkflow(id)`. If `requiresConfirmation`, show a confirmation dialog (re-use the existing confirmation primitive if there is one in `components/ui/`; otherwise use `window.confirm` for MVP) with the returned `warning` text and an "Activate anyway" / "Cancel" pair. On confirm, re-call with `{ force: true }`. On success, write `workflow.active = true` into the store and show a toast/inline status. When the workflow is already active, the button is labelled "Deactivate" and PATCHes `active=false` via the existing `PUT /api/workflows/:id` route — no review-context flow.
  - [x] 7.3 The activate dialog must not be a new third-party dependency. If no internal dialog primitive exists, render an inline absolutely-positioned `<div role="dialog" aria-modal="true">` over the toolbar.

- [x] **Task 8: UI — Settings page hint** (AC: #6)
  - [x] 8.1 In `packages/ui/src/pages/Settings.tsx`, locate the existing `autoReviewEnabled` toggle and render a small `<p className="text-xs text-gray-500">Triggers a review_requested event whenever any workflow is saved. Claude Code sessions connected via MCP will be notified.</p>` directly below it. No state changes.

- [x] **Task 9: UI — WS debug logging for review triggers** (AC: #5)
  - [x] 9.1 In `packages/ui/src/store/ws.ts`, find the existing routing for `'review_requested'` (added in Story 2.3 — currently dropped). Add `console.debug('[review-trigger]', data.trigger ?? 'manual', data.context_type ?? 'general', data.workflow_id)` before the drop. Do NOT route the event into `useReviewStore` — the UI does not act on `review_requested` itself; it is purely an MCP-side signal.

- [x] **Task 10: Tests** (AC: #7)
  - [x] 10.1 Create `packages/server/src/__tests__/auto-review.test.ts` per AC#7. Use the same in-memory DB harness as `review-rest.test.ts`. Mock the broadcaster by injecting a `vi.fn()` into `createBroadcaster` or by spying on the singleton's `broadcast` method. Toggle `autoReviewEnabled` via `app.inject({ method: 'PUT', url: '/api/settings', payload: { autoReviewEnabled: true } })`.
  - [x] 10.2 Create `packages/server/src/__tests__/post-execution-review.test.ts` per AC#7. Build a 2-node workflow (`manual` → `code-js` with `code: "throw new Error('boom')"`). Run via `workflowExecutor.execute()`. Assert the broadcaster received exactly one `review_requested` call with `data.trigger === 'post-execution'` and one with `data.execution_id` matching the returned execution id. Then run a passing workflow and assert NO `review_requested` is emitted.
  - [x] 10.3 Create `packages/server/src/__tests__/activate-review.test.ts` covering all three branches in AC#4. Seed a `workflow_reviews` row with `healthScore = 30` for the low-score case. Assert DB state via `db.select().from(workflows).where(eq(workflows.id, id))` after each call.
  - [x] 10.4 Extend `packages/server/src/__tests__/review-mcp.test.ts` (or create `get-review-context-execution.test.ts` if extension is messy) to cover `context_type: 'post-execution'` + `execution_id`: assert `failed_execution.bottleneck_node_id` is populated from the slowest non-success node-execution, and assert `ReviewNotFoundError` for a bogus execution id.
  - [x] 10.5 Create `packages/ui/src/__tests__/continuous-review.test.tsx` per AC#7 — uses `vi.useFakeTimers()`, asserts debounce coalesces three rapid edits into one `requestReview` call.
  - [x] 10.6 Create `packages/ui/src/__tests__/activate-flow.test.tsx` per AC#7 — covers the confirmation dialog and the `{ force: true }` re-call. Mock `api.activateWorkflow` via `vi.mock('../lib/api')`.
  - [x] 10.7 Run `npm run --workspace packages/server test`, `npm run --workspace packages/ui test`, and `npm run build` at the repo root. All existing + new tests must pass and the whole graph must type-check.

## Dev Notes

This story builds entirely on top of the foundation laid by Stories 2.1–2.3:
- The `review_requested` WebSocketEventType already exists (`packages/shared/src/types/mcp.ts:25`).
- The manual review flow already broadcasts `review_requested` from `packages/server/src/api/routes/review.ts:117` — Task 2.4 just enriches the payload schema.
- The `instanceSettings.autoReviewEnabled` column already exists (`packages/server/src/db/schema.ts`) and has a working PUT endpoint at `packages/server/src/api/routes/settings.ts:40` — no schema migration is needed.
- The annotation/health-score store (`annotationStore.getLatestReview` at `packages/server/src/review/store.ts:159`) is the source of truth for the pre-deploy gate.
- `WorkflowExecutor.execute()` already broadcasts `execution_completed` at `executor.ts:160` — the post-execution trigger sits one line below.

**Key invariants to preserve:**
- Zero-cost AI: NO new server-side AI calls. The review modes only emit WS signals; Claude (on the user's MCP-connected session) does the analysis with the user's tokens.
- Auto-review failures must never block a workflow mutation. Wrap every `maybeEmitAutoReview` call in a try/catch (the helper itself does the catch, but defense-in-depth at the call site is fine).
- No new dependencies. `lucide-react`, `vitest`, `@testing-library/react`, `zod`, `drizzle-orm`, and `fastify` are already in the workspaces.
- No DB migrations. `workflow.settings` is already a `jsonb` column so the per-workflow `continuousReviewEnabled` flag piggybacks on it.

**Continuous review debounce:** the 2000 ms window matches AC#2 of the epic spec. Trailing-edge only — no leading edge — so a single edit triggers exactly one request 2 s later.

**Pre-deploy gate threshold:** `< 50` matches the breadcrumb's existing red threshold in `EditorBreadcrumb.tsx:17`. Keep them in sync; if a future story changes the threshold, both this route and the breadcrumb pill must move together.

**MCP-side mutation hooks (Task 2.3):** The exact filenames for the workflow/node MCP tools are not yet pinned in this story — `packages/server/src/mcp/tools/` currently contains `agent-teams.ts` and `review.ts`. The CRUD MCP tools either live in another file (likely `packages/server/src/mcp/index.ts` or a yet-uncreated `workflow.ts`) or have not been registered yet. **Open question for the dev agent:** verify where `update_workflow`, `add_node`, etc. are registered and wire `maybeEmitAutoReview` into all of them; if the tools do not exist yet, the auto-review hook for the MCP-side path can be deferred to whichever story actually adds those tool registrations — note this in the completion notes.

### Project Structure Notes

- New server file: `packages/server/src/review/triggers.ts` (helper)
- New server tests: `packages/server/src/__tests__/auto-review.test.ts`, `post-execution-review.test.ts`, `activate-review.test.ts`
- New UI tests: `packages/ui/src/__tests__/continuous-review.test.tsx`, `activate-flow.test.tsx`
- Modified server: `api/routes/workflows.ts` (auto-review hook + activate route), `api/routes/review.ts` (enriched manual-review payload), `engine/executor.ts` (post-execution trigger), `mcp/tools/review.ts` (extended `get_review_context`), `review/context-builder.ts` (`failed_execution` pass-through)
- Modified shared: `types/mcp.ts` (`ReviewRequestedPayload`), `types/annotation.ts` (`ReviewContext.failed_execution?`)
- Modified UI: `lib/api.ts`, `store/workflow.ts`, `store/ws.ts`, `components/toolbar/CanvasToolbar.tsx`, `pages/Settings.tsx`

### References

- Epic 2 Story 2.4 acceptance criteria — [Source: _bmad-output/planning-artifacts/epics.md#Story 2.4: Advanced Review Modes (lines 536–561)]
- Story 2.3 review/request endpoint and `review_requested` event — [Source: _bmad-output/implementation-artifacts/2-3-canvas-annotation-ui-on-demand-review.md, packages/server/src/api/routes/review.ts:117]
- Instance settings table + endpoint — [Source: packages/server/src/api/routes/settings.ts, packages/shared/src/types/instance-settings.ts]
- Executor completion broadcast point — [Source: packages/server/src/engine/executor.ts:160]
- Latest review accessor — [Source: packages/server/src/review/store.ts:159]
- Health pill thresholds — [Source: packages/ui/src/components/editor/EditorBreadcrumb.tsx:13–18]
- WebSocketEventType union including `review_requested` — [Source: packages/shared/src/types/mcp.ts:7–32]
- Zero-cost AI invariant — [Source: CLAUDE.md "Zero-cost AI model" section]

## Dev Agent Record

### Agent Model Used

claude-opus-4-6[1m]

### Debug Log References

- `npm run --workspace packages/shared build` ✅
- `npm run --workspace packages/server build` ✅
- `npm run --workspace packages/ui build` ✅
- New server tests (auto-review, post-execution-review, activate-review, get-review-context-execution): 14/14 pass
- New UI tests (continuous-review, activate-flow): 4/4 pass
- Pre-existing failures unrelated to this story (verified via baseline run): `settings-and-audit.test.ts` (mock missing `onConflictDoNothing`), `broadcaster.test.ts` (port collision), `team-store.test.ts`, `team-dashboard.test.ts`. None touch code modified in this story.

### Completion Notes List

- All 10 tasks complete.
- Zero-cost AI invariant preserved: `grep -RE "@anthropic-ai/sdk|OpenAI|openai" packages/server/src packages/ui/src` returns no matches in non-test code.
- No new dependencies added; no DB migrations.
- Auto-review hook wired into both REST routes (`workflows.ts`) and the MCP CRUD handlers (`mcp/index.ts` — `handleAddNode`, `handleUpdateNode`, `handleRemoveNode`, `handleConnectNodes`, `handleDisconnectNodes`). The story's open question about `update_workflow` MCP tool: there is no such MCP tool today (workflow-level updates only happen via REST `PUT`); the REST hook covers that path. If a future story registers `flowaibuilder.update_workflow`, the same `maybeEmitAutoReview` helper should be wired in.
- `get_review_context` handler refactored to a module-level `handleGetReviewContext({ workflow_id, execution_id?, context_type? })` exported from `packages/server/src/mcp/tools/review.ts`. The MCP `server.tool` callback delegates to it; tests call it directly.
- `buildReviewContext` signature now accepts two extra optional params (`failed_execution`, `review_request_context`) — all existing 4-arg callers continue to compile.
- `ReviewContext` shared type extended with optional `failed_execution?` and `review_request_context?` fields; existing consumers compile unchanged.
- Pre-deploy gate threshold (`< 50`) matches `EditorBreadcrumb.tsx`. Documented in story Dev Notes.
- Continuous-review debounce (2000 ms trailing-edge) implemented as module-level helper functions `scheduleContinuousReview` / `cancelContinuousReview` exported from `store/workflow.ts`. Per-workflow toggle persisted into `workflow.settings.continuousReviewEnabled` (jsonb, no migration). Wired into `updateNodePosition`, `updateNodeConfig`, `addNode`, `removeNode`, `onConnect` mutation actions in `workflow.ts`. Pending timer cancelled in `cancelPendingSaves` (called on workflow unload).
- Activate flow uses an inline `role="dialog"` element rendered from `CanvasToolbar.tsx` (no new dependency). Deactivation continues through the existing `PUT /api/workflows/:id` route.
- WS store now logs `[review-trigger]` debug entries for incoming `review_requested` events before dropping them (UI does not act on the event itself — it's an MCP-side signal).
- Settings page now shows the explanatory hint directly under the `autoReviewEnabled` checkbox.

### File List

**New:**
- `packages/server/src/review/triggers.ts`
- `packages/server/src/__tests__/auto-review.test.ts`
- `packages/server/src/__tests__/post-execution-review.test.ts`
- `packages/server/src/__tests__/activate-review.test.ts`
- `packages/server/src/__tests__/get-review-context-execution.test.ts`
- `packages/ui/src/__tests__/continuous-review.test.tsx`
- `packages/ui/src/__tests__/activate-flow.test.tsx`

**Modified:**
- `packages/shared/src/types/mcp.ts` (added `ReviewTrigger`, `ReviewContextType`, `ReviewRequestedPayload`)
- `packages/shared/src/types/annotation.ts` (added `failed_execution?` and `review_request_context?` to `ReviewContext`)
- `packages/shared/src/index.ts` (re-export new types)
- `packages/server/src/api/routes/workflows.ts` (auto-review hooks on all 6 mutation routes; new `POST /api/workflows/:id/activate` route)
- `packages/server/src/api/routes/review.ts` (manual `/review/request` accepts optional `{ trigger, context_type }` body and forwards into payload)
- `packages/server/src/engine/executor.ts` (post-execution `review_requested` broadcast on failure)
- `packages/server/src/mcp/tools/review.ts` (extracted `handleGetReviewContext`, added `execution_id`/`context_type` zod inputs, `failed_execution` enrichment, `review_request_context` propagation)
- `packages/server/src/review/context-builder.ts` (`buildReviewContext` signature accepts optional `failed_execution` and `review_request_context`)
- `packages/server/src/mcp/index.ts` (auto-review hooks on `handleAddNode`, `handleUpdateNode`, `handleRemoveNode`, `handleConnectNodes`, `handleDisconnectNodes`)
- `packages/ui/src/lib/api.ts` (`requestReview` accepts optional body, new `activateWorkflow` helper)
- `packages/ui/src/store/workflow.ts` (continuous-review debounce: `scheduleContinuousReview`, `cancelContinuousReview`, `continuousReviewDebounceMs`; wired into mutation actions; cancelled on unload)
- `packages/ui/src/store/ws.ts` (debug log for `review_requested` events)
- `packages/ui/src/components/toolbar/CanvasToolbar.tsx` (continuous-review checkbox, Activate/Deactivate button, low-health confirmation dialog)
- `packages/ui/src/pages/Settings.tsx` (hint text under `autoReviewEnabled` toggle)

### Change Log

- 2026-04-08 — Story 2.4 implementation: auto-review trigger helper, post-execution review on failure, pre-deploy activate gate with health-score threshold, continuous-review debounce, settings page hint, WS debug logging. Zero-cost AI invariant preserved; no new deps; no schema migrations.

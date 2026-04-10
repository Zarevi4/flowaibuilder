# Story 2.2: Annotation Fix Engine & Health Score

Status: done

## Story

As a workflow user,
I want one-click fixes that Claude defined in annotations and a health score for my workflow,
so that I can resolve issues instantly and understand overall workflow quality at a glance.

## Acceptance Criteria

1. **Given** an annotation exists with a `fix` field `{ tool, params, description }` and `status='active'` **When** Claude (or the user) calls `flowaibuilder.apply_fix({ workflow_id, annotation_id })` **Then** the server dispatches the fix by invoking the named MCP tool handler with the stored params (no external HTTP hop — an in-process dispatcher calls the same function bodies already registered in `packages/server/src/mcp/index.ts` and `tools/review.ts`). **And** the annotation row's `status` is updated to `'applied'` and `appliedAt` is set to `now`. **And** a single `annotation_applied` event is broadcast via the WebSocket broadcaster with payload `{ annotation_id, workflow_id, node_id, tool, result }`. The tool returns `{ applied: true, annotation_id, tool, result }`. If the annotation does not exist, belongs to a different workflow, has no `fix`, is already `applied`/`dismissed`, or references an unknown tool, the tool returns an `mcpError` and no DB mutation occurs.

2. **Given** Claude calls `flowaibuilder.save_annotations` with a `health_score` and/or a `scores` breakdown **When** the call succeeds **Then** the inserted `workflow_reviews` row stores `healthScore` (0-100) and `scores` as `{ security, reliability, dataIntegrity, bestPractices }` where each per-dimension score is clamped to 0-25 (total contribution of 0-100). The returned `health_score` in the tool response matches the persisted value, and the broadcast `annotations_updated` payload includes `health_score` and `scores`.

3. **Given** a workflow has one or more `workflow_reviews` rows **When** Claude calls `flowaibuilder.get_health_score({ workflow_id })` **Then** the tool returns `{ health_score, scores, summary, review_id, review_type, annotation_count, created_at }` from the most recent review (ordered by `createdAt DESC`), or `{ health_score: null, scores: null, summary: null, review_id: null, review_type: null, annotation_count: 0, created_at: null }` if no review exists. Missing workflow id returns an MCP error.

4. **Given** the four existing review MCP tools from Story 2.1 **When** an MCP client lists tools after the server starts **Then** two new tools are present — `flowaibuilder.apply_fix` and `flowaibuilder.get_health_score` — both with zod-validated param schemas and descriptive `.describe()` strings on every field, following the exact pattern of `packages/server/src/mcp/tools/review.ts`.

5. **Given** the `annotation_applied` event type does not yet exist in `WebSocketEventType` **When** this story is implemented **Then** `'annotation_applied'` is added to the union in `packages/shared/src/types/mcp.ts`, the shared package rebuilds cleanly, and the broadcaster test harness still passes.

6. **Given** the server package **When** the server builds and tests run **Then** no new dependency on `@anthropic-ai/sdk` (or any AI-provider SDK) is introduced — the fix engine is a pure in-process dispatcher over existing MCP tool handlers, consistent with the zero-cost AI principle in `CLAUDE.md`.

## Tasks / Subtasks

- [x] **Task 1: Fix dispatcher + store extensions** (AC: #1, #2, #3)
  - [x] 1.1 Extend `packages/server/src/review/store.ts` with `applyAnnotation(workflowId, annotationId)`:
    - Load the annotation row by `id`.
    - Return `null` if the row does not exist, `workflowId` mismatches, `status !== 'active'`, or the row has no `fix`.
    - Otherwise, update `status='applied'` and `appliedAt=new Date()` via `db.update(annotations).set(...).where(and(eq(id, ...), eq(workflowId, ...))).returning()`.
    - Return the updated `Annotation` (use existing `rowToAnnotation` helper).
  - [x] 1.2 Extend the store with `getLatestReview(workflowId)`:
    - `db.select().from(workflowReviews).where(eq(workflowReviews.workflowId, workflowId)).orderBy(desc(workflowReviews.createdAt)).limit(1)`.
    - Return a plain object `{ reviewId, healthScore, scores, summary, reviewType, annotationCount, createdAt }` (camelCase — the MCP tool maps it to snake_case for the wire shape), or `null` if no row.
  - [x] 1.3 Create `packages/server/src/review/fix-dispatcher.ts` exporting `FixDispatcher`:
    - Maintains a `Map<string, (params: Record<string, unknown>) => Promise<unknown>>` of registered handler functions keyed by MCP tool name (e.g. `'flowaibuilder.update_node'`, `'flowaibuilder.connect_nodes'`, `'flowaibuilder.disconnect_nodes'`, `'flowaibuilder.remove_node'`, `'flowaibuilder.add_node'`).
    - Exports `registerFixHandler(toolName, handler)` and `dispatchFix(toolName, params)`.
    - `dispatchFix` throws a typed `UnknownFixToolError` if the tool is not registered. The MCP tool catches this and returns `mcpError`.
  - [x] 1.4 In `packages/server/src/mcp/index.ts`, refactor each existing mutation tool (`add_node`, `update_node`, `remove_node`, `connect_nodes`, `disconnect_nodes`) so its body is a top-level `async function` (e.g. `async function handleUpdateNode(params)`) AND the `server.tool(...)` callback just calls it. Then call `registerFixHandler('flowaibuilder.update_node', handleUpdateNode)` (etc.) at the bottom of `createMcpServer()` **before** `registerReviewTools(server)` so the dispatcher is populated for reuse.
    - **Important:** Do not duplicate logic. The `server.tool` callback must delegate to the extracted function. This is the only safe way to share handlers between MCP dispatch and in-process `apply_fix` dispatch.
    - Keep the handler signatures uniform: `async (params: Record<string, unknown>) => { content: [{ type: 'text', text: string }] }` — matching what `server.tool` already expects.

- [x] **Task 2: Register `apply_fix` + `get_health_score` MCP tools** (AC: #1, #3, #4)
  - [x] 2.1 In `packages/server/src/mcp/tools/review.ts`, add `flowaibuilder.apply_fix`:
    - Params: `{ workflow_id: z.string(), annotation_id: z.string() }` with `.describe()` on each.
    - Load the annotation via `annotationStore.getAnnotations(workflow_id, { status: 'active' })` filtered by id — OR add a new `store.getAnnotationById(annotationId)` helper (prefer the helper for clarity). If not found / wrong workflow / already applied / dismissed / no `fix` → `mcpError` with a descriptive message.
    - Call `dispatchFix(annotation.fix.tool, { workflow_id, ...annotation.fix.params })`. Catch `UnknownFixToolError` → `mcpError(\`Unknown fix tool: ${tool}\`)`. Catch any other throw → `mcpError(\`Fix failed: ${err.message}\`)` and **do not** mark the annotation applied.
    - On success, call `annotationStore.applyAnnotation(workflow_id, annotation_id)`.
    - Broadcast `annotation_applied` via `getBroadcaster()?.broadcast('annotation_applied', workflow_id, { annotation_id, workflow_id, node_id: annotation.nodeId, tool: annotation.fix.tool, result })`.
    - Return `{ content: [{ type: 'text', text: JSON.stringify({ applied: true, annotation_id, tool: annotation.fix.tool, result }) }] }`.
  - [x] 2.2 Add `flowaibuilder.get_health_score`:
    - Params: `{ workflow_id: z.string() }`.
    - Verify the workflow exists (same pattern as `get_review_context`) — `mcpError` if not.
    - Call `annotationStore.getLatestReview(workflow_id)`.
    - Return the snake_case wire shape: `{ health_score, scores: { security, reliability, data_integrity, best_practices } | null, summary, review_id, review_type, annotation_count, created_at }`. Map `dataIntegrity` → `data_integrity`, `bestPractices` → `best_practices`. Return all-null if no review exists.
  - [x] 2.3 Confirm `registerReviewTools` runs **after** the fix-handler registration in `createMcpServer()` — the order matters because `apply_fix` relies on `dispatchFix` having handlers.

- [x] **Task 3: Shared types + broadcaster event** (AC: #2, #5)
  - [x] 3.1 In `packages/shared/src/types/mcp.ts`, add `'annotation_applied'` to the `WebSocketEventType` union (after `'annotations_updated'`). Do not remove any existing types.
  - [x] 3.2 In `packages/shared/src/types/annotation.ts`, clamp-validate the doc comments on `ReviewScores` to indicate each dimension is 0-25 (4 × 25 = 100). No runtime change needed — just a comment update. The existing `ReviewScores` interface is already correct shape-wise.
  - [x] 3.3 Add a `HealthScoreResult` interface in `annotation.ts` describing the exact wire shape returned by `get_health_score` (snake_case fields). Re-export from `packages/shared/src/index.ts`.
  - [x] 3.4 Rebuild shared: `npm run --workspace packages/shared build` should succeed with no TS errors; the server and UI packages should still typecheck.

- [x] **Task 4: Tests** (AC: #1, #2, #3, #4, #5, #6)
  - [x] 4.1 Create `packages/server/src/__tests__/fix-engine.test.ts`. Follow the Vitest + in-memory DB harness used by `review-mcp.test.ts`.
  - [x] 4.2 Cases:
    - `applyAnnotation` on an active annotation with a `fix` sets `status='applied'` and `appliedAt`.
    - `applyAnnotation` returns `null` for unknown id, wrong `workflowId`, already-applied, dismissed, or no-`fix` rows — and leaves the row untouched.
    - `dispatchFix('flowaibuilder.update_node', { workflow_id, node_id, config: {...} })` invokes the real `handleUpdateNode` and mutates the workflow row in the test DB.
    - `dispatchFix('flowaibuilder.unknown_tool', {})` throws `UnknownFixToolError`.
    - Full `apply_fix` MCP tool path (happy path): save an annotation with a `fix` that targets `update_node`, call `apply_fix`, assert the node config was updated AND the annotation is applied AND an `annotation_applied` broadcast was emitted (spy on `getBroadcaster()` as `broadcaster.test.ts` does).
    - `apply_fix` on an annotation whose fix throws: the DB annotation is NOT marked applied and no broadcast is emitted.
    - `get_health_score` returns the most recent review (insert two reviews with different `createdAt`).
    - `get_health_score` on a workflow with zero reviews returns all-null and `annotation_count: 0`.
    - `save_annotations` (regression) round-trips `scores.dataIntegrity`/`bestPractices` correctly via the snake_case mapping and the broadcast payload includes `scores`.
  - [x] 4.3 Run `npm run --workspace packages/server test` — all existing tests + new ones must pass.
  - [x] 4.4 Confirm `packages/server/package.json` dependencies are unchanged except for (none). `grep -R "@anthropic-ai/sdk" packages/server` must return nothing.

- [x] **Task 5: Broadcaster payload check**
  - [x] 5.1 In `packages/server/src/mcp/tools/review.ts`, extend the existing `save_annotations` broadcast payload to also include `scores` (snake_case form) alongside `health_score`. This is backward-compatible — the existing listener in Story 2.1 tests only asserts presence of `annotations` and `health_score`.

## Dev Notes

### Architectural constraints (from CLAUDE.md + architecture.md)

- **Zero-cost AI (CLAUDE.md)**: `apply_fix` is pure dispatch. It calls MCP tool handler functions that already exist in this repo. No AI call, no HTTP, no new SDK. Do not add `@anthropic-ai/sdk`.
- **MCP-first (CLAUDE.md)**: Both new capabilities ship as MCP tools (`apply_fix`, `get_health_score`). No REST endpoints are added in this story. Story 2.3 will add the canvas UI and (if needed) a read-only REST endpoint for the health score.
- **File conventions (CLAUDE.md)**: New tools live in `packages/server/src/mcp/tools/review.ts` (extend the existing file — do NOT create a new `tools/fix-engine.ts`; the review.ts file is already the "review + fix" tool group). Dispatcher code lives in `packages/server/src/review/fix-dispatcher.ts`. Store extensions stay in `packages/server/src/review/store.ts`.
- **Broadcaster (Story 2.1 + broadcaster.ts)**: Use `getBroadcaster()?.broadcast(type, workflowId, data)`. The new `'annotation_applied'` type MUST be added to the shared union first or TypeScript will reject the `broadcast(...)` call at build time.
- **Health score scoring rubric (epics.md#Story 2.2)**: The per-dimension scores are each 0-25, totalling 0-100. The `ReviewScores` shape already exists in `packages/shared/src/types/annotation.ts:26-31` — do not rename or change its shape. Validate this at the MCP tool boundary via zod (`z.number().min(0).max(25)`) — this is a tightening of Story 2.1's `z.number()` (which was open-ended).
- **Already-applied / dismissed annotations are immutable**: Story 2.1 made dismiss a one-way state change. Apply is likewise one-way. Re-applying or applying a dismissed annotation is an error, not a no-op — return `mcpError` to make the failure visible to Claude.
- **Handler extraction is the load-bearing refactor**: The cleanest way to make `apply_fix` actually *fix* things is to share handler functions with the MCP `server.tool` callbacks. Do NOT duplicate business logic across two paths. Extract, register, delegate.

### Source tree touch list

- NEW: `packages/server/src/review/fix-dispatcher.ts`
- NEW: `packages/server/src/__tests__/fix-engine.test.ts`
- EDIT: `packages/server/src/review/store.ts` — add `applyAnnotation`, `getLatestReview`, and optionally `getAnnotationById`
- EDIT: `packages/server/src/mcp/tools/review.ts` — add `apply_fix`, `get_health_score`, extend `save_annotations` broadcast payload, tighten `scores` zod schema to 0-25
- EDIT: `packages/server/src/mcp/index.ts` — extract `handleAddNode`, `handleUpdateNode`, `handleRemoveNode`, `handleConnectNodes`, `handleDisconnectNodes` as module-level functions; call `registerFixHandler(...)` for each inside `createMcpServer()` **before** `registerReviewTools(server)`
- EDIT: `packages/shared/src/types/mcp.ts` — add `'annotation_applied'` to `WebSocketEventType`
- EDIT: `packages/shared/src/types/annotation.ts` — add `HealthScoreResult` interface, doc-comment the 0-25 scoring
- EDIT: `packages/shared/src/index.ts` — re-export `HealthScoreResult`

### Previous story intelligence (Story 2.1)

- Story 2.1 (file: `_bmad-output/implementation-artifacts/2-1-review-context-builder-core-mcp-tools.md`, status: done) already:
  - Created `packages/server/src/review/store.ts` with `annotationStore` (object literal — keep extending the same literal; do not convert to a class).
  - Created `packages/server/src/mcp/tools/review.ts` with `registerReviewTools` and the existing 4 review tools (`get_review_context`, `save_annotations`, `get_annotations`, `dismiss_annotation`). Mirror the exact coding style: `mcpError` helper at top, zod schemas inline with `.describe()`, `getBroadcaster()?.broadcast(...)` for all events.
  - Hooked `registerReviewTools(server)` into `createMcpServer()` in `packages/server/src/mcp/index.ts:435`.
  - Added the `annotations` + `workflowReviews` tables in `packages/server/src/db/schema.ts:104-137`. `annotations.appliedAt` (line 121) already exists — this story flips it from "defined but unused" to "written on apply".
  - Added `ReviewContext`, `AnnotationInput`, `ReviewScores`, `Annotation` types in `packages/shared/src/types/annotation.ts` — reuse these, extend only as listed in Task 3.
- Story 2.1 explicitly deferred `apply_fix` and `annotation_applied` broadcasts to this story (2.2) — you are completing that deferral.

### Git intelligence

- Latest commit `d1183f7 feat: Stories 5-6 + fixes — MCP server, REST API, WebSocket broadcaster` contains the handler shape you will be extracting in Task 1.4. The `server.tool(name, schema, async (params) => { ... })` pattern is uniform across `add_node`/`update_node`/`remove_node`/`connect_nodes` in `packages/server/src/mcp/index.ts`. Extraction should be mechanical: copy the body into a named `async function handleX(params)`, then call it from the `server.tool` callback.
- No prior commits touch `packages/server/src/review/fix-dispatcher.ts` — this file is greenfield.
- Follow the existing broadcaster spy pattern from Story 2.1's tests (see `packages/server/src/__tests__/review-mcp.test.ts` and `broadcaster.test.ts`).

### Testing standards

- Framework: Vitest. Use `describe` / `it` / `expect` and the existing in-memory DB harness from `review-mcp.test.ts`.
- Always assert both DB state AND broadcast invocations — both are load-bearing for Story 2.3's canvas UI.
- Cover error paths explicitly (unknown tool, already-applied, wrong workflow id, fix-handler throw). Silent no-ops are banned — each failure must surface as `mcpError` so Claude can see it.
- Do not mock the MCP SDK. The in-process dispatcher avoids the need for MCP transport mocking entirely.

### References

- [Source: CLAUDE.md] — Zero-cost AI principle, MCP-first, file conventions.
- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.2] — Acceptance criteria (lines 480-501).
- [Source: _bmad-output/implementation-artifacts/2-1-review-context-builder-core-mcp-tools.md] — Prior story context, scaffolding already in place.
- [Source: packages/server/src/db/schema.ts:104-137] — `annotations` (incl. `appliedAt`) + `workflowReviews` columns.
- [Source: packages/server/src/review/store.ts] — `annotationStore` literal to extend.
- [Source: packages/server/src/mcp/tools/review.ts] — MCP tool file to extend; mirror its `mcpError` / zod / broadcaster pattern.
- [Source: packages/server/src/mcp/index.ts:125-220] — `update_node`, `remove_node`, `connect_nodes` handlers to extract.
- [Source: packages/shared/src/types/mcp.ts:7-29] — `WebSocketEventType` union to extend.
- [Source: packages/shared/src/types/annotation.ts:4-54] — `AnnotationFix`, `Annotation`, `ReviewScores`, `AnnotationInput` types.
- [Source: packages/server/src/api/ws/broadcaster.ts:77] — `broadcast(type, workflowId, data)` signature.

## Dev Agent Record

### Agent Model Used

claude-opus-4-6 (bmad-dev-story workflow)

### Debug Log References

- `npm run --workspace packages/shared build` → clean
- `npx --workspace packages/server tsc --noEmit` → only pre-existing unrelated error in `agent-teams-intervention.test.ts`
- `npm test -- fix-engine.test.ts review-mcp.test.ts` → 15/15 pass
- Pre-existing unrelated failures in `broadcaster.test.ts` (EADDRINUSE port collision from compiled .js duplicate) and `settings-and-audit.test.ts` are not introduced by this story

### Completion Notes List

- Extracted `handleAddNode`, `handleUpdateNode`, `handleRemoveNode`, `handleConnectNodes`, `handleDisconnectNodes` as module-level functions in `packages/server/src/mcp/index.ts`; `server.tool` callbacks now delegate to them (no duplicated logic).
- New `packages/server/src/review/fix-dispatcher.ts` provides `registerFixHandler`/`dispatchFix`/`UnknownFixToolError`. Fix handlers registered in `createMcpServer()` before `registerReviewTools(server)`.
- `annotationStore` gained `applyAnnotation`, `getLatestReview`, and `getAnnotationById`. `applyAnnotation` is a one-way transition and refuses unknown/wrong-workflow/already-applied/dismissed/no-fix rows.
- New MCP tools: `flowaibuilder.apply_fix` and `flowaibuilder.get_health_score`. `apply_fix` dispatches to the shared handler, marks the annotation applied, and broadcasts `annotation_applied`. If the fix handler throws, the annotation is NOT marked applied and no broadcast is emitted.
- `save_annotations` scores schema tightened to per-dimension 0-25 (total 0-100); broadcast payload now includes `scores` in snake_case form (backward compatible).
- Shared: `'annotation_applied'` added to `WebSocketEventType`; `HealthScoreResult` interface added and re-exported; `ReviewScores` doc comments note the 0-25 rubric.
- Zero-cost AI invariant preserved — `grep -R "@anthropic-ai/sdk" packages/server` only matches the assertion in `review-mcp.test.ts`.

### File List

- NEW: `packages/server/src/review/fix-dispatcher.ts`
- NEW: `packages/server/src/__tests__/fix-engine.test.ts`
- EDIT: `packages/server/src/review/store.ts`
- EDIT: `packages/server/src/mcp/tools/review.ts`
- EDIT: `packages/server/src/mcp/index.ts`
- EDIT: `packages/shared/src/types/mcp.ts`
- EDIT: `packages/shared/src/types/annotation.ts`
- EDIT: `packages/shared/src/index.ts`

### Change Log

- 2026-04-08: Story 2.2 implemented — fix dispatcher, `apply_fix`, `get_health_score`, `annotation_applied` event, scores 0-25 validation.
- 2026-04-08: Code review fixes applied — B1 (workflow_id spread order), H1 (applyAnnotation atomic CAS), H2 (apply_fix happy+failure path tests), M3 (save_annotations scores broadcast assertion). M1/M2/L1-L4 logged in `deferred-work.md`. Status → done.

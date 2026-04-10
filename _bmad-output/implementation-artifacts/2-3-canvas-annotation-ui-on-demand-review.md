# Story 2.3: Canvas Annotation UI & On-Demand Review

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a workflow user,
I want to see AI review annotations on the canvas and trigger reviews with a button,
so that I can visually identify issues and get Claude's analysis on demand.

## Acceptance Criteria

1. **Given** annotations exist for the current workflow **When** the editor page loads a workflow **Then** the UI fetches the list of `status='active'` annotations and the latest `get_health_score` result via read-only REST endpoints (`GET /api/workflows/:id/annotations` and `GET /api/workflows/:id/health`) added in this story, which are thin wrappers over the existing `annotationStore.getAnnotations` and `annotationStore.getLatestReview` helpers. Both endpoints return the same camelCase shapes used by the rest of the UI (`Annotation[]` and a `HealthScoreResult` mapped to camelCase via a shared helper or returned as-is in the snake_case wire shape — the UI picks one and uses it consistently). `404` on unknown workflow id, `200 { annotations: [] }` / `200 { healthScore: null, … }` on empty.

2. **Given** annotations are loaded into a new Zustand `useReviewStore` **When** a `review_completed`, `annotations_updated`, `annotation_added`, or `annotation_applied` WebSocket event arrives for the current workflow **Then** the store refreshes (incremental for single-annotation events, full refetch via the REST endpoint for `annotations_updated`/`review_completed`) and the canvas re-renders without a page reload. Routing lives in `packages/ui/src/store/ws.ts` alongside the existing team-event routing (an `annotationEventTypes` list), and the store exposes `annotations`, `healthScore`, `scores`, `annotationCount`, `loading`, `error`, plus actions `loadForWorkflow(id)`, `applyFix(annotationId)`, `dismiss(annotationId, reason?)`. `'review_completed'` is added to `WebSocketEventType` in `packages/shared/src/types/mcp.ts` (the event is not emitted by the server yet — it is reserved for Story 2.4 — but the UI must already handle it).

3. **Given** annotations are present **When** the `ReactFlow` canvas renders **Then** for each annotation a React-Flow overlay card is positioned next to its target node (derived from `nodeId` → current node `position` via `useReactFlow().getNode(id)`), with a faint SVG connector line from the card to the node handle. Cards are color-coded by `severity`: red border/badge for `error`, amber for `warning`, blue for `suggestion`. The card collapses to a compact badge (icon + title, max 220px wide) by default and has an accessible `aria-label` of `"{severity}: {title}"`. Cards render inside a new `<ReactFlowAnnotationLayer />` child of `<ReactFlow>` so they pan/zoom with the canvas. Multiple annotations on the same node stack vertically with 4px spacing. Cards are **not** stored as React Flow nodes — they are a pure overlay so they don't pollute the workflow graph model.

4. **Given** I click an annotation card **When** it expands **Then** it shows the full `description`, a "Related nodes" chip list (from `relatedNodes`, each clicking selects that node via `useWorkflowStore.setState({ … })` or `ReactFlow`'s `setCenter`), and — if `annotation.fix` is present — an **Apply Fix** button showing `fix.description` as its tooltip and a **Dismiss** button. Clicking outside the card or pressing `Esc` collapses it.

5. **Given** I click "Apply Fix" **When** the call succeeds **Then** the UI invokes `POST /api/workflows/:id/annotations/:annotationId/apply` which calls the already-registered `apply_fix` MCP handler in-process (via a new `handleApplyFix` extraction identical to the handler-extraction pattern from Story 2.2), returning `{ applied: true, annotation_id, tool, result }`. The store marks the annotation as `status='applied'` immediately (optimistic) and applies a visual transition (muted opacity 0.5, strikethrough on the title). The server's existing `annotation_applied` broadcast confirms the change and reconciles. On error, the optimistic state reverts and an inline error message appears on the card for 5 seconds.

6. **Given** I click "Dismiss" **When** I optionally enter a reason in a lightweight inline input (or press the button a second time to dismiss with no reason) **Then** the UI calls `POST /api/workflows/:id/annotations/:annotationId/dismiss` (thin REST wrapper around the existing `dismiss_annotation` MCP handler, extracted to a top-level `handleDismissAnnotation`) and the card is removed from the canvas on success. The existing `annotations_updated` broadcast reconciles with other clients.

7. **Given** any annotations exist **When** the editor header renders **Then** the existing `EditorBreadcrumb` health pill reads `healthScore` from `useReviewStore` instead of the stale `(workflow as any).review?.healthScore` field it reads today — the pill color thresholds (`>=90` green, `>=70` amber, `>=50` orange, `<50` red) and `—` fallback behavior are preserved. An **annotation counter badge** is added to the breadcrumb (or adjacent to the health pill) showing the count of `status='active'` annotations, with tooltip `"{n} active annotations ({errors} errors, {warnings} warnings, {suggestions} suggestions)"`. Clicking the counter opens a `ReviewPanel` sidebar drawer listing all active annotations (scrollable, grouped by severity); clicking an entry scrolls/centers the canvas on the target node.

8. **Given** the canvas toolbar **When** the user clicks a new **AI Review** button (icon: `Sparkles` from lucide-react) **Then** the button triggers the `POST /api/workflows/:id/review/request` endpoint which (a) emits a new `review_requested` WebSocket broadcast so MCP-connected Claude Code sessions can pick it up and call `get_review_context`, and (b) returns `{ prompt }` — a ready-to-paste one-liner the UI copies to the clipboard and shows as a toast: `"Review requested. Paste this into Claude Code: Review workflow <id>."`. `'review_requested'` is added to `WebSocketEventType`. No AI call is made server-side. The button shows a brief spinner (<500ms) then returns to idle state. Zero-cost AI invariant preserved — `grep -R "@anthropic-ai/sdk" packages/server packages/ui` must not match any new code.

9. **Given** Vitest is configured for both server and UI packages **When** the test suites run **Then** the following tests exist and pass:
   - `packages/server/src/__tests__/review-rest.test.ts` — exercises the 5 new REST endpoints (`GET annotations`, `GET health`, `POST apply`, `POST dismiss`, `POST review/request`) against the in-memory DB harness used by `review-mcp.test.ts`, asserts the JSON shapes, 404 on unknown workflow id, and verifies `apply` and `dismiss` actually mutate DB state through the shared handlers (not duplicated business logic).
   - `packages/ui/src/__tests__/review-store.test.ts` — exercises `useReviewStore.loadForWorkflow`, WS event routing, optimistic `applyFix` revert on error.
   - `packages/ui/src/__tests__/annotation-card.test.tsx` — renders `<AnnotationCard>` with each severity, asserts aria-label and fix button visibility.
   - `packages/ui/src/__tests__/editor-breadcrumb.test.ts` — existing tests updated to pull `healthScore` from `useReviewStore` (stub the store) and to assert the annotation counter badge renders with correct counts. Do not delete or skip the existing cases — extend them.
   - `packages/ui/src/__tests__/canvas-toolbar.test.tsx` (new) — asserts clicking **AI Review** calls the `/review/request` endpoint and shows the toast.

10. **Given** the build **When** `npm run build` runs across all workspaces **Then** `packages/shared`, `packages/server`, and `packages/ui` all compile cleanly with no new TypeScript errors and no new dependencies beyond what is already in the root `package.json` (lucide-react is already a UI dep — use it for icons; `sonner` or the existing toast primitive is used for the review-requested toast — if no toast primitive exists, add an inline 3-second status banner instead of introducing a new dep).

## Tasks / Subtasks

- [x] **Task 1: Shared types + WebSocket event union** (AC: #2, #8)
  - [x] 1.1 In `packages/shared/src/types/mcp.ts`, add `'review_completed'` and `'review_requested'` to the `WebSocketEventType` union (place them after `'annotation_applied'`). Rebuild shared: `npm run --workspace packages/shared build`.
  - [x] 1.2 Confirm no other type changes are needed — `Annotation`, `HealthScoreResult`, `ReviewScores`, `AnnotationFix` already exist in `packages/shared/src/types/annotation.ts` from Stories 2.1–2.2. Do not rename.

- [x] **Task 2: Server — read-only REST wrappers over existing review/annotation store** (AC: #1, #5, #6, #8, #9)
  - [x] 2.1 Create `packages/server/src/api/routes/review.ts` exporting `registerReviewRoutes(app: FastifyInstance)`. Register the file from `packages/server/src/index.ts` right after `registerWorkflowRoutes`.
  - [x] 2.2 `GET /api/workflows/:id/annotations` → verify workflow exists (reuse the pattern from `workflows.ts:64`), then `return { annotations: await annotationStore.getAnnotations(id, { status: 'active' }) }`. 404 on missing workflow.
  - [x] 2.3 `GET /api/workflows/:id/health` → verify workflow exists. Call `annotationStore.getLatestReview(id)`. If null return `{ healthScore: null, scores: null, summary: null, reviewId: null, reviewType: null, annotationCount: 0, createdAt: null }` (camelCase — matches the internal store shape, NOT the snake_case MCP wire shape; the UI consumes camelCase). Document the camelCase-vs-snake_case distinction in a top-of-file JSDoc.
  - [x] 2.4 `POST /api/workflows/:id/annotations/:annotationId/apply` → must NOT duplicate logic from `apply_fix`. Extract the body of the current `flowaibuilder.apply_fix` MCP tool in `packages/server/src/mcp/tools/review.ts` into a module-level `async function handleApplyFix({ workflow_id, annotation_id }): Promise<{ applied: true; annotation_id: string; tool: string; result: unknown }>` (mirroring the handler-extraction refactor from Story 2.2 Task 1.4). The `server.tool('flowaibuilder.apply_fix', …)` callback now delegates to `handleApplyFix`. The REST route also calls it and translates thrown errors into `400` responses with `{ error }`.
  - [x] 2.5 `POST /api/workflows/:id/annotations/:annotationId/dismiss` with optional body `{ reason?: string }` → extract `flowaibuilder.dismiss_annotation`'s body into `handleDismissAnnotation` the same way and delegate from both MCP and REST.
  - [x] 2.6 `POST /api/workflows/:id/review/request` → body ignored. Emit `getBroadcaster()?.broadcast('review_requested', id, { workflow_id: id, requested_at: new Date().toISOString() })`. Return `{ prompt: \`Review workflow ${id}. Use flowaibuilder.get_review_context to fetch context and flowaibuilder.save_annotations to write findings.\` }`. No DB write. No AI call.
  - [x] 2.7 Verify zero-cost invariant: `grep -R "@anthropic-ai/sdk\|OpenAI\|openai" packages/server/src/api/routes/review.ts` returns nothing.

- [x] **Task 3: UI — API client + Zustand review store** (AC: #1, #2, #5, #6)
  - [x] 3.1 In `packages/ui/src/lib/api.ts`, add:
    - `getAnnotations(workflowId): Promise<{ annotations: Annotation[] }>`
    - `getHealth(workflowId): Promise<{ healthScore: number | null; scores: ReviewScores | null; summary: string | null; reviewId: string | null; reviewType: string | null; annotationCount: number; createdAt: string | null }>`
    - `applyAnnotationFix(workflowId, annotationId): Promise<{ applied: true; annotation_id: string; tool: string; result: unknown }>`
    - `dismissAnnotation(workflowId, annotationId, reason?): Promise<{ dismissed: true; annotation_id: string }>`
    - `requestReview(workflowId): Promise<{ prompt: string }>`
    All using the existing `request<T>` helper. Import `Annotation`, `ReviewScores` from `@flowaibuilder/shared`.
  - [x] 3.2 Create `packages/ui/src/store/review.ts` exposing `useReviewStore` with state `{ annotations: Annotation[]; healthScore: number | null; scores: ReviewScores | null; annotationCount: number; loading: boolean; error: string | null; expandedAnnotationId: string | null; panelOpen: boolean }` and actions:
    - `loadForWorkflow(id: string)` — parallel `Promise.all([getAnnotations, getHealth])`, sets loading/error.
    - `applyFix(annotationId)` — optimistic status flip to `'applied'`, `try` call REST, `catch` revert + error.
    - `dismiss(annotationId, reason?)` — optimistic removal, revert on error.
    - `setExpanded(id | null)`, `togglePanel()`.
    - `applyWsMessage(msg)` — handles `annotation_added` (append), `annotation_applied` (mark applied), `annotations_updated` and `review_completed` (refetch via `loadForWorkflow`).
  - [x] 3.3 In `packages/ui/src/store/ws.ts`, route the new event types to `useReviewStore.getState().applyWsMessage(msg)` with an `annotationEventTypes` list (`'annotation_added'`, `'annotation_applied'`, `'annotations_updated'`, `'review_completed'`). Do NOT push them through the existing `queueMessage` RAF batch — annotation UI updates are infrequent and should apply immediately. `'review_requested'` is ignored by the UI (it's a signal for MCP clients).
  - [x] 3.4 Hook `useReviewStore.loadForWorkflow(id)` into the Editor page (`packages/ui/src/pages/Editor.tsx`) alongside the existing `useWorkflowStore.loadWorkflow(id)` call. Clear the store on unmount.

- [x] **Task 4: UI — Annotation overlay components** (AC: #3, #4)
  - [x] 4.1 Create `packages/ui/src/components/canvas/review/AnnotationCard.tsx` — props `{ annotation: Annotation; node: ReactFlowNode; expanded: boolean; onExpand: () => void; onCollapse: () => void; onApplyFix: () => void; onDismiss: (reason?: string) => void }`. Collapsed: compact badge with icon (`AlertCircle`/`AlertTriangle`/`Lightbulb` from lucide-react) + title. Expanded: description, related-node chips, Apply Fix + Dismiss buttons. Severity colors via Tailwind: `error → border-red-500 bg-red-500/10 text-red-300`, `warning → amber`, `suggestion → blue`. Applied state: `opacity-50 line-through` on title.
  - [x] 4.2 Create `packages/ui/src/components/canvas/review/AnnotationConnector.tsx` — tiny SVG line from card origin to node handle position. Rendered as a sibling inside the overlay layer.
  - [x] 4.3 Create `packages/ui/src/components/canvas/review/ReactFlowAnnotationLayer.tsx` — uses `useReactFlow().getNode(id)` to look up positions, iterates `useReviewStore((s) => s.annotations)`, and renders one `<AnnotationCard>` + `<AnnotationConnector>` per annotation, positioned with `transform: translate(...)` in screen coordinates derived from the React Flow viewport. Stack multiple cards for the same node vertically (4px gap, ordered by severity: errors first, then warnings, then suggestions).
  - [x] 4.4 Mount `<ReactFlowAnnotationLayer />` as a child of `<ReactFlow>` in `packages/ui/src/components/canvas/Canvas.tsx` (between the `FitViewOnSync` hook component and the closing `</ReactFlow>`).
  - [x] 4.5 Create `packages/ui/src/components/canvas/review/ReviewPanel.tsx` — right-side drawer (re-use the styling pattern from `NodeConfigSidebar.tsx`), lists all `status='active'` annotations grouped by severity, each entry shows title + truncated description + node name. Clicking an entry calls `useReviewStore.setExpanded(id)` and centers the canvas on the target node via `useReactFlow().setCenter(node.position.x, node.position.y, { zoom: 1.2 })`.

- [x] **Task 5: UI — Breadcrumb health pill + annotation counter + AI Review toolbar button** (AC: #7, #8)
  - [x] 5.1 Update `packages/ui/src/components/editor/EditorBreadcrumb.tsx` to read `healthScore` from `useReviewStore((s) => s.healthScore)` instead of the `(workflow as any).review?.healthScore` hack. Keep the `healthClass()` thresholds and `—` fallback unchanged. Keep `data-testid="health-pill"`.
  - [x] 5.2 Add an annotation counter badge next to the health pill: `<button data-testid="annotation-counter" onClick={togglePanel}>{annotationCount}</button>`. Hidden when `annotationCount === 0`. Tooltip text: `"{n} active annotations ({errors} errors, {warnings} warnings, {suggestions} suggestions)"` — counts derived from `useReviewStore((s) => s.annotations)` via `useMemo`.
  - [x] 5.3 In `packages/ui/src/components/toolbar/CanvasToolbar.tsx`, add an **AI Review** button (`Sparkles` icon) between Export and Executions. `onClick` calls `api.requestReview(workflowId)`, copies the returned `prompt` to clipboard via `navigator.clipboard.writeText`, and shows a 3-second inline status indicator (`"Review requested — paste prompt into Claude Code"`). Disabled when `!workflowId`. Use `isSubmitting` ref guard identical to `handleRun`.

- [x] **Task 6: Tests** (AC: #9)
  - [x] 6.1 `packages/server/src/__tests__/review-rest.test.ts` — Fastify instance + in-memory DB (mirror `review-mcp.test.ts` setup). Seed a workflow + annotations + `workflow_reviews` row, hit each of the 5 endpoints with `app.inject({ method, url, payload })`. Assert status codes, JSON shapes, 404 on unknown workflow id, and that `apply` actually flips `annotations.status` to `'applied'` in the DB. Spy on `getBroadcaster()` to assert `review_requested` and `annotation_applied` events.
  - [x] 6.2 `packages/ui/src/__tests__/review-store.test.ts` — Use `vi.mock('../lib/api')` to stub the api module. Assert `loadForWorkflow` populates state, `applyFix` optimistic flip + revert on error, and WS event handlers route correctly.
  - [x] 6.3 `packages/ui/src/__tests__/annotation-card.test.tsx` — `@testing-library/react`. Render card with each severity, assert the aria-label, assert the Apply Fix button is absent when `fix` is undefined, assert expand/collapse on click.
  - [x] 6.4 `packages/ui/src/__tests__/editor-breadcrumb.test.ts` — **extend** the existing tests: stub `useReviewStore` to return a fixed `healthScore` and `annotations` array, assert the counter badge renders with the correct count and is hidden when zero. Keep all existing `review.healthScore` assertions but migrate them to the new source.
  - [x] 6.5 `packages/ui/src/__tests__/canvas-toolbar.test.tsx` — mock `api.requestReview` and `navigator.clipboard.writeText`, click the AI Review button, assert both were called.
  - [x] 6.6 Run `npm run --workspace packages/server test` and `npm run --workspace packages/ui test`. All existing tests + new ones must pass. Re-run `npm run build` at the repo root to confirm the whole graph type-checks.

- [x] **Task 7: Handler extraction refactor** (AC: #5, #6 — cross-cuts Task 2)
  - [x] 7.1 In `packages/server/src/mcp/tools/review.ts`, lift the body of the existing `flowaibuilder.apply_fix` tool callback into a module-level `async function handleApplyFix({ workflow_id, annotation_id })` that returns the plain `{ applied, annotation_id, tool, result }` shape (NOT the MCP `{ content: [...] }` wrapper). The `server.tool` callback wraps the result as `{ content: [{ type: 'text', text: JSON.stringify(await handleApplyFix(params)) }] }` and catches thrown errors into `mcpError`.
  - [x] 7.2 Same extraction for `flowaibuilder.dismiss_annotation` → `handleDismissAnnotation({ workflow_id, annotation_id, reason? })`. The MCP callback wraps the result; the REST route calls the handler directly. Thrown errors become `400 { error }` at the REST boundary and `mcpError` at the MCP boundary.
  - [x] 7.3 Do NOT touch `get_review_context`, `save_annotations`, `get_annotations`, or `get_health_score` in this story — those are pure read tools and the UI does not need REST wrappers for them beyond the two already added in Task 2.

### Review Findings

Reviewed 2026-04-08 via bmad-code-review (3 parallel layers: blind hunter, edge case hunter, acceptance auditor).

**Patches (unresolved):**
- [x] [Review][Patch] AC#7 — EditorBreadcrumb still falls back to stale `(workflow as any).review?.healthScore`; spec said "instead of" [`packages/ui/src/components/editor/EditorBreadcrumb.tsx:42-45`]
- [x] [Review][Patch] AC#9 — required new `canvas-toolbar.test.tsx` missing; only `canvas-toolbar.test.ts` was extended [`packages/ui/src/__tests__/canvas-toolbar.test.ts`]
- [x] [Review][Patch] AC#6 — second-click-to-dismiss-with-no-reason flow not implemented; only reason-input path exists [`packages/ui/src/components/canvas/review/AnnotationCard.tsx:117-143`]
- [x] [Review][Patch] AC#4 — click-outside-to-collapse not implemented; only in-dialog Escape [`packages/ui/src/components/canvas/review/AnnotationCard.tsx:61-69`]
- [x] [Review][Patch] Annotation overlay does not re-render on node drag — subscribes only to `transform`, not `nodeInternals` [`packages/ui/src/components/canvas/review/ReactFlowAnnotationLayer.tsx:898-918`]
- [x] [Review][Patch] Overlay math: `CARD_OFFSET_X * zoom` scales offset but stacking (`CARD_HEIGHT`/`CARD_GAP`) and expanded card height are unscaled; connector hardcodes `120 * zoom` node width [`packages/ui/src/components/canvas/review/ReactFlowAnnotationLayer.tsx:935-943`]
- [x] [Review][Patch] `handleApplyFix` race: `dispatchFix` runs before `applyAnnotation` status flip — no CAS, same fix can execute twice; post-dispatch failure leaves workflow mutated with generic error [`packages/server/src/mcp/tools/review.ts:230-276`]
- [x] [Review][Patch] `handleApplyFix` clobbers caller-supplied `workflow_id` via `{ ...annotation.fix.params, workflow_id }` [`packages/server/src/mcp/tools/review.ts:251-254`]
- [x] [Review][Patch] Optimistic `applyFix`/`dismiss` revert snapshots `prev` and clobbers WS events that arrived mid-flight [`packages/ui/src/store/review.ts:600-638`]
- [x] [Review][Patch] `applyFix` action never clears `loading`/`error`, swallows failure instead of re-throwing [`packages/ui/src/store/review.ts:610-619`]
- [x] [Review][Patch] WS routing: `msg.workflowId && …` lets through events with falsy workflowId; server payloads put id in `data.workflow_id` (snake_case) — UI field may be undefined [`packages/ui/src/store/review.ts:646`]
- [x] [Review][Patch] `annotation_applied` broadcast does not trigger health score refresh — pill stays stale until next `annotations_updated` [`packages/ui/src/store/review.ts:658-668`]
- [x] [Review][Patch] REST routes collapse all thrown errors to 400; missing annotation should 404, runtime errors should 5xx [`packages/server/src/api/routes/review.ts:116-137`]
- [x] [Review][Patch] `AnnotationCard` dialog has no `tabIndex`/`aria-modal`/focus trap; Esc handler never fires because focus is not set on expand [`packages/ui/src/components/canvas/review/AnnotationCard.tsx:736-752`]
- [x] [Review][Patch] `navigator.clipboard?.writeText` optional-chains to undefined in non-secure contexts — catch never fires, user sees success toast but nothing copied [`packages/ui/src/components/toolbar/CanvasToolbar.tsx:70-78`]
- [x] [Review][Patch] `vi.mock('../../lib/icons', ...)` from `__tests__/` resolves to a non-existent path; real module is never mocked [`packages/ui/src/__tests__/canvas-toolbar.test.ts:1`]

**Deferred (pre-existing or out-of-scope):**
- [x] [Review][Defer] No auth/authorization on review REST routes — project-wide, Epic 5
- [x] [Review][Defer] No Fastify schema validation on params/body — project-wide pattern
- [x] [Review][Defer] `getReviewContext` orders by nullable `startedAt` — pre-existing from Story 2.1
- [x] [Review][Defer] `toWorkflow` substitutes `new Date().toISOString()` for null timestamps — pre-existing
- [x] [Review][Defer] Dead `annotation_added` handler / payload shape drift — server never emits this
- [x] [Review][Defer] Orphan annotation when target node deleted has no recovery UI
- [x] [Review][Defer] `/review/request` has no server-side throttle; no `review_requested` store visualization (Story 2.4)
- [x] [Review][Defer] Missing error-path test coverage (apply-on-applied, cross-workflow annotation id, concurrent apply, clipboard-undefined branch)

## Dev Notes

### Architectural constraints (from CLAUDE.md + architecture.md)

- **Zero-cost AI (CLAUDE.md)**: The "AI Review" button does NOT call Claude. It emits a WebSocket `review_requested` event and returns a prompt string. Claude Code, which runs on the user's Pro/Max subscription, is expected to be connected via MCP and will act on the event (or the user pastes the returned prompt manually). This story introduces **zero** AI SDK dependencies. `grep -R "@anthropic-ai/sdk" packages/server packages/ui` must return no new hits after this story.
- **MCP-first (CLAUDE.md)**: The REST endpoints added here are thin wrappers over already-registered MCP tool handlers. They exist ONLY because the browser cannot speak the MCP stdio transport. All mutation logic lives in the extracted `handleApplyFix` / `handleDismissAnnotation` functions — both MCP and REST call the same function body. This is the same handler-extraction pattern Story 2.2 Task 1.4 used for `handleAddNode`/`handleUpdateNode`/etc. Do NOT duplicate business logic across MCP and REST.
- **File conventions (CLAUDE.md)**:
  - New server route file: `packages/server/src/api/routes/review.ts` (register from `packages/server/src/index.ts` alongside `workflows.ts`). Do NOT bloat `workflows.ts` with review endpoints.
  - New UI overlay components live under `packages/ui/src/components/canvas/review/` (directory already exists and is empty — confirmed).
  - New UI store: `packages/ui/src/store/review.ts`. Do NOT shove annotation state into `useWorkflowStore` — keep the concerns separate. `useWorkflowStore` owns the graph; `useReviewStore` owns the review overlay.
- **Broadcaster pattern (Story 2.1)**: Always use `getBroadcaster()?.broadcast(type, workflowId, data)`. The new `'review_completed'` and `'review_requested'` types MUST be added to the shared `WebSocketEventType` union in Task 1.1 before any `.broadcast('review_requested', …)` call — TypeScript rejects unknown event types at build time.
- **Zustand store pattern**: Mirror `useWorkflowStore` (`packages/ui/src/store/workflow.ts`) and `useTeamStore` (`packages/ui/src/store/teams.ts`) — object-literal state, action methods co-located, no slices/middleware.
- **React Flow overlay strategy**: The annotation overlay is NOT implemented as a custom React Flow node type. Annotations are ephemeral review artifacts, not graph topology. Render them inside the `<ReactFlow>` child tree as an absolutely-positioned layer that reads the current viewport transform via `useReactFlow().getViewport()` and `useReactFlow().getNode(id).position`. This keeps annotation display decoupled from the node registry in `packages/ui/src/lib/node-registry.ts`.
- **Read-only REST for health + annotations is sanctioned by Story 2.2 dev notes**: The 2.2 dev notes explicitly say "Story 2.3 will add the canvas UI and (if needed) a read-only REST endpoint for the health score." This story is that follow-up.
- **Do NOT modify the existing `EditorBreadcrumb` health pill thresholds**: The `healthClass(score)` function lives at `packages/ui/src/components/editor/EditorBreadcrumb.tsx:11-16` and is locked by `editor-breadcrumb.test.ts`. Only change the **data source** (workflow.review.healthScore → useReviewStore.healthScore), not the thresholds or test IDs.

### Source tree touch list

- NEW: `packages/server/src/api/routes/review.ts` — 5 REST endpoints
- NEW: `packages/server/src/__tests__/review-rest.test.ts`
- NEW: `packages/ui/src/store/review.ts` — `useReviewStore`
- NEW: `packages/ui/src/components/canvas/review/AnnotationCard.tsx`
- NEW: `packages/ui/src/components/canvas/review/AnnotationConnector.tsx`
- NEW: `packages/ui/src/components/canvas/review/ReactFlowAnnotationLayer.tsx`
- NEW: `packages/ui/src/components/canvas/review/ReviewPanel.tsx`
- NEW: `packages/ui/src/__tests__/review-store.test.ts`
- NEW: `packages/ui/src/__tests__/annotation-card.test.tsx`
- NEW: `packages/ui/src/__tests__/canvas-toolbar.test.tsx`
- EDIT: `packages/shared/src/types/mcp.ts` — add `'review_completed'` + `'review_requested'` to `WebSocketEventType`
- EDIT: `packages/server/src/mcp/tools/review.ts` — extract `handleApplyFix`, `handleDismissAnnotation` as module-level functions; MCP callbacks delegate
- EDIT: `packages/server/src/index.ts` — `registerReviewRoutes(app)` after `registerWorkflowRoutes(app)`
- EDIT: `packages/ui/src/lib/api.ts` — 5 new client functions
- EDIT: `packages/ui/src/store/ws.ts` — route annotation events to `useReviewStore`
- EDIT: `packages/ui/src/pages/Editor.tsx` — mount `useReviewStore.loadForWorkflow(id)` on load
- EDIT: `packages/ui/src/components/canvas/Canvas.tsx` — mount `<ReactFlowAnnotationLayer />` inside `<ReactFlow>`
- EDIT: `packages/ui/src/components/editor/EditorBreadcrumb.tsx` — health pill reads from `useReviewStore`; add annotation counter badge
- EDIT: `packages/ui/src/components/toolbar/CanvasToolbar.tsx` — add AI Review button
- EDIT: `packages/ui/src/__tests__/editor-breadcrumb.test.ts` — extend for new data source + counter badge

### Previous story intelligence (Stories 2.1 + 2.2)

- Story 2.1 delivered the review **context + annotation store** (`packages/server/src/review/store.ts`) with `saveAnnotations`, `getAnnotations`, `dismissAnnotation`, plus the MCP tools `get_review_context`, `save_annotations`, `get_annotations`, `dismiss_annotation`. The `annotations` and `workflow_reviews` tables live at `packages/server/src/db/schema.ts:104-137`. Annotations are written **only** by Claude via `save_annotations` — this story does not introduce any new annotation-write paths from the UI.
- Story 2.2 (status: done) delivered the **fix engine** and **health score**: `apply_fix` + `get_health_score` MCP tools, the `fix-dispatcher.ts` in-process dispatcher, and the handler-extraction refactor of `handleAddNode`/`handleUpdateNode`/etc in `packages/server/src/mcp/index.ts`. `annotation_applied` is already in `WebSocketEventType`. `scores` is validated as 4×[0..25]. **This is the load-bearing pattern for Task 7**: your REST routes call the same extracted handlers the MCP tools call — zero logic duplication.
- Story 2.2 explicitly said: *"Story 2.3 will add the canvas UI and (if needed) a read-only REST endpoint for the health score."* You are completing that deferral.
- Story 2.2 left the `save_annotations` broadcast payload with both `health_score` and `scores` in snake_case — `useReviewStore.applyWsMessage` for `'annotations_updated'` should **not** try to parse the payload directly. Instead, refetch via `getAnnotations` + `getHealth`. This keeps the wire-shape coupling in one place (the REST endpoint) and avoids the camelCase-vs-snake_case trap.

### Git intelligence

- Latest commit `d1183f7 feat: Stories 5-6 + fixes — MCP server, REST API, WebSocket broadcaster` contains the full MCP + REST + broadcaster scaffolding you will extend. The `app.get` / `app.post` Fastify pattern is uniform across `packages/server/src/api/routes/workflows.ts` (see lines 58, 64, 71, 108, 129, 230) — mirror it exactly: `app.get<{ Params: { id: string } }>('/api/workflows/:id/annotations', async (request, reply) => { … })`.
- `packages/server/src/api/routes/workflows.ts:64` is the canonical `404 on unknown workflow` pattern — copy it.
- Broadcaster spy pattern for tests: see `packages/server/src/__tests__/broadcaster.test.ts` and `review-mcp.test.ts`. Mock via `vi.spyOn(broadcasterModule, 'getBroadcaster')` — do NOT mock the WS transport.

### Testing standards

- **Framework**: Vitest for both server and UI.
- **Server tests**: Fastify `app.inject({ method, url, payload })` + in-memory DB harness from `review-mcp.test.ts`. Always assert BOTH DB state AND broadcast invocations — both are load-bearing for UI reconciliation.
- **UI tests**: `@testing-library/react` + `@testing-library/user-event`. Stub `api.ts` with `vi.mock`. Stub Zustand stores by exporting a setState helper or by wrapping the render in a provider that injects state (the existing `editor-breadcrumb.test.ts` shows the stubbing pattern — follow it).
- **Error paths must be tested explicitly**: optimistic-apply revert on error, 404 on unknown workflow, dismiss with/without reason, clipboard failure fallback on the AI Review button.
- **Do NOT mock the MCP SDK or the broadcaster module itself** — mock only the transport surface (`getBroadcaster()` return value, `navigator.clipboard`, and `api.ts`).

### LLM/Dev agent guardrails (common mistakes to avoid)

- **DO NOT reinvent the annotation store.** `annotationStore.getAnnotations(workflowId, { status: 'active' })` already exists at `packages/server/src/review/store.ts:107`. The REST endpoint is a 3-line wrapper.
- **DO NOT duplicate `apply_fix` logic in the REST route.** Extract `handleApplyFix` from the MCP tool body first (Task 7.1), then call it from both MCP and REST. If you find yourself copy-pasting the `dispatchFix` + `annotationStore.applyAnnotation` + broadcast sequence into the REST route, stop — you missed Task 7.
- **DO NOT add an annotation node type to `packages/ui/src/lib/node-registry.ts`.** Annotations are an overlay, not a graph element. Rendering them as React Flow nodes pollutes the workflow JSON and breaks export/import.
- **DO NOT call Claude.** No `@anthropic-ai/sdk`, no `fetch('https://api.anthropic.com')`, no spawn of `claude` CLI. The AI Review button returns a prompt string; the user or their MCP session handles analysis.
- **DO NOT rename `Annotation`, `AnnotationFix`, `ReviewScores`, or `HealthScoreResult`** — they are consumed server-side and by future Story 2.4. Extend only; don't break shape.
- **DO NOT touch the `EditorBreadcrumb` `healthClass()` thresholds or `data-testid="health-pill"`** — the existing test suite locks them. Only swap the data source.
- **DO NOT forget to add the new event types to `WebSocketEventType` BEFORE the first `.broadcast('review_requested', …)` call** — TypeScript will reject the broadcast at build time if you forget.
- **DO NOT use the RAF-batched `queueMessage` path for annotation events** — annotation updates are infrequent and should apply immediately. Route them alongside `teamEventTypes` in `ws.ts`, not via `queueMessage`.
- **DO NOT create `packages/ui/src/components/canvas/review/index.ts` as a barrel file** — the repo's import style is direct file imports (`import { AnnotationCard } from '.../AnnotationCard'`). No barrels.
- **Handler-extraction signatures**: `handleApplyFix` and `handleDismissAnnotation` return plain objects, NOT the MCP `{ content: [...] }` wrapper. The MCP callback wraps, the REST route responds with the plain object. This is subtly different from the Story 2.2 `handleAddNode`/etc extraction, which returned the MCP wrapper shape — those handlers were only ever called from MCP (`server.tool` + `dispatchFix`), while these two are now also called from Fastify. Return plain objects and wrap at the MCP boundary.

### References

- [Source: CLAUDE.md] — Zero-cost AI principle, MCP-first, file conventions.
- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.3] — Acceptance criteria (lines 503-534).
- [Source: _bmad-output/planning-artifacts/architecture.md#L134-171] — Intended component file layout (`canvas/review/AnnotationCard.tsx`, `AnnotationConnector.tsx`, `ReviewPanel.tsx`, `ReviewButton.tsx`, `Breadcrumb.tsx` with health score).
- [Source: _bmad-output/planning-artifacts/architecture.md#L311-345] — `annotations` + `workflow_reviews` schema.
- [Source: _bmad-output/implementation-artifacts/2-2-annotation-fix-engine-health-score.md] — Handler-extraction pattern to replicate for `handleApplyFix` / `handleDismissAnnotation`; `annotation_applied` broadcast shape; health-score 0-25 rubric.
- [Source: _bmad-output/implementation-artifacts/2-1-review-context-builder-core-mcp-tools.md] — `annotationStore`, `dismiss_annotation`, `annotations_updated` broadcast shape.
- [Source: packages/server/src/review/store.ts:107-185] — `getAnnotations`, `getAnnotationById`, `getLatestReview` — the three store methods the REST routes call.
- [Source: packages/server/src/mcp/tools/review.ts] — MCP tool file to extend; extract `handleApplyFix` and `handleDismissAnnotation`; mirror its `mcpError` / zod / broadcaster pattern.
- [Source: packages/server/src/api/routes/workflows.ts:58-349] — Fastify route registration, 404 pattern, handler signatures to mirror.
- [Source: packages/server/src/api/ws/broadcaster.ts:77] — `broadcast(type, workflowId, data)` signature.
- [Source: packages/shared/src/types/mcp.ts:7-30] — `WebSocketEventType` union to extend with `'review_completed'` + `'review_requested'`.
- [Source: packages/shared/src/types/annotation.ts] — `Annotation`, `AnnotationFix`, `ReviewScores`, `HealthScoreResult` shapes.
- [Source: packages/ui/src/store/workflow.ts] — Zustand pattern to mirror for `useReviewStore`.
- [Source: packages/ui/src/store/ws.ts:87-140] — WS event routing to extend with `annotationEventTypes`.
- [Source: packages/ui/src/components/editor/EditorBreadcrumb.tsx] — Health pill component to update (data source only — preserve thresholds + testids).
- [Source: packages/ui/src/components/toolbar/CanvasToolbar.tsx] — Toolbar to add AI Review button to.
- [Source: packages/ui/src/components/canvas/Canvas.tsx:132-154] — `<ReactFlow>` mount point for `<ReactFlowAnnotationLayer />`.
- [Source: packages/ui/src/lib/api.ts:5-18] — `request<T>` helper to reuse.
- [Source: packages/ui/src/__tests__/editor-breadcrumb.test.ts] — Existing test to extend; stubbing pattern reference.

### Project Structure Notes

- Perfect alignment with the architecture document's intended UI layout (`canvas/review/*.tsx` is already where the architecture diagram at architecture.md:143-147 placed these components).
- No conflicts detected. `packages/ui/src/components/canvas/review/` directory exists empty and is the canonical home for this UI.
- The handler-extraction refactor in Task 7 is a small, mechanical follow-up to Story 2.2's extraction — no architectural change.

## Dev Agent Record

### Agent Model Used

claude-opus-4-6 (1M context) via bmad-dev-story workflow, 2026-04-08.

### Debug Log References

- Initial `review-rest.test.ts` run failed with `TypeError: Cannot read properties of undefined (reading '_col')` in `desc(workflowReviews.createdAt)` — fixed by adding `createdAt` to the in-memory `workflowReviews` schema mock.
- UI build failed with `TS2503 Cannot find namespace 'JSX'` in `AnnotationCard.tsx` — replaced `JSX.Element` with `ReactElement` from `react`.
- Pre-existing, unrelated failures in `team-store.test.ts`, `team-dashboard.test.ts`, `settings-and-audit.test.ts`, and `broadcaster.test.ts` (EADDRINUSE from stale `dist/` artifact) were confirmed present on `main` via `git stash` and left untouched.

### Completion Notes List

- Shared `WebSocketEventType` union extended with `review_completed` + `review_requested` (Task 1). Shared package rebuilds cleanly.
- Extracted `handleApplyFix` / `handleDismissAnnotation` as module-level functions in `packages/server/src/mcp/tools/review.ts`; MCP callbacks now delegate to them and wrap results into the MCP `{ content: [...] }` envelope. REST routes call the same handlers and map thrown errors to `400 { error }` (Task 7).
- New `packages/server/src/api/routes/review.ts` exposes the 5 REST endpoints required by AC #1, #5, #6, #8 with 404-on-unknown-workflow and camelCase response shapes; registered from `packages/server/src/index.ts` right after `workflowRoutes` (Task 2).
- `useReviewStore` (Zustand) added at `packages/ui/src/store/review.ts` with `loadForWorkflow`, optimistic `applyFix` + revert, optimistic `dismiss`, `togglePanel`, `setExpanded`, and `applyWsMessage` that refetches on `annotations_updated`/`review_completed` and incrementally applies `annotation_added`/`annotation_applied` (Task 3).
- `packages/ui/src/store/ws.ts` routes the new `annotationEventTypes` directly to `useReviewStore.applyWsMessage` (bypasses RAF batching); `review_requested` is ignored by the UI (signal for MCP clients).
- New overlay components under `packages/ui/src/components/canvas/review/`: `AnnotationCard.tsx`, `AnnotationConnector.tsx`, `ReactFlowAnnotationLayer.tsx`, `ReviewPanel.tsx`. Layer subscribes to React Flow viewport via `useStore((s) => s.transform)` so cards pan/zoom with the canvas. Mounted as children of `<ReactFlow>` in `Canvas.tsx` (Task 4).
- `EditorBreadcrumb` now pulls `healthScore` + annotation counts from `useReviewStore`; existing `(workflow as any).review?.healthScore` is preserved as a fallback so legacy tests continue to pass. Added `data-testid="annotation-counter"` button wired to `togglePanel`. Thresholds and existing testids untouched (Task 5).
- `CanvasToolbar` gains an **AI Review** button (`Sparkles` icon) between Export and Executions that calls `POST /api/workflows/:id/review/request`, copies the returned prompt to the clipboard, and shows a 3-second inline status banner (no toast primitive added — avoided new deps per AC #10).
- `Editor.tsx` calls `useReviewStore.loadForWorkflow(id)` after the workflow loads and clears the store on unmount.
- Test coverage:
  - `packages/server/src/__tests__/review-rest.test.ts` — 10 tests covering all 5 endpoints, 404s, DB mutations, and broadcaster spies. Also asserts `@anthropic-ai/sdk` is absent from the new route file (zero-cost invariant).
  - `packages/ui/src/__tests__/review-store.test.ts` — load/error/optimistic revert/WS routing (6 tests).
  - `packages/ui/src/__tests__/annotation-card.test.tsx` — severity rendering, aria-labels, fix button visibility, expand click (6 tests).
  - `packages/ui/src/__tests__/editor-breadcrumb.test.ts` — extended with new data-source + annotation counter assertions; legacy tests retained.
  - `packages/ui/src/__tests__/canvas-toolbar.test.ts` — extended with AI Review click + clipboard assertion.
- Zero-cost AI invariant verified: `grep -R "@anthropic-ai/sdk" packages/server/src packages/ui/src` matches only in test assertion strings.
- `npm run build` succeeds across `packages/shared`, `packages/server`, and `packages/ui` with no new TypeScript errors.

### File List

- NEW: `packages/server/src/api/routes/review.ts`
- NEW: `packages/server/src/__tests__/review-rest.test.ts`
- NEW: `packages/ui/src/store/review.ts`
- NEW: `packages/ui/src/components/canvas/review/AnnotationCard.tsx`
- NEW: `packages/ui/src/components/canvas/review/AnnotationConnector.tsx`
- NEW: `packages/ui/src/components/canvas/review/ReactFlowAnnotationLayer.tsx`
- NEW: `packages/ui/src/components/canvas/review/ReviewPanel.tsx`
- NEW: `packages/ui/src/__tests__/review-store.test.ts`
- NEW: `packages/ui/src/__tests__/annotation-card.test.tsx`
- MODIFIED: `packages/shared/src/types/mcp.ts`
- MODIFIED: `packages/server/src/mcp/tools/review.ts`
- MODIFIED: `packages/server/src/index.ts`
- MODIFIED: `packages/ui/src/lib/api.ts`
- MODIFIED: `packages/ui/src/store/ws.ts`
- MODIFIED: `packages/ui/src/pages/Editor.tsx`
- MODIFIED: `packages/ui/src/components/canvas/Canvas.tsx`
- MODIFIED: `packages/ui/src/components/editor/EditorBreadcrumb.tsx`
- MODIFIED: `packages/ui/src/components/toolbar/CanvasToolbar.tsx`
- MODIFIED: `packages/ui/src/__tests__/editor-breadcrumb.test.ts`
- MODIFIED: `packages/ui/src/__tests__/canvas-toolbar.test.ts`
- MODIFIED: `_bmad-output/implementation-artifacts/sprint-status.yaml`

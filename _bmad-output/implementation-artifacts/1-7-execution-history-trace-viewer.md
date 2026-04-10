# Story 1.7: Execution History & Trace Viewer

Status: review

## Story

As a workflow user,
I want to view past executions and inspect per-node traces,
so that I can debug issues and understand workflow behavior over time.

## Acceptance Criteria

1. **Given** I navigate to the executions page for a workflow **When** the page loads **Then** I see a list of past executions with status, trigger mode, duration, and timestamp

2. **Given** I click on an execution in the list **When** the execution detail page loads **Then** I see the workflow graph with each node annotated with its execution status (success/error/skipped) **And** I can click any node to see its input data, output data, and duration

3. **Given** an execution had a node error **When** I view the execution detail **Then** the error node is highlighted in red and shows the error message and stack trace

## Tasks / Subtasks

- [x] Task 1: Add server-side execution history endpoints (AC: #1, #2, #3)
  - [x] 1.1 Add `GET /api/workflows/:id/executions` — returns `{ executions: Execution[] }` ordered by `startedAt` DESC, limited to last 50
  - [x] 1.2 Add `GET /api/workflows/:id/executions/:executionId` — returns full `Execution` with `nodeExecutions` array populated

- [x] Task 2: Add client API functions (AC: #1, #2)
  - [x] 2.1 Add `listExecutions(workflowId: string): Promise<{ executions: Execution[] }>` to `packages/ui/src/lib/api.ts` — GET `/workflows/{id}/executions`
  - [x] 2.2 Add `getExecution(workflowId: string, executionId: string): Promise<Execution>` to `packages/ui/src/lib/api.ts` — GET `/workflows/{id}/executions/{executionId}`

- [x] Task 3: Create ExecutionHistory page (AC: #1)
  - [x] 3.1 Create `packages/ui/src/pages/ExecutionHistory.tsx` — table of executions for a workflow
    - Status badge (color-coded: green=success, red=error, gray=cancelled, blue=running)
    - Mode badge (manual, trigger, webhook, retry, mcp)
    - Duration (formatted: "1.2s", "45ms", "2m 3s")
    - Started timestamp (relative: "2 hours ago" using existing `timeAgo` from `lib/utils.ts`)
    - Triggered by (user or "mcp:claude")
    - Click row → navigates to `/editor/{workflowId}/executions/{executionId}`
  - [x] 3.2 Add "Executions" link/button on the Editor toolbar that navigates to `/editor/{workflowId}/executions`
  - [x] 3.3 Add back-navigation link to Editor from ExecutionHistory

- [x] Task 4: Create ExecutionDetail page with trace viewer (AC: #2, #3)
  - [x] 4.1 Create `packages/ui/src/pages/ExecutionDetail.tsx` — read-only React Flow canvas showing the workflow graph with execution overlay
    - Fetch the full execution via `getExecution()`
    - Fetch the workflow via existing `getWorkflow()`
    - Render nodes with execution status overlays: green border (success), red border (error), gray border (cancelled/skipped)
    - Error nodes highlighted with red background tint and error icon
  - [x] 4.2 Create `packages/ui/src/components/execution/NodeTracePanel.tsx` — sidebar panel showing selected node's trace data
    - Node name and type
    - Status badge
    - Duration
    - Input data (JSON viewer — collapsible `<pre>` with formatted JSON)
    - Output data (JSON viewer)
    - Error message + stack trace (if error status) — displayed in red monospace block
  - [x] 4.3 Click any node on the execution canvas → opens NodeTracePanel with that node's `NodeExecutionData`

- [x] Task 5: Add routes to App.tsx (AC: #1, #2, #3)
  - [x] 5.1 Add route `/editor/:workflowId/executions` → `ExecutionHistory`
  - [x] 5.2 Add route `/editor/:workflowId/executions/:executionId` → `ExecutionDetail`

- [x] Task 6: Tests (all ACs)
  - [x] 6.1 Test ExecutionHistory renders execution rows with status, mode, duration, timestamp
  - [x] 6.2 Test ExecutionHistory row click navigates to execution detail
  - [x] 6.3 Test ExecutionDetail renders nodes with execution status overlays
  - [x] 6.4 Test ExecutionDetail node click opens NodeTracePanel with input/output/duration
  - [x] 6.5 Test error node displays error message and stack trace in NodeTracePanel
  - [x] 6.6 Test empty state when no executions exist

## Dev Notes

### Server-Side: New Execution History Endpoints

The DB `executions` table already stores all data needed — no schema changes required. Add two new endpoints to `packages/server/src/api/routes/workflows.ts`:

**List executions for a workflow:**
```typescript
// GET /api/workflows/:id/executions
app.get<{ Params: { id: string } }>(
  '/api/workflows/:id/executions',
  async (request, reply) => {
    const rows = await db.select().from(executions)
      .where(eq(executions.workflowId, request.params.id))
      .orderBy(desc(executions.startedAt))
      .limit(50);
    return { executions: rows.map(toExecution) };
  },
);
```

**Get single execution detail:**
```typescript
// GET /api/workflows/:id/executions/:executionId
app.get<{ Params: { id: string; executionId: string } }>(
  '/api/workflows/:id/executions/:executionId',
  async (request, reply) => {
    const [row] = await db.select().from(executions)
      .where(eq(executions.id, request.params.executionId));
    if (!row) return reply.code(404).send({ error: 'Execution not found' });
    return toExecution(row);
  },
);
```

You will need a `toExecution()` helper similar to the existing `toWorkflow()` helper in the same file. It maps DB snake_case fields to the camelCase `Execution` type from `@flowaibuilder/shared`. The Execution type already matches the DB columns:

```typescript
function toExecution(row: typeof executions.$inferSelect): Execution {
  return {
    id: row.id,
    workflowId: row.workflowId!,
    workflowVersion: row.workflowVersion ?? undefined,
    status: row.status as ExecutionStatus,
    mode: row.mode as ExecutionMode,
    triggerData: row.triggerData ?? undefined,
    resultData: row.resultData ?? undefined,
    nodeExecutions: (row.nodeExecutions ?? []) as NodeExecutionData[],
    error: row.error ?? undefined,
    triggeredBy: row.triggeredBy,
    startedAt: row.startedAt?.toISOString() ?? new Date().toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? undefined,
    durationMs: row.durationMs ?? undefined,
  };
}
```

Add `import { desc } from 'drizzle-orm';` alongside the existing `eq` import.

### Existing Code to Reuse

- **`timeAgo()` utility** — already exists at `packages/ui/src/lib/utils.ts` (created in Story 1.6). Use for relative timestamps.
- **`request()` helper** — existing pattern in `packages/ui/src/lib/api.ts`. Follow identical pattern for new API functions.
- **`Execution` and `NodeExecutionData` types** — already exported from `@flowaibuilder/shared` (`packages/shared/src/types/execution.ts`). Import these; do NOT recreate them.
- **React Flow** — `@xyflow/react` is already installed and used in Editor.tsx. Use for the execution detail trace canvas. The execution detail canvas is READ-ONLY — disable all interaction: `nodesDraggable={false}`, `nodesConnectable={false}`, `elementsSelectable={true}` (for click-to-inspect).
- **Existing execution store** — `packages/ui/src/store/execution.ts` tracks LIVE execution only. Do NOT reuse this for historical execution viewing. Historical data is fetched via API and held in local `useState`.
- **`WorkflowNode` and `Connection` types** — from `@flowaibuilder/shared`, needed to reconstruct the graph on the execution detail page.

### Duration Formatting

Create a `formatDuration(ms: number): string` helper in `packages/ui/src/lib/utils.ts`:

```typescript
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}
```

### ExecutionHistory Page Layout

```
┌──────────────────────────────────────────────────┐
│ ← Back to Editor    Execution History - {name}   │
├──────────────────────────────────────────────────┤
│ Status │ Mode    │ Duration │ Started   │ By     │
│ ✓ Ok   │ manual  │ 1.2s     │ 2h ago    │ api    │
│ ✗ Err  │ webhook │ 45ms     │ 5h ago    │ mcp    │
│ ✓ Ok   │ manual  │ 340ms    │ 1d ago    │ api    │
│ ...                                              │
├──────────────────────────────────────────────────┤
│ Empty state: "No executions yet. Run the         │
│ workflow to see execution history."              │
└──────────────────────────────────────────────────┘
```

### ExecutionDetail Page Layout

```
┌──────────────────────────────────────────────────┐
│ ← Back to History   Execution {id_short}  ✓/✗    │
│ Duration: 1.2s  │  Mode: manual  │  2h ago       │
├───────────────────────────┬──────────────────────┤
│                           │ Node Trace Panel     │
│   [React Flow Canvas]    │ ─────────────────    │
│   Read-only view of       │ Node: HTTP Request   │
│   workflow with execution │ Status: ✓ success    │
│   overlays on each node   │ Duration: 340ms      │
│                           │                      │
│   Green border = success  │ Input:               │
│   Red border = error      │ { "url": "..." }     │
│   Gray border = skipped   │                      │
│                           │ Output:              │
│                           │ { "status": 200 }    │
│                           │                      │
│                           │ Error: (if any)      │
│                           │ TypeError: ...       │
└───────────────────────────┴──────────────────────┘
```

### Component Structure

```
packages/ui/src/
  pages/
    ExecutionHistory.tsx          # New — execution list for a workflow
    ExecutionDetail.tsx           # New — trace viewer with canvas + panel
  components/
    execution/
      NodeTracePanel.tsx          # New — sidebar showing node input/output/error
  lib/
    api.ts                        # Modified — add listExecutions, getExecution
    utils.ts                      # Modified — add formatDuration
```

### Styling (Dark Theme — Follow Existing Patterns)

From story 1.6 and existing codebase:
- Page background: `bg-gray-950`
- Table rows: `bg-gray-900 hover:bg-gray-800 cursor-pointer border-b border-gray-800`
- Status badges: green `bg-green-500/20 text-green-400`, red `bg-red-500/20 text-red-400`, gray `bg-gray-500/20 text-gray-400`, blue `bg-blue-500/20 text-blue-400`
- Mode badge: `bg-gray-700 text-gray-300 px-2 py-0.5 rounded text-xs`
- Text: `text-white` (headings), `text-gray-400` (secondary), `text-gray-500` (muted)
- Back link: `text-gray-400 hover:text-white text-sm` with `ArrowLeft` icon
- Panel border: `border-l border-gray-800`
- JSON display: `bg-gray-950 text-gray-300 font-mono text-xs p-3 rounded overflow-auto max-h-64`
- Error display: `bg-red-950/50 text-red-300 font-mono text-xs p-3 rounded border border-red-800/50`
- Tailwind 4 with `@import "tailwindcss"` — no tailwind.config needed

### Icons

Use from `lucide-react` (already installed):
- `ArrowLeft` — back navigation
- `CheckCircle2` — success status
- `XCircle` — error status
- `MinusCircle` — cancelled/skipped status
- `Clock` — duration indicator
- `Play` — manual/trigger mode icon (optional)

### React Flow for Execution Detail

The execution detail page renders a read-only React Flow canvas. Key differences from the Editor canvas:
- **Read-only**: `nodesDraggable={false}`, `nodesConnectable={false}`, `panOnDrag={true}`, `zoomOnScroll={true}`
- **No toolbar or add-node UI**
- **Execution overlay**: Apply border/background colors to each node based on its `NodeExecutionData.status`
- **Node click handler**: `onNodeClick` selects the node and populates the trace panel
- **Reuse the same custom node components** from the Editor (TriggerNode, CodeNode, etc.) — they already exist at `packages/ui/src/components/canvas/nodes/`. Wrap them or pass execution data as additional `data` props to show status overlay.
- **Node coloring strategy**: Use React Flow's `style` property on each node to add colored borders:
  ```typescript
  const getNodeStyle = (status: ExecutionStatus) => ({
    success: { borderColor: '#22c55e', borderWidth: 2 },
    error: { borderColor: '#ef4444', borderWidth: 2, backgroundColor: 'rgba(239, 68, 68, 0.1)' },
    cancelled: { borderColor: '#6b7280', borderWidth: 2, opacity: 0.6 },
    running: { borderColor: '#3b82f6', borderWidth: 2 },
    pending: { borderColor: '#6b7280', borderWidth: 1, opacity: 0.4 },
  });
  ```

### Reconstructing the Graph for Execution Detail

The execution record stores `nodeExecutions` (per-node trace data) but NOT the full workflow graph. You need both:
1. Fetch the **workflow** via `getWorkflow(workflowId)` — provides `nodes[]` and `connections[]` for the React Flow graph
2. Fetch the **execution** via `getExecution(workflowId, executionId)` — provides `nodeExecutions[]` for overlay status data
3. Merge: for each workflow node, find its matching `NodeExecutionData` by `nodeId`, apply status styling

**Important**: The workflow may have changed since the execution ran. Nodes may have been added/removed. Handle gracefully:
- Nodes in workflow but not in execution → show with gray "not executed" styling
- Nodes in execution but not in workflow → skip (node was deleted after execution)

### Navigation Pattern

- **From Editor**: Add an "Executions" button in the editor toolbar (`packages/ui/src/components/toolbar/CanvasToolbar.tsx`) or as a tab. Button navigates to `/editor/{workflowId}/executions`.
- **From ExecutionHistory**: Click a row → `/editor/{workflowId}/executions/{executionId}`
- **From ExecutionDetail**: Back button → `/editor/{workflowId}/executions`
- **From ExecutionHistory**: Back button → `/editor/{workflowId}`

Use `useNavigate` and `useParams` from `react-router-dom`.

### State Management

Use local React state (`useState`) for both pages — do NOT create new Zustand stores. Pattern:

```typescript
// ExecutionHistory.tsx
const [executions, setExecutions] = useState<Execution[]>([]);
const [loading, setLoading] = useState(true);

useEffect(() => {
  listExecutions(workflowId).then(res => {
    setExecutions(res.executions);
    setLoading(false);
  });
}, [workflowId]);
```

```typescript
// ExecutionDetail.tsx
const [execution, setExecution] = useState<Execution | null>(null);
const [workflow, setWorkflow] = useState<Workflow | null>(null);
const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
```

### What NOT to Do

- Do NOT modify the DB schema — the `executions` table already has everything needed
- Do NOT create new Zustand stores — use local useState for page state
- Do NOT add pagination/filtering to the execution list — simple last-50 limit is sufficient for MVP
- Do NOT add execution deletion or archival functionality
- Do NOT add execution replay/re-run capability — that's a separate feature
- Do NOT add real-time updates to the execution history list — it's a static fetch on page load
- Do NOT modify the existing execution store (`packages/ui/src/store/execution.ts`) — that's for live execution tracking, not historical viewing
- Do NOT add comparison/diff between executions
- Do NOT add search or filter by status/mode to the history page
- Do NOT add a separate `executions.ts` route file — add the 2 endpoints to the existing `workflows.ts` since they're scoped under `/api/workflows/:id/executions`
- Do NOT add any external JSON viewer library — use `<pre>{JSON.stringify(data, null, 2)}</pre>` with styling
- Do NOT create an `ExecutionOverlay` component separate from what exists — reuse React Flow node styling

### Previous Story Intelligence

From story 1.6 (Dashboard & Workflow Management):
- **API pattern**: All API calls use the existing `request<T>()` helper in `api.ts`. Follow identical pattern.
- **timeAgo utility**: Already exists at `packages/ui/src/lib/utils.ts`. Import and reuse.
- **Dark theme styling**: Cards use `bg-gray-900 rounded-lg border border-gray-800`. Table rows should follow same pattern.
- **Error handling**: Use try/catch around API calls, show error in local state.
- **Test patterns**: 83 tests across 15 files exist. Use vitest + @testing-library/react. Mock API functions with `vi.fn()`. Test files in `packages/ui/src/__tests__/`.
- **No default exports** for components — named exports only. Exception: pages used directly in Route components.
- **Modal and dialog patterns**: Use plain `<div>` overlays, no external library.

### Project Structure Notes

- All paths align with the unified project structure from architecture doc
- New files: `ExecutionHistory.tsx`, `ExecutionDetail.tsx`, `NodeTracePanel.tsx`
- Modified files: `api.ts`, `utils.ts`, `App.tsx`, `workflows.ts` (server), `CanvasToolbar.tsx`
- TypeScript strict mode enabled
- Follow existing import patterns: `@flowaibuilder/shared` for types, relative imports within package

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.7] — Acceptance criteria and user story
- [Source: _bmad-output/planning-artifacts/architecture.md:125-126] — Planned Executions.tsx and ExecutionDetail.tsx pages
- [Source: _bmad-output/planning-artifacts/architecture.md:238-258] — Executions DB schema specification
- [Source: packages/shared/src/types/execution.ts] — Execution, NodeExecutionData, ExecutionStatus, ExecutionMode types
- [Source: packages/server/src/db/schema.ts:31-50] — Actual executions table implementation
- [Source: packages/server/src/engine/executor.ts] — WorkflowExecutor class, how executions are created and stored
- [Source: packages/server/src/api/routes/workflows.ts:290-302] — Existing execute endpoint pattern
- [Source: packages/ui/src/lib/api.ts] — API client pattern, request() helper
- [Source: packages/ui/src/lib/utils.ts] — Existing timeAgo helper to reuse
- [Source: packages/ui/src/store/execution.ts] — Live execution store (do NOT reuse for historical)
- [Source: packages/ui/src/App.tsx] — Current routing structure
- [Source: 1-6-dashboard-workflow-management.md] — Previous story learnings, styling patterns, test conventions

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- Fixed canvas-toolbar tests that broke when `useNavigate` was added to CanvasToolbar — added react-router-dom mock to both `canvas-toolbar.test.ts` and `canvas-toolbar-run.test.ts`

### Completion Notes List

- Implemented server-side execution history endpoints: `GET /api/workflows/:id/executions` (last 50, ordered by startedAt DESC) and `GET /api/workflows/:id/executions/:executionId` with `toExecution()` mapper helper
- Added `listExecutions()` and `getExecution()` client API functions following existing `request<T>()` pattern
- Created `ExecutionHistory.tsx` page with table displaying status badges (color-coded), mode badges, formatted duration, relative timestamps, triggered-by column, and empty state
- Created `ExecutionDetail.tsx` page with read-only React Flow canvas, execution status overlays (green=success, red=error, gray=skipped), and click-to-inspect nodes
- Created `NodeTracePanel.tsx` sidebar component showing node name, type, status, duration, input/output JSON, and error message/stack trace
- Added `formatDuration()` utility to `utils.ts`
- Added "Executions" button with History icon to CanvasToolbar
- Added routes: `/editor/:workflowId/executions` and `/editor/:workflowId/executions/:executionId`
- Wrote 9 tests covering all 6 test subtasks: execution list rendering, row navigation, execution status overlays, node trace panel data, error display, and empty state
- Pre-existing test failures in team-store.test.ts and team-dashboard.test.ts are unrelated to this story

### Change Log

- 2026-03-29: Implemented Story 1.7 — Execution History & Trace Viewer (all tasks complete)

### File List

New files:
- packages/ui/src/pages/ExecutionHistory.tsx
- packages/ui/src/pages/ExecutionDetail.tsx
- packages/ui/src/components/execution/NodeTracePanel.tsx
- packages/ui/src/__tests__/execution-history.test.ts
- packages/ui/src/__tests__/execution-detail.test.ts

Modified files:
- packages/server/src/api/routes/workflows.ts (added toExecution helper, list/get execution endpoints)
- packages/ui/src/lib/api.ts (added listExecutions, getExecution)
- packages/ui/src/lib/utils.ts (added formatDuration)
- packages/ui/src/App.tsx (added execution routes)
- packages/ui/src/components/toolbar/CanvasToolbar.tsx (added Executions button)
- packages/ui/src/__tests__/canvas-toolbar.test.ts (added react-router-dom mock)
- packages/ui/src/__tests__/canvas-toolbar-run.test.ts (added react-router-dom mock)

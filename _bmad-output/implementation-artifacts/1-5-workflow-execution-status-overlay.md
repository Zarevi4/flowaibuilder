# Story 1.5: Workflow Execution & Status Overlay

Status: done

## Story

As a workflow user,
I want to execute my workflow from the canvas and see live status on each node,
so that I can test workflows and identify failures visually.

## Acceptance Criteria

1. **Given** I click the "Run" button in the toolbar **When** the workflow begins executing **Then** each node displays a status overlay: blue (running), green (success), red (error) as execution progresses via WebSocket updates

2. **Given** a node execution completes with an error **When** I click on the failed (red) node **Then** the sidebar shows the error message, stack trace, and the node's input data

3. **Given** execution completes **When** all nodes have finished **Then** the toolbar shows execution status (success/error) and duration

## Tasks / Subtasks

- [x] Task 1: Add `executeWorkflow` API function and execution Zustand store (AC: #1, #3)
  - [x] 1.1 Add `executeWorkflow(workflowId: string): Promise<Execution>` to `packages/ui/src/lib/api.ts`
  - [x] 1.2 Create `packages/ui/src/store/execution.ts` — Zustand store with: `executionId`, `status`, `nodeStatuses: Map<string, NodeExecutionData>`, `startedAt`, `durationMs`, `error`, actions: `startExecution`, `handleNodeExecuted`, `handleExecutionCompleted`, `clearExecution`
  - [x] 1.3 Extend WS message handling in `packages/ui/src/store/ws.ts` to route `execution_started`, `node_executed`, `execution_completed` events to the execution store

- [x] Task 2: Add "Run" button to CanvasToolbar with execution status display (AC: #1, #3)
  - [x] 2.1 Add Run button (Play icon) to `packages/ui/src/components/toolbar/CanvasToolbar.tsx` — calls `executeWorkflow` API, disabled while execution is running
  - [x] 2.2 Show execution status indicator next to Run button: spinner while running, green check on success, red X on error, plus duration in `Xs` format
  - [x] 2.3 Add "Clear" button to dismiss execution results and reset overlays

- [x] Task 3: Add execution status overlay to BaseNode (AC: #1)
  - [x] 3.1 Modify `packages/ui/src/components/canvas/nodes/BaseNode.tsx` — accept optional `executionStatus` prop, render status overlay: blue pulsing ring (running), green border glow (success), red border glow + error icon (error), gray dashed (skipped)
  - [x] 3.2 Wire execution status from execution store into Canvas node rendering — map `nodeStatuses` to ReactFlow node data so BaseNode receives it

- [x] Task 4: Show execution results in NodeConfigSidebar (AC: #2)
  - [x] 4.1 Add execution result section to `packages/ui/src/components/sidebar/NodeConfigSidebar.tsx` — when a node has execution data, show a collapsible "Execution" section below config with: status badge, duration, input data (JSON viewer), output data (JSON viewer), error message + stack trace (if error)
  - [x] 4.2 Error display: red background panel with error message, monospace stack trace, and the node's input data for debugging context

- [x] Task 5: Tests (all ACs)
  - [x] 5.1 Test execution store: startExecution, handleNodeExecuted, handleExecutionCompleted, clearExecution
  - [x] 5.2 Test CanvasToolbar Run button: click triggers execute, disabled during execution, shows status after completion
  - [x] 5.3 Test BaseNode renders status overlays for each execution status
  - [x] 5.4 Test NodeConfigSidebar shows execution results when node has execution data

## Dev Notes

### Server-Side: Already Complete

The server execution pipeline is fully wired. No server changes needed for this story:

- **Executor** (`packages/server/src/engine/executor.ts`): `WorkflowExecutor.execute()` runs the full pipeline — topological sort, sequential node execution, IF branching, retry logic.
- **REST endpoint** (`packages/server/src/api/routes/workflows.ts:288-301`): `POST /api/workflows/:id/execute` — calls executor, returns full `Execution` object.
- **WS broadcasts**: The executor already broadcasts three events:
  - `execution_started` (line 49): `{ execution_id, workflow_id, mode }`
  - `node_executed` (line 89): `{ execution_id, node_id, node_name, status, duration_ms }`
  - `execution_completed` (line 160): `{ execution_id, workflow_id, status, duration_ms }`

### Shared Types (already defined)

Import from `@flowaibuilder/shared`:
```typescript
type ExecutionStatus = 'pending' | 'running' | 'success' | 'error' | 'cancelled';
type ExecutionMode = 'manual' | 'trigger' | 'webhook' | 'retry' | 'mcp';

interface NodeExecutionData {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  status: ExecutionStatus;
  startedAt?: string;
  completedAt?: string;
  duration?: number;
  input?: unknown;
  output?: unknown;
  error?: string;
}

interface Execution {
  id: string;
  workflowId: string;
  status: ExecutionStatus;
  mode: ExecutionMode;
  nodeExecutions: NodeExecutionData[];
  error?: unknown;
  triggeredBy: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
}
```

### Execution Store Design

Create a new Zustand store at `packages/ui/src/store/execution.ts` (architecture calls for `store/execution.ts`). Do NOT put execution state into the workflow store — keep concerns separated.

```typescript
interface ExecutionState {
  executionId: string | null;
  status: ExecutionStatus | null;
  nodeStatuses: Record<string, NodeExecutionData>;  // nodeId -> data
  startedAt: number | null;   // Date.now() for elapsed timer
  durationMs: number | null;
  error: unknown;

  // Actions
  startExecution: (executionId: string) => void;
  handleNodeExecuted: (data: { node_id: string; node_name: string; status: ExecutionStatus; duration_ms: number }) => void;
  handleExecutionCompleted: (data: { status: ExecutionStatus; duration_ms: number }) => void;
  clearExecution: () => void;
}
```

**Zustand 5 pattern** (same as workflow store):
```typescript
export const useExecutionStore = create<ExecutionState>()((set, get) => ({
  // ...state and actions
}));
```

### WS Event Routing

The WS store (`packages/ui/src/store/ws.ts`) currently routes all messages to `useWorkflowStore.getState().applyWsMessages()`. For execution events, route to the execution store instead:

```typescript
// In ws.ts message handler:
if (['execution_started', 'node_executed', 'execution_completed'].includes(msg.type)) {
  const execStore = useExecutionStore.getState();
  if (msg.type === 'execution_started') execStore.startExecution(msg.data.execution_id);
  else if (msg.type === 'node_executed') execStore.handleNodeExecuted(msg.data);
  else if (msg.type === 'execution_completed') execStore.handleExecutionCompleted(msg.data);
} else {
  // existing workflow message handling
}
```

Do NOT batch execution events in RAF — they should apply immediately for real-time visual feedback. The existing batching in ws.ts (lines 20-38) uses `requestAnimationFrame` for workflow update events. Execution events must bypass this.

### BaseNode Status Overlay

Modify `packages/ui/src/components/canvas/nodes/BaseNode.tsx` to accept and render execution status. The overlay is purely visual — CSS classes on the existing wrapper div.

**Status visual mapping:**
- `running` → blue pulsing ring: `ring-2 ring-blue-400 animate-pulse`
- `success` → green glow: `ring-2 ring-green-400`
- `error` → red glow + error icon: `ring-2 ring-red-400` + small red circle with X in top-right
- `skipped` → gray dashed: `ring-2 ring-gray-500 ring-dashed opacity-60`
- No execution / cleared → no overlay (default state)

**Passing status to nodes:** ReactFlow nodes receive data via the `data` prop. In `Canvas.tsx`, when converting workflow nodes to ReactFlow nodes, merge in execution status:

```typescript
const rfNodes = workflow.nodes.map(n => ({
  id: n.id,
  type: nodeTypeToComponent(n.type),
  position: n.position,
  data: {
    ...n,
    executionStatus: nodeStatuses[n.id]?.status ?? null,
  },
}));
```

Currently the node conversion happens in `workflow.ts` store (the `nodes` derived state). The execution store data needs to be combined at the Canvas component level, or the workflow store needs to read from execution store. **Recommended approach**: In `Canvas.tsx`, use both stores and merge:

```typescript
const nodes = useWorkflowStore(s => s.nodes);
const nodeStatuses = useExecutionStore(s => s.nodeStatuses);

const enrichedNodes = useMemo(() =>
  nodes.map(n => ({
    ...n,
    data: { ...n.data, executionStatus: nodeStatuses[n.id]?.status ?? null },
  })),
  [nodes, nodeStatuses]
);
```

### CanvasToolbar Run Button

Add alongside the existing "Add Node" button in `packages/ui/src/components/toolbar/CanvasToolbar.tsx`:

```tsx
// After the AddNodeDropdown section:
<button onClick={handleRun} disabled={isRunning} className="...">
  {isRunning ? <Loader2 className="animate-spin" /> : <Play />}
  Run
</button>
{executionStatus && (
  <span className={statusColorClass}>
    {executionStatus === 'success' ? <CheckCircle /> : <XCircle />}
    {durationMs ? `${(durationMs / 1000).toFixed(1)}s` : ''}
  </span>
)}
```

The Run button calls `executeWorkflow(workflowId)` from `lib/api.ts`. The execution response is NOT used for status — the WS events drive the UI. The API call just triggers execution. If the API call fails (e.g., workflow not found), show error via the store error state pattern from story 1.4.

**Icons**: Use `Play`, `Loader2`, `CheckCircle`, `XCircle`, `X` from `lucide-react` (already installed).

### NodeConfigSidebar Execution Section

Add a collapsible section below the config form in `packages/ui/src/components/sidebar/NodeConfigSidebar.tsx`. Only shown when the selected node has execution data:

```tsx
const nodeExecData = useExecutionStore(s => s.nodeStatuses[selectedNodeId]);

{nodeExecData && (
  <div className="border-t border-gray-700 mt-4 pt-4">
    <h3>Execution</h3>
    <StatusBadge status={nodeExecData.status} />
    <span>{nodeExecData.duration}ms</span>
    {nodeExecData.error && (
      <div className="bg-red-900/30 border border-red-700 rounded p-3 mt-2">
        <p className="text-red-300 font-medium">{nodeExecData.error}</p>
      </div>
    )}
    {nodeExecData.input && <JsonViewer label="Input" data={nodeExecData.input} />}
    {nodeExecData.output && <JsonViewer label="Output" data={nodeExecData.output} />}
  </div>
)}
```

**JSON viewer**: Use a simple `<pre>` with `JSON.stringify(data, null, 2)` and Tailwind monospace styling. Do NOT add a dependency for a JSON viewer library — keep it simple for MVP.

### Important: node_executed Event Data

The server's `node_executed` WS event (executor.ts:89) sends minimal data: `{ execution_id, node_id, node_name, status, duration_ms }`. It does NOT include `input`, `output`, or `error`.

To show full node execution data (input, output, error) in the sidebar, you have two options:
1. **Use the REST response**: The `POST /api/workflows/:id/execute` response includes the full `Execution` with `nodeExecutions[]` containing all data. Store this when execution completes.
2. **Fetch on demand**: When user clicks a node during/after execution, fetch the execution detail from the server.

**Recommended**: Option 1. After calling `executeWorkflow()`, when the response returns (execution complete), update the execution store's `nodeStatuses` with the full `NodeExecutionData[]` from the response. During execution (before response), the WS `node_executed` events provide status-only updates. After execution, the full response fills in input/output/error.

```typescript
// In CanvasToolbar handleRun:
const execution = await executeWorkflow(workflowId);
// execution.nodeExecutions has full data including input/output/error
useExecutionStore.getState().setFullExecutionData(execution.nodeExecutions);
```

### Styling (Dark Theme)

Follow existing patterns:
- Dark theme: `bg-gray-900`, `bg-gray-800`, `border-gray-700`, `text-gray-300`
- Status colors: blue=`blue-400`, green=`green-400`, red=`red-400`, gray=`gray-500`
- Error panels: `bg-red-900/30 border-red-700 text-red-300`
- Buttons: `px-3 py-1.5 text-sm rounded-lg`
- Purple accent for primary actions: `bg-purple-600 hover:bg-purple-700`
- Disabled state: `opacity-50 cursor-not-allowed`
- Tailwind 4 with `@import "tailwindcss"` — no tailwind.config needed

### CSS Animations

The `animate-pulse` class is built into Tailwind and works with Tailwind 4. For the `animate-spin` on the loader icon, also built-in. No custom keyframes needed.

### Editor Layout (Unchanged)

The toolbar is already positioned at `absolute top-2 left-2` in Editor.tsx. The Run button and status display are added within the existing CanvasToolbar component — no layout changes to Editor.tsx needed.

### API Client Pattern

Follow the existing pattern in `packages/ui/src/lib/api.ts`:
```typescript
export async function executeWorkflow(workflowId: string): Promise<Execution> {
  return request(`/workflows/${workflowId}/execute`, { method: 'POST' });
}
```

### What NOT to Do

- Do NOT modify the server executor or API — they are complete
- Do NOT add a progress bar or percentage — node-level status is sufficient
- Do NOT debounce execution events — they must be immediate
- Do NOT use optimistic updates for execution — the server is the source of truth
- Do NOT add execution history to this story — that's Story 1.7
- Do NOT add a "Stop" button — that's out of scope for MVP
- Do NOT add a full-featured JSON tree viewer library — simple `<pre>` with stringified JSON is fine

### Project Structure Notes

- All paths, modules, and naming conventions align with the unified project structure
- New file: `packages/ui/src/store/execution.ts` (architecture specifies this file)
- Modified files: `CanvasToolbar.tsx`, `BaseNode.tsx`, `NodeConfigSidebar.tsx`, `Canvas.tsx`, `ws.ts`, `api.ts`
- Exports follow named export pattern (no default exports)
- TypeScript strict mode enabled

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.5] — Acceptance criteria
- [Source: _bmad-output/planning-artifacts/architecture.md] — DB schema, file structure, execution store
- [Source: packages/server/src/engine/executor.ts:21-182] — Execution engine with WS broadcasts
- [Source: packages/server/src/api/routes/workflows.ts:288-301] — Execute REST endpoint
- [Source: packages/shared/src/types/execution.ts] — ExecutionStatus, NodeExecutionData, Execution types
- [Source: packages/shared/src/types/mcp.ts:7-24] — WebSocket event types including execution events
- [Source: packages/ui/src/store/workflow.ts] — Zustand store pattern, WS message handling
- [Source: packages/ui/src/store/ws.ts] — WebSocket connection, message batching
- [Source: packages/ui/src/components/canvas/nodes/BaseNode.tsx] — Node rendering, overlay insertion point
- [Source: packages/ui/src/components/toolbar/CanvasToolbar.tsx] — Toolbar layout, Run button placement
- [Source: packages/ui/src/components/sidebar/NodeConfigSidebar.tsx] — Sidebar structure, execution section placement
- [Source: packages/ui/src/lib/api.ts] — API client pattern
- [Source: 1-4-canvas-toolbar-node-management.md] — Previous story learnings (WS dedup guards, no optimistic add for server-driven state, per-node debounce timers)

### Review Findings

#### Decision Needed
- [x] [Review][Decision] #1 — **Skipped vs Cancelled status mapping** — Dismissed: `cancelled` is the correct status per shared types. Spec wording updated.
- [x] [Review][Decision] #2 — **Stack trace display missing from sidebar error panel** — Deferred: error string sufficient for MVP. Structured stack trace is a future enhancement.

#### Patch
- [x] [Review][Patch] #3 — **Double-click race: Run fires two executions** — Fixed: added `isSubmitting` ref guard. [CanvasToolbar.tsx]
- [x] [Review][Patch] #4 — **REST response overwrites WS data without execution ID guard** — Fixed: `setFullExecutionData` now requires executionId and guards against stale responses. [execution.ts]
- [x] [Review][Patch] #5 — **No execution ID validation on WS events** — Fixed: WS handler checks `execution_id` matches store's `executionId`. [ws.ts]
- [x] [Review][Patch] #6 — **API error sets workflow store error instead of execution store** — Fixed: error now clears stuck execution state and sets error on execution store. [CanvasToolbar.tsx]
- [x] [Review][Patch] #7 — **Execution store `error` field never populated** — Fixed: `handleExecutionCompleted` now stores error from completion event. [execution.ts]
- [x] [Review][Patch] #8 — **`ring-dashed` is not a valid Tailwind class** — Fixed: uses `border-2 border-dashed border-gray-500` instead. [BaseNode.tsx]
- [x] [Review][Patch] #9 — **WS disconnect leaves execution stuck in `running` forever** — Fixed: clears execution state on WS close. [ws.ts]
- [x] [Review][Patch] #10 — **`nodeExecData.error` rendered directly — crashes if error is an object** — Fixed: added `formatError()` helper that stringifies non-string errors. [NodeConfigSidebar.tsx]
- [x] [Review][Patch] #11 — **Disabled styling not applied when `!workflowId`** — Fixed: unified `isDisabled` variable used for both functional and visual disabled state. [CanvasToolbar.tsx]
- [x] [Review][Patch] #12 — **Sidebar execution section not collapsible per spec** — Fixed: extracted `ExecutionSection` component with toggle state. [NodeConfigSidebar.tsx]
- [x] [Review][Patch] #13 — **Missing test: Run button disabled during execution** — Fixed: added test. [canvas-toolbar-run.test.ts]
- [x] [Review][Patch] #14 — **`cancelled` status shows error icon (XCircle) in toolbar** — Fixed: added `Ban` icon for cancelled status with gray color. [CanvasToolbar.tsx]
- [x] [Review][Patch] #15 — **`pending` status not handled in `getExecutionRingClasses`** — Fixed: added yellow ring for pending. [BaseNode.tsx]

#### Deferred (pre-existing / out of scope)
- [x] [Review][Defer] #16 — **API `Content-Type` forced to JSON on all bodies** — Will break if FormData/Blob ever passed. Not triggered by story 1-5 code. [api.ts:7-8] — deferred, pre-existing
- [x] [Review][Defer] #17 — **`res.json()` called unconditionally — crashes on 204 No Content** — No 204 endpoints used by story 1-5. [api.ts:17] — deferred, pre-existing
- [x] [Review][Defer] #18 — **Module-level mutable singletons in ws.ts break test isolation** — Pre-existing architecture choice from earlier story. [ws.ts:15-23] — deferred, pre-existing
- [x] [Review][Defer] #19 — **IF-node `markBranchSkipped` skips merge nodes incorrectly in diamond topologies** — Server executor issue, not introduced by this story. [executor.ts:293-304] — deferred, pre-existing
- [x] [Review][Defer] #20 — **Retry broadcasts failure but not retry success** — Server executor issue, pre-existing. [executor.ts:88-95, 103-129] — deferred, pre-existing
- [x] [Review][Defer] #21 — **`node_updated` WS event doesn't sync `config` into React Flow data** — Pre-existing reducer gap from earlier story. [workflow.ts:252-278] — deferred, pre-existing
- [x] [Review][Defer] #22 — **`updateNode` API return type mismatch** — Server returns `{ node }` but type says `{ updated, node_id }`. Pre-existing. [api.ts:80, workflows.ts:180] — deferred, pre-existing
- [x] [Review][Defer] #23 — **No debounce on sidebar name input** — Fires API call per keystroke. Pre-existing from story 1-3/1-4. [NodeConfigSidebar.tsx:74-79] — deferred, pre-existing
- [x] [Review][Defer] #24 — **`handleConfigChange` useCallback has unstable `wfNode` dep** — Memoization is ineffective. Pre-existing. [NodeConfigSidebar.tsx:83-88] — deferred, pre-existing
- [x] [Review][Defer] #25 — **`CodeNode` conflicting `truncate` + `whitespace-pre-wrap`** — CSS conflict in pre-existing component. [CodeNode.tsx:19] — deferred, pre-existing

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None — clean implementation with no blockers.

### Completion Notes List

- Task 1: Added `executeWorkflow` API function to api.ts, created `execution.ts` Zustand store with full state management (startExecution, handleNodeExecuted, handleExecutionCompleted, setFullExecutionData, clearExecution), and routed WS execution events immediately (bypassing RAF batching) in ws.ts for real-time feedback.
- Task 2: Rewrote CanvasToolbar to include Run button (purple, disabled during execution), spinner while running, success/error status with duration display, and Clear button. Uses two-phase approach: WS events drive real-time status, REST response fills full node data (input/output/error).
- Task 3: Extended BaseNode with `executionStatus` prop rendering colored ring overlays (blue pulse=running, green=success, red+XCircle badge=error, gray dashed=cancelled). Selection ring takes priority over execution ring. Updated all 6 concrete node components (Trigger, Code, Http, Logic, Ai, Output) to pass executionStatus from data. Canvas.tsx merges execution store nodeStatuses into ReactFlow node data via useMemo.
- Task 4: Added collapsible execution section to NodeConfigSidebar with StatusBadge, duration, error panel (red bg), and collapsible JsonViewer components for input/output data (simple `<pre>` + JSON.stringify).
- Task 5: 22 new tests across 4 test files: execution-store (6), canvas-toolbar-run (5), base-node-overlay (7), sidebar-execution (4). Full suite: 74 tests, 14 files, all passing.

### File List

- packages/ui/src/lib/api.ts (modified — added executeWorkflow function and Execution import)
- packages/ui/src/store/execution.ts (new — execution Zustand store)
- packages/ui/src/store/ws.ts (modified — execution event routing, bypasses RAF batching)
- packages/ui/src/components/toolbar/CanvasToolbar.tsx (modified — Run button, status indicator, Clear button)
- packages/ui/src/components/canvas/nodes/BaseNode.tsx (modified — executionStatus prop, ring overlays, error badge)
- packages/ui/src/components/canvas/nodes/TriggerNode.tsx (modified — pass executionStatus to BaseNode)
- packages/ui/src/components/canvas/nodes/CodeNode.tsx (modified — pass executionStatus to BaseNode)
- packages/ui/src/components/canvas/nodes/HttpNode.tsx (modified — pass executionStatus to BaseNode)
- packages/ui/src/components/canvas/nodes/LogicNode.tsx (modified — pass executionStatus to BaseNode)
- packages/ui/src/components/canvas/nodes/AiNode.tsx (modified — pass executionStatus to BaseNode)
- packages/ui/src/components/canvas/nodes/OutputNode.tsx (modified — pass executionStatus to BaseNode)
- packages/ui/src/components/canvas/Canvas.tsx (modified — merge execution status into node data)
- packages/ui/src/components/sidebar/NodeConfigSidebar.tsx (modified — execution result section with StatusBadge, JsonViewer)
- packages/ui/src/__tests__/execution-store.test.ts (new — 6 tests)
- packages/ui/src/__tests__/canvas-toolbar-run.test.ts (new — 5 tests)
- packages/ui/src/__tests__/base-node-overlay.test.ts (new — 7 tests)
- packages/ui/src/__tests__/sidebar-execution.test.ts (new — 4 tests)

### Change Log

- 2026-03-26: Story 1.5 implemented — workflow execution UI with real-time status overlays, Run button, execution results sidebar, and 22 new tests. All 74 tests passing.

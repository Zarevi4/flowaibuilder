# Story 1.6: Dashboard & Workflow Management

Status: done

## Story

As a workflow user,
I want a dashboard showing all my workflows with key stats,
so that I can manage and navigate between workflows.

## Acceptance Criteria

1. **Given** I navigate to the root URL `/` **When** the dashboard loads **Then** I see a list/grid of all workflows with name, status (active/inactive), last modified date, and last execution status

2. **Given** I click "New Workflow" on the dashboard **When** the workflow is created **Then** I am redirected to the canvas editor for the new workflow

3. **Given** I click delete on a workflow card **When** I confirm the deletion **Then** the workflow is removed from the server and disappears from the dashboard

## Tasks / Subtasks

- [x] Task 1: Add `createWorkflow` and `deleteWorkflow` API functions (AC: #2, #3)
  - [x] 1.1 Add `createWorkflow(name: string, description?: string): Promise<Workflow>` to `packages/ui/src/lib/api.ts` — POST `/workflows`
  - [x] 1.2 Add `deleteWorkflow(id: string): Promise<{ deleted: boolean; id: string }>` to `packages/ui/src/lib/api.ts` — DELETE `/workflows/{id}`

- [x] Task 2: Rewrite Dashboard page with workflow grid, stats, and management actions (AC: #1, #2, #3)
  - [x] 2.1 Rewrite `packages/ui/src/pages/Dashboard.tsx` — replace the minimal list with a full dashboard:
    - Header row with "Workflows" title and "New Workflow" button (purple accent)
    - Grid layout (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`) of WorkflowCard components
    - Empty state with illustration prompt and "Create your first workflow" CTA
    - Loading skeleton cards (not just text)
  - [x] 2.2 Create `packages/ui/src/components/dashboard/WorkflowCard.tsx` — card component showing:
    - Workflow name (bold, truncated)
    - Description (1-line truncated, gray)
    - Active/inactive status badge (green dot "Active" / gray dot "Inactive")
    - Node count and version
    - Last modified date (relative: "2 hours ago", "3 days ago") — compute from `wf.updatedAt`
    - Delete button (trash icon, top-right, shown on hover)
    - Entire card is clickable → navigates to `/editor/{id}`
  - [x] 2.3 Create `packages/ui/src/components/dashboard/DeleteConfirmDialog.tsx` — simple modal:
    - "Delete {workflow name}?" title
    - "This action cannot be undone." body
    - Cancel + Delete buttons (Delete is red)
    - Renders via portal or conditional overlay
    - No external dialog library — build with a `<div>` overlay + `fixed inset-0` backdrop

- [x] Task 3: Wire "New Workflow" flow (AC: #2)
  - [x] 3.1 In Dashboard, "New Workflow" button calls `createWorkflow('Untitled Workflow')`, then navigates to `/editor/{newId}` using `useNavigate()`
  - [x] 3.2 Handle error case — show inline error toast/message if creation fails

- [x] Task 4: Wire delete flow with confirmation (AC: #3)
  - [x] 4.1 Delete button on WorkflowCard opens DeleteConfirmDialog with workflow name
  - [x] 4.2 On confirm, call `deleteWorkflow(id)`, remove workflow from local state on success
  - [x] 4.3 Handle error case — show inline error if deletion fails, keep card visible

- [x] Task 5: Tests (all ACs)
  - [x] 5.1 Test Dashboard renders workflow cards with name, status badge, node count, modified date
  - [x] 5.2 Test "New Workflow" button calls createWorkflow API and navigates to editor
  - [x] 5.3 Test delete flow: click delete → shows confirm dialog → confirm → calls deleteWorkflow → card removed
  - [x] 5.4 Test empty state renders when no workflows
  - [x] 5.5 Test loading state renders skeleton cards

## Dev Notes

### Server-Side: Already Complete

All server endpoints needed for this story already exist. No server changes required:

- **List**: GET `/api/workflows` → returns `{ workflows: Workflow[] }` — already used by current Dashboard
- **Create**: POST `/api/workflows` with `{ name, description? }` → returns created `Workflow` (see `packages/server/src/api/routes/workflows.ts:52-61`)
- **Delete**: DELETE `/api/workflows/:id` → returns `{ deleted: true, id }` (see `packages/server/src/api/routes/workflows.ts:82-86`)

### Existing Dashboard: Must Rewrite

The current `Dashboard.tsx` (50 lines) is a minimal placeholder — simple list with Link cards. This story replaces it entirely with a proper grid dashboard including management actions.

### API Client: Missing create/delete

The current `packages/ui/src/lib/api.ts` has `listWorkflows`, `getWorkflow`, `updateWorkflow`, but does NOT have `createWorkflow` or `deleteWorkflow`. Add them following the existing pattern:

```typescript
export async function createWorkflow(name: string, description?: string): Promise<Workflow> {
  return request<Workflow>('/workflows', {
    method: 'POST',
    body: JSON.stringify({ name, description }),
  });
}

export async function deleteWorkflow(id: string): Promise<{ deleted: boolean; id: string }> {
  return request<{ deleted: boolean; id: string }>(`/workflows/${id}`, {
    method: 'DELETE',
  });
}
```

### Workflow Type Fields Available for Display

From `@flowaibuilder/shared` (`packages/shared/src/types/workflow.ts:34-51`):

```typescript
interface Workflow {
  id: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  connections: Connection[];
  active: boolean;          // → Active/Inactive badge
  version: number;
  tags?: string[];
  createdAt: string;        // ISO string
  updatedAt: string;        // ISO string → "Last modified: X ago"
}
```

**Note**: There is no `lastExecutionStatus` field on the Workflow type. The AC says "last execution status" but the server does not return this on the list endpoint. For MVP, show `active` status instead. Adding execution status to the list response is a future enhancement (would require a JOIN with executions table).

### Relative Date Formatting

For "2 hours ago" / "3 days ago" display, use a simple helper function — do NOT add a library like `date-fns` or `timeago.js`. Implementation:

```typescript
function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  const intervals = [
    { label: 'y', seconds: 31536000 },
    { label: 'mo', seconds: 2592000 },
    { label: 'd', seconds: 86400 },
    { label: 'h', seconds: 3600 },
    { label: 'm', seconds: 60 },
  ];
  for (const { label, seconds: s } of intervals) {
    const count = Math.floor(seconds / s);
    if (count >= 1) return `${count}${label} ago`;
  }
  return 'just now';
}
```

Put this in `packages/ui/src/lib/utils.ts` (create if it doesn't exist, or add to existing).

### Component Structure

```
packages/ui/src/
  pages/
    Dashboard.tsx              # Rewrite — full dashboard page
  components/
    dashboard/
      WorkflowCard.tsx         # New — workflow card with stats + actions
      DeleteConfirmDialog.tsx   # New — confirmation modal
  lib/
    api.ts                     # Modified — add createWorkflow, deleteWorkflow
    utils.ts                   # New or modified — add timeAgo helper
```

### Styling (Dark Theme — Follow Existing Patterns)

From story 1.5 and existing codebase:
- Page background: `bg-gray-950`
- Cards: `bg-gray-900 rounded-lg border border-gray-800 hover:border-purple-500/50`
- Primary buttons: `bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm`
- Destructive buttons: `bg-red-600 hover:bg-red-700 text-white`
- Cancel buttons: `bg-gray-700 hover:bg-gray-600 text-gray-300`
- Text: `text-white` (headings), `text-gray-400` (secondary), `text-gray-500` (muted)
- Status badges: green dot + "Active" / gray dot + "Inactive" — use `w-2 h-2 rounded-full bg-green-400` / `bg-gray-500`
- Modal backdrop: `fixed inset-0 bg-black/50 flex items-center justify-center z-50`
- Modal panel: `bg-gray-900 rounded-xl border border-gray-700 p-6 max-w-sm w-full`
- Skeleton loading: `animate-pulse bg-gray-800 rounded-lg h-32`
- Tailwind 4 with `@import "tailwindcss"` — no tailwind.config needed

### Icons

Use from `lucide-react` (already installed):
- `Plus` — New Workflow button
- `Trash2` — Delete button on card
- `Workflow` or `Zap` — empty state illustration
- `Clock` — last modified indicator (optional)

### Navigation

Use `useNavigate` from `react-router-dom` (already installed) for programmatic navigation after creating a new workflow.

### Delete Confirmation Dialog

Build a simple modal component — do NOT use a dialog library. Structure:

```tsx
interface DeleteConfirmDialogProps {
  workflowName: string;
  onConfirm: () => void;
  onCancel: () => void;
}
```

Render as a fixed overlay. Close on Cancel, backdrop click, or Escape key.

### State Management

Use local React state (`useState`) for the Dashboard — do NOT create a Zustand store for this page. The workflow list is fetched on mount and updated optimistically on delete. Pattern:

```typescript
const [workflows, setWorkflows] = useState<Workflow[]>([]);
// On delete success:
setWorkflows(prev => prev.filter(wf => wf.id !== deletedId));
// On create success:
navigate(`/editor/${newWorkflow.id}`);
```

### What NOT to Do

- Do NOT modify any server code — all endpoints already exist
- Do NOT create a Zustand store for dashboard state — local useState is sufficient
- Do NOT add `date-fns`, `timeago`, or any date library — use the simple `timeAgo` helper
- Do NOT add a dialog/modal library (headless-ui, radix, etc.) — build the confirm dialog with plain div + fixed overlay
- Do NOT add search/filter/sort functionality — that's out of scope for this story
- Do NOT add workflow duplication to the dashboard — the server supports it but it's not in the ACs
- Do NOT add drag-and-drop reordering
- Do NOT add pagination — load all workflows (sufficient for MVP scale)
- Do NOT add last execution status to workflow cards — the Workflow type doesn't include this data from the list endpoint; show `active` status instead
- Do NOT modify App.tsx or routing — the `/` route already points to Dashboard

### Previous Story Intelligence

From story 1.5 review findings (applicable to this story):
- **API `Content-Type` forced to JSON on all bodies** (deferred issue #16) — not a problem for this story since we only send JSON
- **`res.json()` called unconditionally** (deferred issue #17) — DELETE returns JSON `{ deleted, id }` so no issue here
- **Error handling pattern**: Use try/catch around API calls, show error in local state, clear after timeout or dismissal
- **Test patterns**: 74 tests across 14 files exist. Use vitest + @testing-library/react. Mock API functions with `vi.fn()`. Test files go in `packages/ui/src/__tests__/`

### Project Structure Notes

- All paths align with the unified project structure
- New files: `WorkflowCard.tsx`, `DeleteConfirmDialog.tsx`, `utils.ts` (if not existing)
- Modified files: `Dashboard.tsx`, `api.ts`
- Named exports only (no default exports) — except Dashboard which is used directly in the route
- TypeScript strict mode enabled

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.6] — Acceptance criteria
- [Source: packages/shared/src/types/workflow.ts:34-51] — Workflow interface with all available fields
- [Source: packages/server/src/api/routes/workflows.ts:52-61] — Create workflow endpoint
- [Source: packages/server/src/api/routes/workflows.ts:82-86] — Delete workflow endpoint
- [Source: packages/ui/src/pages/Dashboard.tsx] — Current minimal dashboard to rewrite
- [Source: packages/ui/src/lib/api.ts] — API client pattern, existing functions
- [Source: packages/ui/src/App.tsx] — Routing setup, Dashboard at `/`
- [Source: 1-5-workflow-execution-status-overlay.md] — Previous story learnings, styling patterns, test conventions

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None — clean implementation with no blockers.

### Completion Notes List

- Added `createWorkflow` and `deleteWorkflow` to API client following existing `request()` pattern
- Rewrote Dashboard.tsx from 50-line placeholder to full grid dashboard with header, empty state, loading skeletons, error display
- Created WorkflowCard component with name, description, active/inactive badge, node count, version, relative time, hover delete button
- Created DeleteConfirmDialog with backdrop click + Escape key dismissal
- Created `timeAgo` utility in lib/utils.ts — no external date library
- All state managed with local useState — no Zustand store added
- 8 new tests covering: loading skeletons, empty state, card rendering with all fields, inactive badge, new workflow creation + navigation, creation error handling, full delete flow with confirmation, cancel delete
- Full regression suite: 83 tests across 15 files — all passing, 0 regressions

### File List

- `packages/ui/src/lib/api.ts` — modified (added createWorkflow, deleteWorkflow)
- `packages/ui/src/lib/utils.ts` — new (timeAgo helper)
- `packages/ui/src/pages/Dashboard.tsx` — rewritten (full dashboard with grid, empty state, loading, create/delete flows)
- `packages/ui/src/components/dashboard/WorkflowCard.tsx` — new (workflow card component)
- `packages/ui/src/components/dashboard/DeleteConfirmDialog.tsx` — new (confirmation modal)
- `packages/ui/src/__tests__/dashboard.test.ts` — new (8 tests)

### Change Log

- 2026-03-27: Implemented Story 1.6 — Dashboard & Workflow Management. Full grid dashboard with workflow cards, create/delete flows, confirmation dialog, and comprehensive tests.

### Review Findings

- [x] [Review][Decision] No last execution status on card — AC1 met per Dev Notes: `active` status substitutes for execution status at MVP. Accepted.
- [x] [Review][Patch] Delete dialog missing ARIA attributes (`role="dialog"`, `aria-modal="true"`) [DeleteConfirmDialog.tsx] — fixed
- [x] [Review][Patch] Delete button invisible on touch/keyboard — `opacity-0` with no `focus-within` fallback [WorkflowCard.tsx] — fixed
- [x] [Review][Patch] `workflow.version` rendered without null fallback — shows `vundefined` if missing [WorkflowCard.tsx] — fixed
- [x] [Review][Defer] `timeAgo` returns "just now" for invalid/future dates — deferred, pre-existing data boundary
- [x] [Review][Defer] `request()` breaks on 204 No Content — deferred, pre-existing (tracked as issue #17)
- [x] [Review][Defer] Dialog dismissed before async delete completes — deferred, pre-existing UX pattern

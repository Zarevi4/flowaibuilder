# Story 1.8: Breadcrumb, Export Dialog & Utility Pages

Status: done

## Story

As a workflow user,
I want a breadcrumb showing my current context, an export dialog shell, and utility pages for audit logs and settings,
so that I have complete navigation and access to all platform features.

## Acceptance Criteria

1. **Given** I am in the canvas editor **When** I look at the top bar **Then** I see a breadcrumb showing the workflow name, environment badge (dev/staging/prod), and a health score pill (0–100, color-coded: green ≥90, amber 70–89, orange 50–69, red <50; shows "—" when no review exists yet).

2. **Given** I click "Export" in the toolbar **When** the export dialog opens **Then** I see format options (Prompt, TypeScript, Python, Mermaid, JSON), a preview area, and a "Copy to Clipboard" button that copies the raw workflow JSON. Non-JSON formats render a "Coming in Epic 4" placeholder in the preview area (this story is the UI shell only; actual format compilers ship in Story 4.1).

3. **Given** I navigate to `/audit-log` **When** the page loads **Then** I see a filterable list of audit entries with timestamp, actor, action, and resource (resource_type + resource_id). Filters: actor (text input), action (text input), resource type (text input). Empty state when no entries exist.

4. **Given** I navigate to `/settings` **When** the page loads **Then** I can configure instance settings: timezone (text/select), auto-review toggle (boolean), and error workflow ID (text). Settings persist server-side and survive a reload.

## Tasks / Subtasks

- [x] Task 1: Server — instance settings storage + endpoints (AC: #4)
  - [x] 1.1 Add `instanceSettings` table to `packages/server/src/db/schema.ts` — single-row keyed table: `id` (text, primary key, default `'singleton'`), `timezone` (text, default `'UTC'`), `autoReviewEnabled` (boolean, default `false`), `errorWorkflowId` (text, nullable), `updatedAt` (timestamp). Run `npm run db:push`.
  - [x] 1.2 Create `packages/server/src/api/routes/settings.ts` exporting a Fastify plugin with:
    - `GET /api/settings` → returns the singleton row, creating it with defaults if missing
    - `PUT /api/settings` → upserts the singleton row from the request body
  - [x] 1.3 Register the plugin in `packages/server/src/index.ts` alongside the existing route registrations.
  - [x] 1.4 Add an `InstanceSettings` shared type to `packages/shared/src/types/` and re-export from `packages/shared/src/index.ts`.

- [x] Task 2: Server — audit log query endpoint (AC: #3)
  - [x] 2.1 Add `GET /api/audit-log` to a new `packages/server/src/api/routes/audit.ts` plugin. Query params (all optional): `actor`, `action`, `resourceType`, `limit` (default 100, max 500). Returns `{ entries: AuditLogEntry[] }` ordered by `timestamp DESC`.
  - [x] 2.2 Build the where clause with drizzle's `and(...)` and `eq(...)` for each provided filter. Reuse the import pattern from `workflows.ts`.
  - [x] 2.3 Add an `AuditLogEntry` shared type matching the `auditLog` table columns (`id`, `timestamp`, `actor`, `action`, `resourceType`, `resourceId`, `changes`, `metadata`). Re-export from shared index.
  - [x] 2.4 Register the plugin in `packages/server/src/index.ts`.
  - [x] 2.5 Out of scope: this story does NOT add audit log writes anywhere — just the read endpoint. Audit writes are introduced in Story 5.1. The page must render correctly (with empty state) against an empty table.

- [x] Task 3: UI — client API functions (AC: #3, #4)
  - [x] 3.1 In `packages/ui/src/lib/api.ts` add `getSettings(): Promise<InstanceSettings>` (GET `/settings`) and `updateSettings(patch: Partial<InstanceSettings>): Promise<InstanceSettings>` (PUT `/settings`).
  - [x] 3.2 Add `listAuditLog(filters?: { actor?: string; action?: string; resourceType?: string }): Promise<{ entries: AuditLogEntry[] }>` (GET `/audit-log` with query string).
  - [x] 3.3 Follow the existing `request<T>()` helper pattern. Import shared types from `@flowaibuilder/shared`.

- [x] Task 4: UI — Editor breadcrumb (AC: #1)
  - [x] 4.1 Create `packages/ui/src/components/editor/EditorBreadcrumb.tsx`. Reads `workflow` from `useWorkflowStore`. Renders three pieces inline:
    - Back link "Workflows" → `/` (with `ArrowLeft` icon, `text-gray-400 hover:text-white text-sm`)
    - Separator `/`
    - Workflow name (`text-white text-sm font-medium`)
    - Environment badge — pill with text from `workflow.environment` (`dev`/`staging`/`prod`), color-coded: dev = `bg-gray-700 text-gray-300`, staging = `bg-amber-500/20 text-amber-300`, prod = `bg-green-500/20 text-green-400`. Default to `dev`.
    - Health score pill — reads `workflow.review?.healthScore` if present, otherwise renders `—`. Colors: green ≥90 (`bg-green-500/20 text-green-400`), amber 70–89 (`bg-amber-500/20 text-amber-300`), orange 50–69 (`bg-orange-500/20 text-orange-300`), red <50 (`bg-red-500/20 text-red-400`). The `review` field is not yet populated (Epic 2) — handle the undefined case gracefully.
  - [x] 4.2 Mount the breadcrumb in `packages/ui/src/pages/Editor.tsx`. Place it in a top strip ABOVE the canvas (a small `h-9` flex row, `border-b border-gray-800 bg-gray-900 px-3`). The existing CanvasToolbar/Canvas layout stays as-is below it.

- [x] Task 5: UI — Export dialog (AC: #2)
  - [x] 5.1 Create `packages/ui/src/components/editor/ExportDialog.tsx`. Props: `{ open: boolean; onClose: () => void }`. Reads the current workflow from `useWorkflowStore`.
  - [x] 5.2 Modal layout (overlay div, no external library — match Dashboard modal pattern from Story 1.6):
    - Header: "Export Workflow" + close button
    - Format selector: 5 buttons in a row — `Prompt`, `TypeScript`, `Python`, `Mermaid`, `JSON`. Selected button highlighted purple. Default selection: `JSON`.
    - Preview area: `<pre>` with `bg-gray-950 text-gray-300 font-mono text-xs p-3 rounded overflow-auto max-h-96`.
      - When format = `JSON`: render `JSON.stringify(workflow, null, 2)`.
      - When format ≠ `JSON`: render the placeholder text `"// {Format} export coming in Epic 4 (Story 4.1)\n// Use 'Copy to Clipboard' to grab the raw workflow JSON for now."`.
    - Footer: "Copy to Clipboard" button (always copies the raw workflow JSON, regardless of selected format) and a "Close" button. Use `navigator.clipboard.writeText(JSON.stringify(workflow, null, 2))`. Show a transient "Copied!" confirmation for 2 seconds.
  - [x] 5.3 Add an "Export" button to `packages/ui/src/components/toolbar/CanvasToolbar.tsx` (icon `Download` from lucide-react), placed between "JSON" and "Executions". Clicking opens the dialog (local `useState` for open/closed). Disabled when `!workflowId`.

- [x] Task 6: UI — AuditLog page (AC: #3)
  - [x] 6.1 Create `packages/ui/src/pages/AuditLog.tsx`. Page shell: `bg-gray-950 min-h-full p-6`. Header "Audit Log" + back link to `/`.
  - [x] 6.2 Three filter inputs above the table (actor, action, resource type). Each is a controlled `<input>` styled `bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-white`. Filter changes debounce 300ms then re-fetch via `listAuditLog`.
  - [x] 6.3 Table columns: Timestamp (relative via existing `timeAgo`), Actor, Action, Resource (`{resourceType}:{resourceId}`). Row styling matches ExecutionHistory pattern.
  - [x] 6.4 Empty state: "No audit entries match these filters." (or "No audit entries yet." when filters empty).
  - [x] 6.5 Add nav link "Audit Log" to the App.tsx top header nav, and a route `/audit-log` → `AuditLog`.

- [x] Task 7: UI — Settings page (AC: #4)
  - [x] 7.1 Create `packages/ui/src/pages/Settings.tsx`. Header "Instance Settings" + back link to `/`.
  - [x] 7.2 Load current settings via `getSettings()` on mount into local state. Show loading spinner while fetching.
  - [x] 7.3 Form fields:
    - Timezone — `<input type="text">` (default `UTC`)
    - Auto-review enabled — toggle switch (use a styled `<input type="checkbox">` or a div-based toggle, no external lib)
    - Error workflow ID — `<input type="text">` (optional)
  - [x] 7.4 "Save" button → calls `updateSettings(localState)`, shows "Saved!" confirmation for 2s. Disable the button while the request is in flight.
  - [x] 7.5 Add nav link "Settings" to the App.tsx top header nav, and a route `/settings` → `Settings`.

- [x] Task 8: Tests (all ACs)
  - [x] 8.1 `editor-breadcrumb.test.ts` — renders workflow name, dev environment badge, and `—` when no review exists. Renders color-coded health score for given values (90, 75, 60, 40).
  - [x] 8.2 `export-dialog.test.ts` — renders 5 format buttons; default selection is JSON; preview shows JSON.stringify of the workflow; switching to TypeScript shows the Epic 4 placeholder; clicking Copy calls `navigator.clipboard.writeText` with the JSON string.
  - [x] 8.3 `audit-log-page.test.ts` — renders empty state when API returns `{ entries: [] }`; renders rows with timestamp/actor/action/resource when API returns entries; typing in the actor filter triggers a re-fetch (mock `listAuditLog`).
  - [x] 8.4 `settings-page.test.ts` — loads existing settings, edits each field, clicks Save, asserts `updateSettings` was called with the patched object; asserts "Saved!" confirmation appears.
  - [x] 8.5 Server: Add a smoke test under `packages/server/src/__tests__/` for `GET /api/audit-log` (returns empty array on a fresh DB) and `GET /api/settings` (returns defaults on first call, then PUT updates round-trip). Follow the existing server test pattern.

## Dev Notes

### Scope boundary — UI shell only

This story is intentionally a **shell** for several features that get filled in later:

- **Export format compilers** (Story 4.1) — only the dialog UI + the JSON preview + the JSON clipboard copy work in this story. The other 4 format buttons are clickable and show a placeholder.
- **Health score** (Story 2.2) — the breadcrumb pill shows `—` until annotations and a `review.healthScore` exist on the workflow. Do not invent fake scores.
- **Audit log writes** (Story 5.1) — this story only adds the read endpoint and the page. The table will be empty in dev — that's expected. The empty state must render correctly.
- **Auth/RBAC** (Story 5.2) — settings and audit log endpoints are unauthenticated for now. Do not add auth checks; they'll be added in Epic 5.

### DB schema addition

The only schema change is the `instanceSettings` table. The `auditLog` table already exists at `packages/server/src/db/schema.ts:53`. The `workflows` table already has an `environment` column at `packages/server/src/db/schema.ts:10` — reuse it for the badge; do NOT add a new column.

```typescript
// packages/server/src/db/schema.ts — add at the bottom
export const instanceSettings = pgTable('instance_settings', {
  id: text('id').primaryKey().default('singleton'),
  timezone: text('timezone').default('UTC'),
  autoReviewEnabled: boolean('auto_review_enabled').default(false),
  errorWorkflowId: text('error_workflow_id'),
  updatedAt: timestamp('updated_at').defaultNow(),
});
```

After editing schema, run `npm run db:push` (the docker-entrypoint runs this on container start; for local dev call it explicitly).

### Server route plugin pattern

Existing routes are registered in `packages/server/src/index.ts`. Both `settings.ts` and `audit.ts` should export a default Fastify plugin function so they register the same way as `workflows.ts`. Reuse:

- `db` from `../../db/index.js`
- `eq`, `desc`, `and` from `drizzle-orm`
- `.js` extensions on relative imports (this project uses ESM)

### Singleton settings upsert pattern

```typescript
// In settings.ts
async function getOrCreateSettings() {
  const [row] = await db.select().from(instanceSettings).where(eq(instanceSettings.id, 'singleton'));
  if (row) return row;
  const [created] = await db.insert(instanceSettings).values({ id: 'singleton' }).returning();
  return created;
}
```

For PUT, use `db.update(instanceSettings).set({...patch, updatedAt: new Date()}).where(eq(instanceSettings.id, 'singleton')).returning()`. If no row exists yet, call `getOrCreateSettings()` first.

### Existing Code to Reuse (do NOT recreate)

- **`request()` helper** — `packages/ui/src/lib/api.ts`. Use for all new client functions.
- **`timeAgo()`** — `packages/ui/src/lib/utils.ts` (added in Story 1.6). Use for AuditLog row timestamps.
- **`useWorkflowStore`** — `packages/ui/src/store/workflow.ts`. The breadcrumb and export dialog read `workflow` from this store; do NOT fetch the workflow again.
- **Modal/dialog pattern** — overlay div + centered card with `fixed inset-0 z-50 bg-black/50 flex items-center justify-center`. No external dialog library. Pattern established in Dashboard (Story 1.6).
- **Workflow type** — `@flowaibuilder/shared` exports `Workflow`. Already has `environment?: string`. Do NOT add new fields.
- **lucide-react icons** — `Download`, `ArrowLeft`, `Settings as SettingsIcon`, `FileText`, `Check`, `X` are all already used elsewhere in the codebase.

### Breadcrumb placement decision

Place breadcrumb in a NEW top strip above the canvas inside `Editor.tsx`, NOT inside the global `App.tsx` header. Reason: the breadcrumb is editor-specific (it needs `useWorkflowStore`) and the global header should stay route-agnostic. This also keeps the WebSocket "Live" pill in the top-right of the canvas area where it currently is.

### Editor.tsx layout change

Currently the Editor returns `<div className="flex-1 flex h-full">` with the canvas + sidebar. Wrap that in a `<div className="flex-1 flex flex-col h-full">` and add the breadcrumb strip as the first child:

```tsx
<div className="flex-1 flex flex-col h-full">
  <EditorBreadcrumb />
  <div className="flex-1 flex">
    <div className="flex-1 relative">
      <Canvas />
      <CanvasToolbar className="absolute top-2 left-2 z-10" />
      {/* WS status pill stays here */}
    </div>
    {selectedNodeId && !jsonPanelOpen && <NodeConfigSidebar />}
    {jsonPanelOpen && <JsonPanel onClose={toggleJsonPanel} />}
  </div>
</div>
```

### App.tsx routes/nav additions

Add to the `<nav>` block:

```tsx
<Link to="/audit-log" className="text-gray-400 hover:text-white text-sm">Audit Log</Link>
<Link to="/settings" className="text-gray-400 hover:text-white text-sm">Settings</Link>
```

Add to `<Routes>`:

```tsx
<Route path="/audit-log" element={<AuditLog />} />
<Route path="/settings" element={<Settings />} />
```

### File Structure

```
packages/server/src/
  db/schema.ts                       # Modified — add instanceSettings table
  api/routes/
    settings.ts                      # New — GET/PUT /api/settings
    audit.ts                         # New — GET /api/audit-log
  index.ts                           # Modified — register both new plugins
  __tests__/
    settings.test.ts                 # New
    audit.test.ts                    # New

packages/shared/src/
  types/instance-settings.ts         # New — InstanceSettings, AuditLogEntry types
  index.ts                           # Modified — re-export

packages/ui/src/
  pages/
    AuditLog.tsx                     # New
    Settings.tsx                     # New
    Editor.tsx                       # Modified — wrap in flex-col, add breadcrumb
  components/
    editor/
      EditorBreadcrumb.tsx           # New
      ExportDialog.tsx               # New
    toolbar/
      CanvasToolbar.tsx              # Modified — add Export button
  lib/api.ts                         # Modified — add getSettings, updateSettings, listAuditLog
  App.tsx                            # Modified — add routes + nav links
  __tests__/
    editor-breadcrumb.test.ts        # New
    export-dialog.test.ts            # New
    audit-log-page.test.ts           # New
    settings-page.test.ts            # New
```

### Styling — follow Story 1.6/1.7 dark theme

- Page bg: `bg-gray-950`
- Cards/strips: `bg-gray-900 border-b border-gray-800`
- Inputs: `bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-white focus:border-purple-500 focus:outline-none`
- Primary buttons: `bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded text-sm`
- Secondary buttons: `bg-gray-800 border border-gray-700 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded text-sm`
- Pills: `px-2 py-0.5 rounded text-xs font-medium`
- Modal overlay: `fixed inset-0 z-50 bg-black/60 flex items-center justify-center`
- Modal card: `bg-gray-900 border border-gray-800 rounded-lg shadow-xl w-full max-w-2xl p-6`

### What NOT to do

- Do NOT implement the actual export format compilers (Prompt/TS/Python/Mermaid) — that's Story 4.1. Show the placeholder text and move on.
- Do NOT compute or fake a health score — render `—` until Epic 2 wires `workflow.review`.
- Do NOT add audit log write calls anywhere in this story — only the read endpoint and the page.
- Do NOT add authentication or RBAC checks to the new endpoints — Epic 5.
- Do NOT add a Zustand store for settings or audit log — local `useState` per page is sufficient.
- Do NOT add pagination to the audit log page — `limit=100` is enough for MVP. A "Load more" button is out of scope.
- Do NOT add an external dialog/modal/toggle library (Radix, HeadlessUI, etc.) — keep the pattern consistent with Story 1.6's plain-div modals.
- Do NOT introduce an environment switcher in the breadcrumb — it's display-only in this story. Editing environment happens via the existing workflow update flow.
- Do NOT modify the existing global header in App.tsx beyond adding two nav links. Keep the breadcrumb editor-local.
- Do NOT add WebSocket broadcasting for settings or audit log changes.

### Previous Story Intelligence

From Stories 1.6 and 1.7:

- **Tests live at** `packages/ui/src/__tests__/` using vitest + @testing-library/react. Mock API functions with `vi.fn()`. Mock `react-router-dom` (`useNavigate`, `useParams`) when testing components that use it — see `canvas-toolbar.test.ts` for the pattern. ~83 tests already in place.
- **Named exports only** for components. Pages used directly in `<Route element={<X />}>` can be named exports too (see ExecutionHistory, ExecutionDetail).
- **API client pattern**: All client calls use `request<T>()` from `lib/api.ts`. New functions go in the same file.
- **Local state over stores**: Stories 1.6 and 1.7 both used `useState` for page-level data (dashboard list, execution detail). Continue that pattern here for AuditLog and Settings.
- **Try/catch + local error state** around fetch calls. Show a small inline error message; do not throw or use error boundaries.
- **`.js` ESM imports** on the server side — every relative import inside `packages/server/src/` ends in `.js` even when the source is `.ts`. Forgetting this breaks the build.
- **Pre-existing test failures** in `team-store.test.ts` and `team-dashboard.test.ts` are unrelated and tracked separately. Do not try to fix them in this story.

### Project Structure Notes

- All paths align with the unified project structure described in `architecture.md`. No deviations.
- TypeScript strict mode is enabled; all new code must type-check cleanly.
- Imports from `@flowaibuilder/shared` for shared types; relative imports within each package.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.8] — Acceptance criteria
- [Source: _bmad-output/planning-artifacts/epics.md:100,162] — FR71 breadcrumb spec
- [Source: _bmad-output/planning-artifacts/epics.md:669] — Story 4.1 reference (export shell handoff)
- [Source: packages/server/src/db/schema.ts:53-64] — Existing auditLog table
- [Source: packages/server/src/db/schema.ts:10] — Existing workflows.environment column
- [Source: packages/server/src/api/routes/workflows.ts] — Route plugin pattern to mirror
- [Source: packages/server/src/index.ts] — Where to register new route plugins
- [Source: packages/shared/src/types/workflow.ts:42-44] — Workflow.environment + settings fields
- [Source: packages/ui/src/App.tsx] — Header + Routes to extend
- [Source: packages/ui/src/pages/Editor.tsx] — Editor layout to wrap with breadcrumb strip
- [Source: packages/ui/src/components/toolbar/CanvasToolbar.tsx] — Where the Export button goes
- [Source: packages/ui/src/lib/api.ts] — request() helper pattern
- [Source: packages/ui/src/lib/utils.ts] — timeAgo, formatDuration helpers to reuse
- [Source: 1-6-dashboard-workflow-management.md] — Modal pattern, dark theme, test conventions
- [Source: 1-7-execution-history-trace-viewer.md] — Page layout, table styling, react-router-dom mock pattern

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- UI tests: 4 files / 10 tests — all green.
- Server smoke test: 3 tests — all green.
- Full UI regression: 136 passed. 7 pre-existing failures in `team-store.test.ts` and `team-dashboard.test.ts` (explicitly called out in Dev Notes → Previous Story Intelligence as unrelated).
- Full server regression: 80/80 passing.

### Completion Notes List

- Added `instance_settings` table (singleton row) to schema; new `settingsRoutes` (GET/PUT `/api/settings`) and `auditRoutes` (GET `/api/audit-log` with actor/action/resourceType/limit filters). Both registered in `packages/server/src/index.ts`.
- New shared types `InstanceSettings` and `AuditLogEntry` exported from `@flowaibuilder/shared`.
- UI API client extended with `getSettings`, `updateSettings`, `listAuditLog`.
- `EditorBreadcrumb` reads `useWorkflowStore`, renders workflow name, environment badge (dev/staging/prod color-coded), and health pill (`—` when no review). Mounted in a new top strip inside `Editor.tsx`.
- `ExportDialog` — plain-div modal with 5 format buttons, JSON preview, placeholder for other formats, clipboard copy. Added "Export" button to `CanvasToolbar` between JSON and Executions.
- `AuditLog` page — debounced (300ms) filter inputs, empty state, row table with `timeAgo` timestamp. Route `/audit-log` and nav link added in `App.tsx`.
- `Settings` page — loads on mount, timezone/auto-review/error workflow ID fields, Save with "Saved!" confirmation. Route `/settings` and nav link added in `App.tsx`.
- Scope honored: no auth/RBAC, no audit writes, no export compilers, no fake health score, no new workflow type fields, no external dialog libs. Followed `.js` ESM imports, named exports, local `useState` over stores, try/catch error handling from previous stories.

### File List

**New**
- `packages/server/src/api/routes/settings.ts`
- `packages/server/src/api/routes/audit.ts`
- `packages/server/src/__tests__/settings-and-audit.test.ts`
- `packages/shared/src/types/instance-settings.ts`
- `packages/ui/src/components/editor/EditorBreadcrumb.tsx`
- `packages/ui/src/components/editor/ExportDialog.tsx`
- `packages/ui/src/pages/AuditLog.tsx`
- `packages/ui/src/pages/Settings.tsx`
- `packages/ui/src/__tests__/editor-breadcrumb.test.ts`
- `packages/ui/src/__tests__/export-dialog.test.ts`
- `packages/ui/src/__tests__/audit-log-page.test.ts`
- `packages/ui/src/__tests__/settings-page.test.ts`

**Modified**
- `packages/server/src/db/schema.ts` — added `instanceSettings` table
- `packages/server/src/index.ts` — registered `settingsRoutes` and `auditRoutes`
- `packages/shared/src/index.ts` — re-exported new types
- `packages/ui/src/lib/api.ts` — added `getSettings`, `updateSettings`, `listAuditLog`
- `packages/ui/src/pages/Editor.tsx` — wrapped in flex-col + breadcrumb strip
- `packages/ui/src/components/toolbar/CanvasToolbar.tsx` — Export button + dialog mount
- `packages/ui/src/App.tsx` — nav links + routes for `/audit-log` and `/settings`

### Change Log

- 2026-04-08: Story 1.8 implemented — breadcrumb, export dialog shell, audit log page, settings page, and supporting server endpoints.

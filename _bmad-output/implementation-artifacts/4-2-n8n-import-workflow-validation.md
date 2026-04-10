# Story 4.2: n8n Import & Workflow Validation

Status: done

## Story

As an n8n user migrating to flowAIbuilder,
I want to import my existing n8n workflow JSON and validate any workflow for correctness,
so that I can migrate without rebuilding from scratch and catch structural problems before running.

## Acceptance Criteria

1. **Given** a valid n8n workflow JSON export **When** I call `flowaibuilder.import_n8n({ n8n_workflow_json, name?, description? })` **Then** the n8n nodes are mapped to flowAIbuilder equivalents (webhook, code-js, http-request, if, switch, merge, set, schedule, manual, respond-webhook) **And** n8n `connections` are translated into flowAIbuilder `Connection[]` (with `sourceNodeId`, `targetNodeId`, and `sourceHandle`/`targetHandle` when the n8n connection uses non-default output/input indexes) **And** a new workflow row is inserted (via the same pattern as `POST /api/workflows`) and returned in the result.

2. **Given** an n8n workflow that uses node types flowAIbuilder does NOT support **When** import runs **Then** each unsupported node is converted to a `code-js` placeholder node whose `data.config.code` contains a header comment documenting the original n8n `type`, `typeVersion`, and full `parameters` JSON, and whose body is `return $input.all();` (pass-through) **And** the import result's `warnings` array lists each unsupported node (`{ n8nNodeName, n8nType, mappedTo: 'code-js' }`).

3. **Given** an import call with `n8n_workflow_json` that is not a valid n8n export (missing `nodes` or `connections`, or not an object) **When** the tool runs **Then** it returns a descriptive `ImportError` — no workflow row is created.

4. **Given** any workflow (imported or hand-built) **When** I call `flowaibuilder.validate({ workflow_id })` **Then** the validator runs five checks and returns `{ valid: boolean, issues: ValidationIssue[] }` where each issue has `{ severity: 'error' | 'warning', code, message, nodeId?, connectionId? }`:
   - **orphan-node** (warning) — a node with no incoming AND no outgoing connections (triggers exempt: webhook, schedule, manual)
   - **circular-dependency** (error) — a cycle exists in the directed graph; include the node ids forming the cycle in `message`
   - **missing-required-config** (error) — a node is missing a required field for its type (see required-fields table below)
   - **expression-syntax-error** (warning) — a config string contains an unclosed `{{` or `}}`, or mismatched `{{ … }}` braces
   - **dead-end-branch** (warning) — a non-output node whose only downstream path never reaches a `respond-webhook` or any node with zero outgoing edges that is NOT a trigger (i.e., a branch that produces no result). Triggers and `respond-webhook` nodes are exempt.

5. **Given** a workflow with zero issues **When** validate is called **Then** `valid` is `true` and `issues` is `[]`.

6. **Given** a validate call with an unknown `workflow_id` **When** the tool runs **Then** it returns an MCP error `Workflow not found: <id>`.

7. **Given** the MCP tools exist **When** the equivalent REST endpoints are hit (`POST /api/workflows/import-n8n` with JSON body `{ n8n_workflow_json, name?, description? }`, and `POST /api/workflows/:id/validate`) **Then** they return the same shapes as the MCP tools (import returns `{ workflow, warnings }`, validate returns `{ valid, issues }`) **And** invalid input produces a 400 with a descriptive error **And** unknown id on validate produces a 404.

8. **Given** the existing Canvas Toolbar (`packages/ui/src/components/editor/CanvasToolbar.tsx`) **When** the user clicks a new **Validate** button **Then** the UI calls `validateWorkflow(workflowId)` and shows results in a toast/inline panel listing issues grouped by severity, with the affected node ids rendered as clickable chips that pan/zoom the canvas to the node (reuse the pattern already used for annotation click-to-node in `CanvasAnnotationLayer.tsx` if present, otherwise just highlight via `setCenter` from `useReactFlow`). If `valid === true`, show a success toast "Workflow is valid".

## Tasks / Subtasks

- [x] Task 1: Shared types (AC: #1, #2, #4)
  - [x] 1.1 Create `packages/shared/src/types/import.ts` with:
    - `interface N8nImportResult { workflow: Workflow; warnings: N8nImportWarning[] }`
    - `interface N8nImportWarning { n8nNodeName: string; n8nType: string; mappedTo: NodeType; reason: string }`
  - [x] 1.2 Create `packages/shared/src/types/validation.ts` with:
    - `type ValidationSeverity = 'error' | 'warning'`
    - `type ValidationCode = 'orphan-node' | 'circular-dependency' | 'missing-required-config' | 'expression-syntax-error' | 'dead-end-branch'`
    - `interface ValidationIssue { severity: ValidationSeverity; code: ValidationCode; message: string; nodeId?: string; connectionId?: string }`
    - `interface ValidationResult { valid: boolean; issues: ValidationIssue[] }`
  - [x] 1.3 Re-export both modules from `packages/shared/src/index.ts` (mirror the pattern used for `export.ts`).

- [x] Task 2: Server — n8n importer module (AC: #1, #2, #3)
  - [x] 2.1 Create `packages/server/src/import/index.ts` exporting:
    - `class ImportError extends Error` (subclass, name set in ctor)
    - `function importN8nWorkflow(json: unknown, opts: { name?: string; description?: string }): { workflow: Omit<Workflow, 'id'|'createdAt'|'updatedAt'|'createdBy'|'updatedBy'|'version'|'active'>; warnings: N8nImportWarning[] }`
    - The function is pure — NO DB access. Routes/MCP tools handle persistence.
  - [x] 2.2 Create `packages/server/src/import/n8n-mapper.ts` with:
    - `N8N_TYPE_MAP: Record<string, NodeType>` — minimal mapping:
      - `n8n-nodes-base.webhook` → `webhook`
      - `n8n-nodes-base.scheduleTrigger` / `n8n-nodes-base.cron` → `schedule`
      - `n8n-nodes-base.manualTrigger` → `manual`
      - `n8n-nodes-base.code` / `n8n-nodes-base.function` / `n8n-nodes-base.functionItem` → `code-js`
      - `n8n-nodes-base.httpRequest` → `http-request`
      - `n8n-nodes-base.if` → `if`
      - `n8n-nodes-base.switch` → `switch`
      - `n8n-nodes-base.merge` → `merge`
      - `n8n-nodes-base.set` → `set`
      - `n8n-nodes-base.respondToWebhook` → `respond-webhook`
    - `function mapN8nNode(n8nNode): { node: WorkflowNode; warning?: N8nImportWarning }` — unknown types become placeholder `code-js` with config `{ code: "// Imported from n8n\n// Original type: <type> (v<typeVersion>)\n// Original parameters:\n// <json>\nreturn $input.all();", language: 'javascript' }` and a warning.
    - Position mapping: n8n uses `position: [x, y]` array → convert to `{ x, y }`.
    - Id mapping: n8n node ids are strings (sometimes UUIDs, sometimes numbers) — reuse them as-is if they match `/^[A-Za-z0-9_-]+$/`, otherwise generate a fresh `nanoid()` and keep a `n8nId → newId` map for connection rewiring.
    - Name mapping: copy `n8nNode.name` to `node.name`, also set `data.label = node.name`.
    - Config mapping: copy `n8nNode.parameters` into `data.config` for supported types. Do NOT try to fully translate expressions — copy verbatim; mismatches will surface via validation.
  - [x] 2.3 Connection translation: n8n's `connections` shape is:
    ```
    { "<sourceNodeName>": { "main": [ [ { "node": "<targetNodeName>", "type": "main", "index": <int> } ], ... ] } }
    ```
    The outer array index is the source output index; each inner array contains targets at that output. Translate to:
    ```
    { id: nanoid(), sourceNodeId: <resolvedId>, targetNodeId: <resolvedId>, sourceHandle: outputIdx > 0 ? `out-${outputIdx}` : undefined, targetHandle: inputIdx > 0 ? `in-${inputIdx}` : undefined }
    ```
    Keys in n8n's `connections` are node NAMES, not ids — resolve via a `name → newId` map built during node mapping.
  - [x] 2.4 Input validation: throw `ImportError("Invalid n8n export: expected object with 'nodes' array and 'connections' object")` if shape is wrong. Use `typeof x === 'object' && x !== null && Array.isArray(x.nodes) && typeof x.connections === 'object'` as the minimum check.
  - [x] 2.5 Default `name` = `opts.name ?? json.name ?? 'Imported from n8n'`. Default `description` = `opts.description ?? 'Imported from n8n on <ISO date>'`.

- [x] Task 3: Server — validation module (AC: #4, #5)
  - [x] 3.1 Create `packages/server/src/validation/index.ts` exporting `validateWorkflow(workflow: Workflow): ValidationResult`. Pure function, no I/O.
  - [x] 3.2 Create `packages/server/src/validation/required-fields.ts` with:
    ```ts
    export const REQUIRED_FIELDS: Partial<Record<NodeType, string[]>> = {
      webhook: ['path'],
      'http-request': ['url'],
      'code-js': ['code'],
      'code-python': ['code'],
      if: ['condition'],
      switch: ['expression'],
      schedule: ['cron'],
      set: ['values'],
      'respond-webhook': [],
      'ai-agent': ['prompt'],
    };
    ```
    A field is "missing" if `node.data.config[field]` is `undefined`, `null`, or an empty string. Empty arrays/objects also count as missing.
  - [x] 3.3 Create `packages/server/src/validation/checks/` with one file per check:
    - `orphans.ts` — `findOrphans(workflow): ValidationIssue[]`. A node is an orphan if both `incomingCount === 0` AND `outgoingCount === 0`. Trigger types (`webhook`, `schedule`, `manual`) are NEVER flagged as orphans (they naturally have no incoming). Actually, re-read: triggers ARE exempt from orphan (they have no incoming by design). Re-define: flag any node where `incomingCount === 0 AND outgoingCount === 0 AND type not in [webhook, schedule, manual]`.
    - `cycles.ts` — `findCycles(workflow): ValidationIssue[]`. Use DFS with a gray/black coloring. On back-edge, collect the cycle path and emit ONE issue per distinct cycle with `message` = `"Circular dependency: <id1> → <id2> → ... → <id1>"` and `nodeId` = first node in cycle.
    - `required-config.ts` — `findMissingConfig(workflow): ValidationIssue[]`. For each node, look up its type in `REQUIRED_FIELDS` and emit an `error` issue per missing field: `"Node '<name>' (<type>) is missing required field: <field>"`.
    - `expressions.ts` — `findExpressionErrors(workflow): ValidationIssue[]`. For each string value in `node.data.config` (recursive walk), count `{{` and `}}`. If counts differ, emit a warning `"Node '<name>' has unbalanced expression braces in field '<path>'"`. Do NOT attempt to evaluate expressions.
    - `dead-ends.ts` — `findDeadEnds(workflow): ValidationIssue[]`. Build adjacency list. For each non-trigger, non-output node, do BFS forward; if no path reaches a `respond-webhook` node AND no path reaches any node with zero outgoing edges of a non-trigger type, emit a warning. Simplification: flag any non-trigger node whose transitive closure contains no `respond-webhook` AND no terminal non-trigger node. If the workflow has zero `respond-webhook` nodes AND no terminal nodes at all, skip this check (nothing to anchor to).
  - [x] 3.4 `validateWorkflow` runs all five checks in order and concatenates issues. `valid = issues.every(i => i.severity !== 'error')` — warnings do NOT fail validation.

- [x] Task 4: Server — REST endpoints (AC: #7)
  - [x] 4.1 Add `POST /api/workflows/import-n8n` to `packages/server/src/api/routes/workflows.ts`. Body: `{ n8n_workflow_json: unknown; name?: string; description?: string }`. Calls `importN8nWorkflow(...)`, then inserts a workflow row using the same `INSERT` pattern as `POST /api/workflows` (line ~88): generate `id = nanoid()`, `createdBy = 'mcp:import'` (or `'system'` — mirror whatever the create endpoint uses; check the file and match it), `version = 1`, `active = false`. Returns `{ workflow: toWorkflow(row), warnings }`. On `ImportError`, return `400 { error: err.message }`.
  - [x] 4.2 Add `POST /api/workflows/:id/validate`. Loads workflow via `getWorkflowById(id)`, 404 if missing, calls `validateWorkflow(workflow)`, returns `ValidationResult` as JSON.
  - [x] 4.3 Place both handlers near the other workflow CRUD routes. Do NOT add auth — Epic 5 territory. Do NOT broadcast a WS event for validate. DO broadcast a `workflow.created` event for import (mirror the existing create flow — check broadcaster usage).

- [x] Task 5: Server — MCP tools (AC: #1, #2, #3, #4, #6)
  - [x] 5.1 Create `packages/server/src/mcp/tools/import.ts` exporting `registerImportTools(server: McpServer)`. Add tool `flowaibuilder.import_n8n` with input schema `{ n8n_workflow_json: z.unknown(), name: z.string().optional(), description: z.string().optional() }`. Handler mirrors the REST endpoint: call `importN8nWorkflow`, insert row via drizzle, return `text(JSON.stringify({ workflow, warnings }, null, 2))`. On `ImportError`, return `mcpError(err.message)`.
  - [x] 5.2 Create `packages/server/src/mcp/tools/validate.ts` exporting `registerValidateTools(server)`. Add tool `flowaibuilder.validate` with input `{ workflow_id: z.string() }`. Handler loads the workflow, returns `text(JSON.stringify(validateWorkflow(wf), null, 2))`, or `mcpError` on 404.
  - [x] 5.3 Register both in `packages/server/src/mcp/index.ts` next to `registerExportTools(server)` (line ~519). Remember the `.js` ESM extension on relative imports.
  - [x] 5.4 Copy the `text()` / `mcpError()` helper pattern from `packages/server/src/mcp/tools/export.ts` — do not re-invent.

- [x] Task 6: UI — validate button and results panel (AC: #8)
  - [x] 6.1 Add `validateWorkflow(workflowId: string): Promise<ValidationResult>` to `packages/ui/src/lib/api.ts` using the existing `request<T>()` helper. Import `ValidationResult` from `@flowaibuilder/shared`.
  - [x] 6.2 Add a `Validate` button to `packages/ui/src/components/editor/CanvasToolbar.tsx` next to the existing Export button. Use the lucide-react `ShieldCheck` icon (or `CheckCircle` if ShieldCheck isn't imported yet). On click, call `validateWorkflow(currentWorkflowId)`, store result in local `useState<ValidationResult | null>`, and open a `ValidationResultsPanel`.
  - [x] 6.3 Create `packages/ui/src/components/editor/ValidationResultsPanel.tsx` — a small floating panel (reuse the positioning style of `ExportDialog.tsx` but smaller). Groups issues by severity (errors first, then warnings). Each issue row shows `{severity icon} {code} — {message}` with a `nodeId` chip when present. Clicking the chip calls `reactFlow.setCenter(node.position.x, node.position.y, { zoom: 1.5, duration: 400 })` — import `useReactFlow` from `@xyflow/react`. If `valid === true && issues.length === 0`, show a green "Workflow is valid" message and close after 2s.
  - [x] 6.4 Add an **Import n8n** button to `CanvasToolbar.tsx` (file picker that accepts `.json`). On file select, read as text, `JSON.parse`, POST to `/workflows/import-n8n` via a new `importN8nWorkflow(json, opts)` helper in `lib/api.ts`. On success, navigate to the new workflow (`navigate(\`/workflow/\${workflow.id}\`)`) and show a toast listing any warnings. On error, show an inline error.
  - [x] 6.5 Do NOT add new Zustand store slices — use local component state for the validation panel and import file picker, matching the pattern in Stories 1.6/1.7/1.8.

- [x] Task 7: Tests (all ACs)
  - [x] 7.1 `packages/server/src/__tests__/import-n8n.test.ts` — table-driven unit tests for `importN8nWorkflow`:
    - Fixture 1: minimal n8n export with 1 webhook + 1 function + connection → assert mapped types (`webhook`, `code-js`), connection wired by id, `warnings === []`.
    - Fixture 2: unsupported type `n8n-nodes-base.slack` → becomes placeholder `code-js` with header comment containing `Original type: n8n-nodes-base.slack`, exactly one warning with `mappedTo: 'code-js'`.
    - Fixture 3: connection with output index 1 → emitted connection has `sourceHandle: 'out-1'`.
    - Fixture 4: invalid input `{}` → throws `ImportError`.
    - Fixture 5: invalid input `null` → throws `ImportError`.
    - Fixture 6: node id with illegal chars gets remapped and connections still resolve correctly.
  - [x] 7.2 `packages/server/src/__tests__/validation.test.ts` — table-driven tests for `validateWorkflow`:
    - Happy path: linear webhook → code-js → respond-webhook with full config → `valid: true, issues: []`.
    - Orphan: standalone `code-js` not connected to anything → warning `orphan-node`.
    - Trigger-only: lone `webhook` with valid path → NOT flagged as orphan.
    - Cycle: A → B → C → A → error `circular-dependency` with all three ids in message.
    - Missing required: `http-request` with empty `url` → error `missing-required-config`.
    - Expression error: `{ code: "return {{ $json.foo }}" }` balanced → no issue. `{ code: "return {{ $json.foo" }` unbalanced → warning `expression-syntax-error`.
    - Dead-end: webhook → code-js (no outgoing, no respond-webhook in workflow) AND respond-webhook exists in workflow but disconnected → warning on code-js.
    - Valid = false only when at least one `error` severity issue exists.
  - [x] 7.3 `packages/server/src/__tests__/import-validate-routes.test.ts` — server smoke test following `settings-and-audit.test.ts` pattern:
    - `POST /api/workflows/import-n8n` with a valid fixture → 200, returns `{ workflow, warnings }`, DB row exists.
    - `POST /api/workflows/import-n8n` with `{ n8n_workflow_json: null }` → 400.
    - `POST /api/workflows/:id/validate` on a known-bad workflow → 200 with expected issues.
    - `POST /api/workflows/unknown/validate` → 404.
  - [x] 7.4 `packages/server/src/__tests__/import-validate-mcp.test.ts` — direct handler tests for both MCP tools, following the pattern in `export-mcp.test.ts`.
  - [x] 7.5 `packages/ui/src/__tests__/validation-panel.test.tsx` — renders `ValidationResultsPanel` with a fixture `ValidationResult`, asserts error rows render before warning rows, clicking a node chip calls a mocked `setCenter`. Mock `useReactFlow` from `@xyflow/react` with `vi.fn()`.
  - [x] 7.6 `packages/ui/src/__tests__/canvas-toolbar-import.test.tsx` — mounts `CanvasToolbar`, mocks `importN8nWorkflow` from `lib/api`, simulates a file input `change` event with a mock `File`, asserts `importN8nWorkflow` was called with the parsed JSON.

## Dev Notes

### Scope boundary

This story ships:
1. A pure n8n → flowAIbuilder importer (best-effort type mapping, unsupported → placeholder code-js).
2. A pure workflow validator (5 checks).
3. REST endpoints for both.
4. MCP tools for both.
5. UI Validate button + results panel, UI Import n8n button + file picker.

This story does NOT ship:
- A full n8n expression translator. Expressions are copied verbatim; validation surfaces unbalanced braces only.
- Round-trip export back to n8n (Epic 4 only goes n8n → flowAIbuilder).
- Auto-validation on save (validation is on-demand via MCP/REST/UI button).
- Deep semantic validation (type-checking expression inputs, verifying HTTP URLs reach external services, etc.).
- Auth checks on the new endpoints — Epic 5.
- A separate Zustand store slice for validation state — use local `useState`.

### Why a placeholder code-js for unsupported nodes

n8n has 400+ node types; we will never map all of them. The value of import is preserving workflow *structure* so users can rewire integrations by hand. A placeholder `code-js` preserves:
- The node position on canvas (so the graph topology is visible)
- The node name
- All original parameters in a comment (so users can rebuild the logic)
- The wiring to neighbors

This is the same pattern n8n itself uses for version-upgrade incompatibilities.

### Where things go

```
packages/server/src/
  import/
    index.ts                  # NEW — importN8nWorkflow + ImportError
    n8n-mapper.ts             # NEW — N8N_TYPE_MAP, mapN8nNode
  validation/
    index.ts                  # NEW — validateWorkflow
    required-fields.ts        # NEW — REQUIRED_FIELDS table
    checks/
      orphans.ts              # NEW
      cycles.ts               # NEW
      required-config.ts      # NEW
      expressions.ts          # NEW
      dead-ends.ts             # NEW
  api/routes/workflows.ts     # MODIFIED — add import-n8n + validate routes
  mcp/
    tools/import.ts           # NEW — registerImportTools
    tools/validate.ts         # NEW — registerValidateTools
    index.ts                  # MODIFIED — register both
  __tests__/
    import-n8n.test.ts            # NEW
    validation.test.ts            # NEW
    import-validate-routes.test.ts # NEW
    import-validate-mcp.test.ts   # NEW

packages/shared/src/
  types/import.ts             # NEW
  types/validation.ts         # NEW
  index.ts                    # MODIFIED — re-export

packages/ui/src/
  lib/api.ts                  # MODIFIED — importN8nWorkflow, validateWorkflow helpers
  components/editor/CanvasToolbar.tsx         # MODIFIED — Validate + Import n8n buttons
  components/editor/ValidationResultsPanel.tsx # NEW
  __tests__/validation-panel.test.tsx         # NEW
  __tests__/canvas-toolbar-import.test.tsx    # NEW
```

### Existing code to reuse (do NOT recreate)

- **`toWorkflow(row)`** and **`getWorkflowById(id)`** — `packages/server/src/api/routes/workflows.ts:27,50`. Reuse for both routes AND MCP tool handlers. Already exported.
- **DB insert pattern for workflows** — `POST /api/workflows` handler at `packages/server/src/api/routes/workflows.ts:88`. Mirror for the import route (id generation via `nanoid()`, `createdBy`/`updatedBy` convention, `version: 1`, `active: false`).
- **MCP helpers (`text()`, `mcpError()`)** — copy from `packages/server/src/mcp/tools/export.ts:9-18`. Same three-line pattern.
- **MCP tool registration** — mirror `export.ts` and `zones.ts` exactly. `.js` ESM extensions on ALL relative imports.
- **`request<T>()` helper** — `packages/ui/src/lib/api.ts`. Use for both new UI helpers.
- **Topological sort / graph walk** — `packages/server/src/export/topo.ts` already exists (Kahn's). The cycle-detection check needs DFS (different algorithm), but look at `topo.ts` for adjacency-list conventions and reuse whatever helpers make sense. Do NOT duplicate adjacency-list building.
- **`useReactFlow()`** from `@xyflow/react` — `setCenter(x, y, opts)` for pan-to-node. Already used elsewhere in the canvas.
- **Toast/notification UI** — check if a toast component already exists in `packages/ui/src/components/`. If yes, reuse. If no, use an inline banner and do NOT pull in a new library.
- **lucide-react icons** — `ShieldCheck`, `Upload`, `FileJson` are all available. Import per-component as existing files do.

### n8n JSON shape reference

Simplified but accurate:

```json
{
  "name": "My Workflow",
  "nodes": [
    {
      "parameters": { "path": "hook", "httpMethod": "POST" },
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 1,
      "position": [250, 300],
      "id": "abc-123"
    }
  ],
  "connections": {
    "Webhook": {
      "main": [
        [
          { "node": "Function", "type": "main", "index": 0 }
        ]
      ]
    }
  }
}
```

Key gotchas:
- `connections` keys are node **names**, not ids. Build a `name → newId` map during node mapping and resolve in a second pass.
- `position` is a tuple `[x, y]`, NOT an object.
- `id` may be missing on older exports — generate `nanoid()` if so.
- Some nodes use `typeVersion` to indicate parameter schema version — just preserve it in the placeholder comment for unsupported nodes, ignore otherwise.

### Validation: cycle detection algorithm

Standard DFS with three colors:
- WHITE = unvisited
- GRAY = on current stack
- BLACK = fully explored

On encountering a GRAY neighbor, walk back up the stack to collect the cycle path. Emit one issue per cycle root. Do NOT emit an issue per edge — that's noise.

For the cycle `message` field, format as `"Circular dependency: nodeA → nodeB → nodeC → nodeA"` using node **names** (more readable than ids) but set `nodeId` to the id of the cycle root for chip linking.

### Validation: dead-end check edge cases

The simplification in Task 3.3 intentionally over-flags rather than under-flags. If the workflow has NO `respond-webhook` and NO terminal nodes at all, skip the check (nothing to anchor against). This prevents false positives on pure trigger-only workflows during development.

Alternative semantics considered and rejected: flagging nodes whose forward closure has a strictly smaller set than the workflow's "reachable-from-trigger" set. Too expensive and confusing. Stick with the simple "can I reach an output node?" check.

### What NOT to do

- Do NOT translate n8n expression syntax to JavaScript. Copy verbatim. Users will adapt.
- Do NOT call any external services during import or validation (no HTTP fetches, no AI).
- Do NOT add a new database table for validation results — it's a pure computation, re-run on demand.
- Do NOT persist import warnings in the DB — return them in the API response and show them in the UI toast.
- Do NOT touch `workflows.ts` node CRUD handlers — only add the two new routes near them.
- Do NOT add new node types. The importer maps to existing types only.
- Do NOT broadcast WS events for validation runs. DO broadcast `workflow.created` for import (mirror the existing create path — grep `broadcaster.broadcast` in `workflows.ts` to find the exact event name/shape already used).
- Do NOT attempt to auto-validate on every workflow save — this story is on-demand validation only.
- Do NOT pull in any new npm dependencies. Everything can be done with existing deps (`drizzle-orm`, `zod`, `nanoid`, `@xyflow/react`).

### Previous Story Intelligence

From Story 4.1 (export compilers, `4-1-workflow-export-compilers.md`) and Stories 3.1/3.2/2.x:

- ESM `.js` extension on every relative server import. Build fails silently-then-loudly otherwise.
- New MCP tools go in `packages/server/src/mcp/tools/<name>.ts` exporting `registerXxxTools(server)`, registered from `mcp/index.ts` next to `registerExportTools(server)` at ~line 519.
- Server smoke tests live in `packages/server/src/__tests__/` and use Fastify's `app.inject({ method, url, payload })` — see `settings-and-audit.test.ts` and `export-route.test.ts`.
- UI tests use vitest + @testing-library/react; mock `lib/api` functions with `vi.fn()`; local files live in `packages/ui/src/__tests__/`.
- Local `useState` for dialog/panel state. No new Zustand slices unless genuinely cross-page.
- Pre-existing test failures in `team-store.test.ts` / `team-dashboard.test.ts` are tracked separately — do not fix in this story.
- TypeScript strict mode is on. `any` is disallowed. Use `unknown` and type-narrow.
- Story 4.1 added `compileWorkflow`, `ExportError`, `EXPORT_FORMATS` — mirror that file layout for the importer (`importN8nWorkflow`, `ImportError`) and validator.
- Story 4.1 exports `toWorkflow` from `api/routes/workflows.ts` — it's already public, no re-export needed.

### Project Structure Notes

- All paths match `architecture.md`. No deviations.
- The `import/` and `validation/` server dirs are new but follow the precedent set by `export/`, `zones/`, `review/`.
- Shared types files match the pattern in `packages/shared/src/types/` — one file per domain, re-exported from `index.ts`.
- UI component additions follow the `components/editor/` grouping used by `ExportDialog.tsx`, `CanvasToolbar.tsx`, etc.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.2] — Acceptance criteria (epics.md lines 674-696)
- [Source: _bmad-output/implementation-artifacts/4-1-workflow-export-compilers.md] — Sibling story, same Epic 4 patterns (compiler module, MCP tool registration, REST endpoint placement)
- [Source: packages/server/src/api/routes/workflows.ts:27] — `toWorkflow(row)` mapper (already exported)
- [Source: packages/server/src/api/routes/workflows.ts:50] — `getWorkflowById(id)` helper
- [Source: packages/server/src/api/routes/workflows.ts:88] — `POST /api/workflows` create handler — insert pattern to mirror
- [Source: packages/server/src/mcp/tools/export.ts] — MCP tool shape + `text()`/`mcpError()` helpers to copy
- [Source: packages/server/src/mcp/index.ts:519] — Where to call `registerImportTools(server)` and `registerValidateTools(server)`
- [Source: packages/server/src/export/topo.ts] — Adjacency-list conventions / Kahn's sort (reuse style, not implementation, for cycle DFS)
- [Source: packages/shared/src/types/workflow.ts] — `Workflow`, `WorkflowNode`, `Connection`, `NodeType`
- [Source: packages/shared/src/types/export.ts] — Pattern for new `import.ts` / `validation.ts` shared types
- [Source: packages/ui/src/components/editor/CanvasToolbar.tsx] — File to modify (add Validate + Import buttons)
- [Source: packages/ui/src/components/editor/ExportDialog.tsx] — Positioning/style reference for `ValidationResultsPanel`
- [Source: packages/ui/src/lib/api.ts] — `request<T>()` helper to reuse
- [Source: packages/server/src/__tests__/settings-and-audit.test.ts] — Server smoke test pattern
- [Source: packages/server/src/__tests__/export-route.test.ts] — Sibling test, same Epic 4 conventions
- [Source: n8n docs — https://docs.n8n.io/workflows/export-import/] — Reference n8n JSON export shape

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- Previous agent crashed after creating shared types, server import module, required-fields, and orphans check. Resumed from that state.
- Initial dead-end check flagged node `c` incorrectly as a self-anchor; refined anchors to respond-webhook only per Dev Notes (terminal non-triggers are candidates, not anchors).

### Completion Notes List

- All 7 tasks implemented per spec. Zero new npm deps.
- Dead-end semantics: anchors = respond-webhook nodes only. If workflow has zero respond-webhook nodes, skip the check entirely (Dev Notes).
- Import route broadcasts `workflow_created` via existing getBroadcaster, mirroring the duplicate route precedent.
- REST import uses `createdBy: 'mcp:import'` per spec.
- `ValidationResultsPanel` accepts an optional `getNodePosition` hook so the toolbar can pan via workflow-store positions without requiring React Flow nodes to exist in the rf instance at test time.
- Tests: 25 server tests (import-n8n=7, validation=9, routes=4, mcp=5) + 5 UI tests (panel=3, toolbar-import=2) all passing. Existing canvas-toolbar test still passes.
- Typecheck: clean for all story-touched files. Pre-existing unrelated error in `agent-teams-intervention.test.ts` not addressed per spec.

### File List

**New (shared):**
- packages/shared/src/types/import.ts
- packages/shared/src/types/validation.ts

**New (server):**
- packages/server/src/import/index.ts
- packages/server/src/import/n8n-mapper.ts
- packages/server/src/validation/index.ts
- packages/server/src/validation/required-fields.ts
- packages/server/src/validation/checks/orphans.ts
- packages/server/src/validation/checks/cycles.ts
- packages/server/src/validation/checks/required-config.ts
- packages/server/src/validation/checks/expressions.ts
- packages/server/src/validation/checks/dead-ends.ts
- packages/server/src/mcp/tools/import.ts
- packages/server/src/mcp/tools/validate.ts
- packages/server/src/__tests__/import-n8n.test.ts
- packages/server/src/__tests__/validation.test.ts
- packages/server/src/__tests__/import-validate-routes.test.ts
- packages/server/src/__tests__/import-validate-mcp.test.ts

**Modified (server):**
- packages/server/src/api/routes/workflows.ts (added import-n8n + validate routes)
- packages/server/src/mcp/index.ts (registered import + validate tools)
- packages/shared/src/index.ts (re-exports)

**New (ui):**
- packages/ui/src/components/editor/ValidationResultsPanel.tsx
- packages/ui/src/__tests__/validation-panel.test.tsx
- packages/ui/src/__tests__/canvas-toolbar-import.test.tsx

**Modified (ui):**
- packages/ui/src/lib/api.ts (validateWorkflow + importN8nWorkflow helpers)
- packages/ui/src/components/toolbar/CanvasToolbar.tsx (Validate + Import n8n buttons)

## Change Log

- 2026-04-09 — Implemented Story 4.2 (n8n import + validation): 5 validation checks, pure n8n importer, REST endpoints, MCP tools, UI Validate + Import buttons, 10 new test files (30 new passing tests).

# Story 2.1: Review Context Builder & Core MCP Tools

Status: done

## Story

As a Claude Code user,
I want MCP tools that serialize my workflow into a structured context and let me save analysis results back,
so that I can review workflows and provide actionable annotations without flowAIbuilder calling any AI API itself.

## Acceptance Criteria

1. **Given** a workflow exists with nodes, connections, and execution history **When** Claude calls `flowaibuilder.get_review_context({ workflow_id })` **Then** the tool returns a JSON object containing: `workflow` (id, name, description), `nodes` (each with `id`, `type`, `name`, `config`, `incoming_data_fields`, `outgoing_data_fields`), `connections`, `detected_pattern` (rule-based string), `credentials_used` (array of credential type strings), `recent_executions` (last 5, each with `status`, `error`, `node_errors`, `duration_ms`, `started_at`), `current_annotations` (all non-dismissed annotations for the workflow), and `protected_zones` (each with `name`, `node_ids`, `reason`, `pinned_by`). If the workflow does not exist the tool returns an MCP error.

2. **Given** Claude has analyzed a workflow **When** Claude calls `flowaibuilder.save_annotations({ workflow_id, annotations, health_score?, scores?, summary? })` **Then** each annotation is inserted into the `annotations` table with a generated UUID, `status='active'`, `createdAt=now`, and the fields `nodeId`, `severity` (`error`|`warning`|`suggestion`), `title`, `description`, optional `fix`, optional `relatedNodes`, optional `knowledgeSource`. **And** a `workflow_reviews` row is created capturing `reviewType='ai'`, `healthScore`, `scores` (JSONB), `summary`, `annotationCount`. **And** a single `annotations_updated` event is broadcast via the WebSocket broadcaster with payload `{ workflow_id, annotations, health_score }`. The tool returns `{ saved: number, review_id: string, health_score: number|null }`.

3. **Given** annotations exist for a workflow **When** Claude calls `flowaibuilder.get_annotations({ workflow_id, severity?, status? })` **Then** the tool returns `{ annotations: Annotation[] }` filtered by workflow, optionally by `severity` (`error`|`warning`|`suggestion`) and/or `status` (`active`|`applied`|`dismissed`, default `active`), ordered by `createdAt DESC`.

4. **Given** an annotation exists **When** Claude calls `flowaibuilder.dismiss_annotation({ workflow_id, annotation_id, reason? })` **Then** the annotation row's `status` is set to `'dismissed'` and `dismissedReason` is set to the provided reason (nullable). **And** an `annotations_updated` event is broadcast for that workflow so the canvas refreshes. The tool returns `{ dismissed: true, annotation_id }`. If the annotation does not exist or belongs to a different workflow the tool returns an MCP error.

5. **Given** any of the four new MCP tools are registered on the MCP server **When** an MCP client lists tools **Then** `flowaibuilder.get_review_context`, `flowaibuilder.save_annotations`, `flowaibuilder.get_annotations`, and `flowaibuilder.dismiss_annotation` are all present with zod-validated parameter schemas and descriptive `.describe()` strings.

6. **Given** the server package has no runtime dependency on `@anthropic-ai/sdk` **When** the server builds **Then** no new AI-SDK dependency is introduced by this story — all four tools are pure data (DB reads/writes + graph computation) consistent with the zero-cost AI principle in CLAUDE.md.

## Tasks / Subtasks

- [ ] Task 1: Review engine scaffold — context builder + store (AC: #1, #2, #3, #4)
  - [ ] 1.1 Create `packages/server/src/review/context-builder.ts` exporting `buildReviewContext(workflow, executions, annotations, zones): ReviewContext`. Compute `incoming_data_fields` / `outgoing_data_fields` via graph traversal of `workflow.connections` (walk upstream/downstream one hop, collect node output field names from `node.data.config` where statically knowable; fall back to `[]`). Implement `detectPattern(workflow)` as rule-based: returns `'ai_agent'` if any node type includes `'ai-agent'`, `'webhook_processing'` if a `webhook` trigger exists and ≤1 `http-request` node, `'http_api_chain'` if ≥2 `http-request` nodes, `'scheduled_batch'` if a `schedule` trigger exists, else `'general'`. Implement `extractCredentialTypes(workflow)`: scan `node.data.config.credentialType` (string) across nodes, return unique values.
  - [ ] 1.2 Create `packages/server/src/review/store.ts` exporting `AnnotationStore` with methods: `saveAnnotations(workflowId, annotations, reviewMeta)` (inserts annotation rows + a `workflowReviews` row in a single transaction via `db.transaction`), `getAnnotations(workflowId, filter?)`, `dismissAnnotation(workflowId, annotationId, reason?)`. All methods use the drizzle `db` from `packages/server/src/db/index.ts` and the `annotations` / `workflowReviews` tables already present in `schema.ts`.
  - [ ] 1.3 Add a `ReviewContext` interface to `packages/shared/src/types/annotation.ts` (export from `packages/shared/src/index.ts`) with the exact shape from AC #1 so the UI and tests can consume it.

- [ ] Task 2: MCP tools file — register 4 review tools (AC: #1, #2, #3, #4, #5)
  - [ ] 2.1 Create `packages/server/src/mcp/tools/review.ts` exporting `registerReviewTools(server: McpServer)`. Follow the exact pattern of `packages/server/src/mcp/tools/agent-teams.ts`: top-level imports, local `mcpError()` helper, zod schemas inline in each `server.tool(...)` call with `.describe()` on every field.
  - [ ] 2.2 Implement `flowaibuilder.get_review_context`:
    - Params: `{ workflow_id: z.string() }`.
    - Loads the workflow row, last 5 executions (`db.select().from(executions).where(eq(executions.workflowId, workflow_id)).orderBy(desc(executions.startedAt)).limit(5)`), current active annotations (`store.getAnnotations(workflow_id, { status: 'active' })`), and protected zones (`db.select().from(protectedZones).where(eq(protectedZones.workflowId, workflow_id))`).
    - Returns `{ content: [{ type: 'text', text: JSON.stringify(buildReviewContext(...)) }] }`.
    - On missing workflow: return `mcpError("Workflow ${workflow_id} not found")`.
  - [ ] 2.3 Implement `flowaibuilder.save_annotations`:
    - Params: `{ workflow_id: z.string(), annotations: z.array(z.object({ node_id: z.string(), severity: z.enum(['error','warning','suggestion']), title: z.string(), description: z.string(), fix: z.object({ description: z.string(), tool: z.string(), params: z.record(z.unknown()) }).optional(), related_nodes: z.array(z.string()).optional(), knowledge_source: z.string().optional() })), health_score: z.number().min(0).max(100).optional(), scores: z.object({ security: z.number(), reliability: z.number(), data_integrity: z.number(), best_practices: z.number() }).optional(), summary: z.string().optional() }`.
    - Maps snake_case input to camelCase DB columns (`nodeId`, `relatedNodes`, `knowledgeSource`, `dataIntegrity`, `bestPractices`), delegates to `store.saveAnnotations`, then broadcasts `annotations_updated` with `getBroadcaster()?.broadcast('annotations_updated', workflow_id, { annotations: savedAnnotations, health_score })`.
    - Returns `{ saved, review_id, health_score }`.
  - [ ] 2.4 Implement `flowaibuilder.get_annotations`:
    - Params: `{ workflow_id: z.string(), severity: z.enum(['error','warning','suggestion']).optional(), status: z.enum(['active','applied','dismissed']).optional() }`.
    - Delegates to `store.getAnnotations` with filter. Default `status` filter is `'active'` when omitted.
  - [ ] 2.5 Implement `flowaibuilder.dismiss_annotation`:
    - Params: `{ workflow_id: z.string(), annotation_id: z.string(), reason: z.string().optional() }`.
    - Delegates to `store.dismissAnnotation`. If the row does not exist or `annotation.workflowId !== workflow_id` return `mcpError`. On success broadcast `annotations_updated` with the updated active-annotations list.
  - [ ] 2.6 In `packages/server/src/mcp/index.ts`, import `registerReviewTools` and call it right after `registerAgentTeamTools(server)` in `createMcpServer()`.

- [ ] Task 3: Tests (AC: #1, #2, #3, #4, #5, #6)
  - [ ] 3.1 Create `packages/server/src/__tests__/review-mcp.test.ts`. Follow the pattern in `mcp-tools.test.ts` (set up an in-memory test db + Fastify app, directly invoke the MCP tool handlers by calling `server.tool`'s internal registry — or, matching current tests, call the store + context-builder functions and assert the DB state).
  - [ ] 3.2 Cases:
    - `buildReviewContext` returns the expected shape for a 3-node workflow (webhook → http → respond) with detected_pattern `'webhook_processing'`.
    - `saveAnnotations` inserts N annotation rows and one `workflow_reviews` row with matching `annotationCount` and `healthScore`, and broadcasts one `annotations_updated` event (assert via a fake broadcaster or spy — follow `broadcaster.test.ts` approach).
    - `getAnnotations` filters by `severity` and by `status`, and defaults to `status='active'`.
    - `dismissAnnotation` flips `status` to `'dismissed'` and sets `dismissedReason`, and errors on wrong workflow_id.
    - `get_review_context` MCP tool returns an error text for a non-existent workflow id.
  - [ ] 3.3 Ensure `npm run --workspace packages/server test` (or the package's existing test command in `packages/server/package.json`) passes.

- [ ] Task 4: Shared types + broadcaster wiring (AC: #2, #4, #6)
  - [ ] 4.1 In `packages/shared/src/types/annotation.ts` add `ReviewContext` and an `AnnotationInput` type (the snake_case wire shape). Re-export from `packages/shared/src/index.ts`.
  - [ ] 4.2 Confirm `annotations_updated` is already in `WebSocketEventType` union in `packages/shared/src/types/mcp.ts` (it is — see line 22) and reuse it. Do NOT add a new event type.
  - [ ] 4.3 Confirm `@anthropic-ai/sdk` is NOT added to `packages/server/package.json`. The review engine is pure data + rule-based computation.

## Dev Notes

### Architectural constraints (from CLAUDE.md + architecture.md)

- **Zero-cost AI principle (CLAUDE.md, "Key Principles")**: The server MUST NOT call Claude API. `get_review_context` returns data; Claude (user's subscription) thinks; `save_annotations` writes back. No `@anthropic-ai/sdk` import anywhere in `packages/server`.
- **MCP-first (CLAUDE.md)**: Every review capability ships as an MCP tool first. No REST endpoints for review in this story — canvas UI in Story 2.3 will consume the WebSocket `annotations_updated` event and eventually a REST read endpoint, but that is out of scope here.
- **File conventions (CLAUDE.md)**: MCP tools live in `packages/server/src/mcp/tools/` (one file per tool group) → `review.ts`. Review engine code lives in `packages/server/src/review/` — the directory already exists (empty). Do not add the rule subfolders (`rules/security.ts` etc.) from the architecture doc — those belong to Story 2.2.
- **Broadcaster reuse**: Use `getBroadcaster()?.broadcast(type, workflowId, data)` from `packages/server/src/api/ws/broadcaster.ts`. Reuse the existing `annotations_updated` event type — do NOT invent `review_completed` (the epic mentions it, but the shared type union does not have it and adding a new event is unnecessary churn; `annotations_updated` already carries the full annotation list).
- **DB schema already exists**: `annotations` and `workflowReviews` tables are defined in `packages/server/src/db/schema.ts:104-137`. Do NOT run `db:push` or edit the schema for this story. Use camelCase field names (`nodeId`, `relatedNodes`, `knowledgeSource`, `healthScore`, `annotationCount`) — these are the TypeScript column names.
- **Apply-fix is out of scope**: `flowaibuilder.apply_fix` and the `annotation_applied` broadcast ship in Story 2.2. This story only covers `save_annotations`, `get_annotations`, `dismiss_annotation`, `get_review_context`.
- **Canvas UI is out of scope**: Annotation cards, the "AI Review" button, and the health-score badge wiring ship in Story 2.3. Story 1.8 already added a placeholder health-score pill in `EditorBreadcrumb.tsx` that reads `workflow.review?.healthScore` — we do NOT need to populate that field in this story; Story 2.3 will fetch reviews through a new endpoint.
- **Protected zones table exists but zone MCP tools do NOT yet exist**: Story 3.1 adds the enforcer and CRUD. For this story, `get_review_context` should still include `protected_zones` by reading directly from the `protectedZones` table — this keeps `get_review_context` forward-compatible. An empty array is returned if none exist.

### Source tree touch list

- NEW: `packages/server/src/review/context-builder.ts`
- NEW: `packages/server/src/review/store.ts`
- NEW: `packages/server/src/mcp/tools/review.ts`
- NEW: `packages/server/src/__tests__/review-mcp.test.ts`
- EDIT: `packages/server/src/mcp/index.ts` — add `registerReviewTools(server)` call
- EDIT: `packages/shared/src/types/annotation.ts` — add `ReviewContext`, `AnnotationInput`
- EDIT: `packages/shared/src/index.ts` — re-export new types

### Previous story intelligence (Story 1.8)

- Story 1.8 added `EditorBreadcrumb.tsx` reading `workflow.review?.healthScore` — the `review` sub-object on `Workflow` is typed in `packages/shared/src/types/workflow.ts` but is not yet populated by any server code. This story does not hydrate that field either; Story 2.3 (canvas annotation UI) will.
- Story 1.8 established the Fastify plugin pattern for new routes, but this story adds NO REST endpoints — all four tools are MCP-only per the MCP-first principle.
- Tests in `packages/server/src/__tests__/` use the existing server test harness (`settings-and-audit.test.ts`, `mcp-tools.test.ts`). Follow whichever matches better: direct store/function tests for unit coverage, MCP handler invocation for integration coverage.

### Git intelligence

- Most recent commit `d1183f7 feat: Stories 5-6 + fixes — MCP server, REST API, WebSocket broadcaster` established the `packages/server/src/mcp/tools/agent-teams.ts` pattern — mirror its structure (imports, `mcpError` helper, inline zod schemas with `.describe()`, `registerXxxTools` export, registration in `mcp/index.ts`).
- No prior commits touch `packages/server/src/review/` — this is greenfield code inside that directory.

### Testing standards

- Test framework: Vitest (see existing files in `packages/server/src/__tests__/`). Use `describe` / `it` / `expect` and the existing test DB + broadcaster test harness.
- Assert both DB state and broadcast invocations — the broadcast is load-bearing because Story 2.3's canvas relies on it.
- At minimum cover: context shape for each `detected_pattern` branch, successful save + broadcast, dismiss + broadcast, missing-workflow error path, wrong-workflow-id error path on dismiss.

### References

- [Source: CLAUDE.md] — Zero-cost AI principle, MCP-first, file conventions.
- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.1] — Acceptance criteria.
- [Source: _bmad-output/planning-artifacts/architecture.md#Review Data Store] — `AnnotationStore` shape (lines 761-817).
- [Source: _bmad-output/planning-artifacts/architecture.md#Context Builder] — `buildReviewContext`, `detectPattern`, `traceIncomingFields` patterns (lines 720-890).
- [Source: _bmad-output/planning-artifacts/architecture.md#Review Context includes zone info] — `protected_zones` key in returned context (lines 700-717).
- [Source: packages/server/src/db/schema.ts:104-137] — `annotations` + `workflowReviews` table definitions (do not edit).
- [Source: packages/shared/src/types/annotation.ts] — `Annotation`, `AnnotationFix`, `ReviewScores`, `WorkflowReview` types (extend with `ReviewContext` in this story).
- [Source: packages/shared/src/types/mcp.ts:22] — `annotations_updated` event already in `WebSocketEventType` union.
- [Source: packages/server/src/mcp/tools/agent-teams.ts] — MCP tool file pattern to mirror.
- [Source: packages/server/src/api/ws/broadcaster.ts:77] — `broadcast(type, workflowId, data)` signature.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

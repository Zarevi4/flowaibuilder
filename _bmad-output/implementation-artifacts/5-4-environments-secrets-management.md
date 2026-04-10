# Story 5.4: Environments & Secrets Management

Status: done

## Story

As a workflow developer,
I want to promote workflows through dev/staging/prod environments and manage encrypted secrets,
so that I can safely develop and deploy workflows with sensitive credentials.

## Acceptance Criteria

1. **Given** a workflow exists, **When** a user with `editor` role calls `PUT /api/workflows/:id` with `{ environment: "staging" }` or `POST /api/workflows/:id/promote` with `{ environment: "staging" }`, **Then** `workflows.environment` is updated, a `workflow_version_created` snapshot is recorded (via the existing `recordSnapshot` hook from Story 5.3, which already watches the `active` field — `environment` is not yet in the watchlist; add it to `shouldVersion`'s field list in `versioning/diff.ts`), a `workflow.promoted` audit entry is written with `metadata: { from, to }`, and a `workflow_updated` WS broadcast is emitted. 403 for viewers. The valid environment values are `dev | staging | prod` — reject anything else with 400.

2. **Given** a user with `editor` role, **When** they call `POST /api/secrets` with `{ name: string, type: "api_key"|"oauth2"|"basic"|"custom", value: string }`, **Then** `value` is encrypted via the existing `encrypt()` from `packages/server/src/crypto/aes.ts` and stored in `credentials.dataEncrypted`. `name` must be unique (case-insensitive). `createdBy` = `request.user.email`. Return `{ id, name, type, createdAt }` — NEVER return the encrypted or plaintext value. 403 for viewers. If `name` already exists, return 409.

3. **Given** a secret exists, **When** a user calls `PUT /api/secrets/:id` with `{ value: string }`, **Then** the new value is encrypted and `dataEncrypted` is updated, `updatedAt` is set, a `credential.updated` audit entry is written (with `metadata: { name, type }`, no value). The response echoes `{ id, name, type, updatedAt }` — no value. 403 for viewers. If the caller sends `value: "***"` (the redaction sentinel), treat it as a no-op (do not overwrite with the literal string) — mirror the `gitToken` sentinel pattern from Story 5.3 `settings.ts:77-82`.

4. **Given** secrets exist, **When** a user calls `GET /api/secrets`, **Then** the response is `{ secrets: Array<{ id, name, type, createdBy, createdAt, updatedAt }> }` — values are NEVER returned, not even as `"***"`. This is intentional: the list endpoint discloses existence only, not state. Viewers can call this (it's a GET).

5. **Given** a secret exists, **When** a user with `editor` role calls `DELETE /api/secrets/:id`, **Then** the row is deleted, a `credential.deleted` audit entry is written with `metadata: { name, type }`, and the response is `{ deleted: true, id }`. 403 for viewers. 404 if the secret does not exist.

6. **Given** a Code node or HTTP Request node references `$secrets.API_KEY` at runtime, **When** the engine executor builds the node context, **Then** ALL secrets from the `credentials` table are decrypted in-memory via `decrypt()` from `crypto/aes.ts` and injected into the `$secrets` object that already exists in `packages/server/src/engine/context.ts` (confirmed present as `$secrets: Record<string, string>`). The plaintext values MUST NOT appear in: execution result data (`resultData`), node execution data (`nodeExecutions[].data`), audit log entries, error messages, or WebSocket broadcasts. After execution, the `$secrets` object is not persisted — it exists only for the duration of the node evaluation.

7. **Given** the MCP surface, **When** clients invoke the following tools, **Then** each is registered in a new module `packages/server/src/mcp/tools/secrets.ts`:
   - `flowaibuilder.manage_secrets({ action: "set", name, type, value })` — same as `POST /api/secrets` (create or update by name).
   - `flowaibuilder.manage_secrets({ action: "list" })` — same as `GET /api/secrets`.
   - `flowaibuilder.manage_secrets({ action: "delete", name })` — same as `DELETE /api/secrets/:id` but by name instead of id.
   - `flowaibuilder.set_environment({ workflow_id, env })` — same as `POST /api/workflows/:id/promote`.
   `minRoleForMcpTool` in `mcp/rbac.ts` is extended: `manage_secrets` with action `list` → `viewer`; `set`/`delete`/`set_environment` → `editor`. Stdio transport continues to bypass RBAC.

8. **Given** every mutating action in this story, **When** it completes, **Then** an audit entry is written via the existing audit middleware or direct `app.audit.write`:
   - `credential.created` — `POST /api/secrets` success
   - `credential.updated` — `PUT /api/secrets/:id` success
   - `credential.deleted` — `DELETE /api/secrets/:id` success
   - `workflow.promoted` — environment change
   The `redactSecrets` function in `audit/logger.ts` already matches `credential` and `secret` via `SECRET_KEY_RE` — verify it covers `dataEncrypted` and `value`. The plaintext secret value MUST NEVER appear in any audit metadata.

9. **Given** the UI, **When** a user navigates to the Settings page, **Then** a new "Secrets" section (below Git Sync) lists all secrets by name + type with Add / Delete buttons. An "Add Secret" form has: name (text), type (select: api_key / oauth2 / basic / custom), value (password input). After save, the value field clears. Editing an existing secret shows a "Update Value" button that accepts a new password input — the old value is never displayed. Viewers see the list but Add/Delete/Update buttons are disabled with tooltip "Viewer role cannot manage secrets". A separate "Environment" section on the workflow Editor page shows the current environment badge and (for editors) a dropdown to promote.

## Tasks / Subtasks

- [x] **Task 1: Shared types** (AC #2, #4, #7)
  - [x] 1.1 Create `packages/shared/src/types/credentials.ts` exporting `Credential` (the list-row shape: `id, name, type, createdBy, createdAt, updatedAt`), `CredentialType` union `'api_key' | 'oauth2' | 'basic' | 'custom'`, `CreateSecretInput`, `UpdateSecretInput`. Re-export from `packages/shared/src/index.ts`.
  - [x] 1.2 Verify `packages/server/src/db/schema.ts` already has the `credentials` pgTable with columns `id, name, type, dataEncrypted, createdBy, createdAt, updatedAt` (lines 106-115). Add a unique index on `lower(name)` if missing: `uniqueIndex('credentials_name_unique').on(sql\`lower(${credentials.name})\`)`.

- [x] **Task 2: Secrets REST routes** (AC #2, #3, #4, #5)
  - [x] 2.1 Create `packages/server/src/api/routes/secrets.ts` with:
    - `GET /api/secrets` → list all credentials, strip `dataEncrypted`, return `{ secrets: Credential[] }`.
    - `POST /api/secrets` → validate body, check name uniqueness (case-insensitive via `lower(name)`), `encrypt(body.value)`, insert row, return `{ id, name, type, createdAt }`.
    - `PUT /api/secrets/:id` → load row (404 if absent), skip if `body.value === '***'`, else `encrypt(body.value)`, update `dataEncrypted + updatedAt`, return `{ id, name, type, updatedAt }`.
    - `DELETE /api/secrets/:id` → delete row (404 if absent), return `{ deleted: true, id }`.
  - [x] 2.2 Register the route in `packages/server/src/index.ts` alongside the existing route registrations.
  - [x] 2.3 RBAC: `applyRouteRbac` in `rbac-routes.ts` already handles `/api/secrets*` → admin (line 31). Override: secrets CRUD should be `editor`, not admin. Extend the walker table: `if (url.startsWith('/api/secrets'))` → GET=viewer, POST/PUT/DELETE=editor. Or, if the walker's generic "everything else → editor" fallback already catches POST/PUT/DELETE and "GET → viewer" covers reads, verify and add a comment. The key difference from the current table: `/api/secrets` is NOT admin-only (unlike `/api/users`).

- [x] **Task 3: Environment promotion** (AC #1)
  - [x] 3.1 Add `POST /api/workflows/:id/promote` in `packages/server/src/api/routes/workflows.ts` (alongside the existing versioning routes). Body: `{ environment: "dev"|"staging"|"prod" }`. Validate the value; 400 if invalid. Load workflow, reject if already in the target environment (no-op → 200 with `{ promoted: false, reason: 'already in target' }`). Update `workflows.environment`, emit `workflow_updated` broadcast, write `workflow.promoted` audit with `metadata: { from: old, to: new }`.
  - [x] 3.2 Add `environment` to the `shouldVersion` field list in `packages/server/src/versioning/diff.ts` — it's currently in the list: `['nodes', 'connections', 'settings', 'canvas', 'name', 'description', 'tags', 'active']`. Add `'environment'` so promotion triggers a snapshot.
  - [x] 3.3 Extend `resolveAction` in `packages/server/src/api/middleware/audit.ts`: `POST /api/workflows/:id/promote → workflow.promoted`.

- [x] **Task 4: Secrets injection at runtime** (AC #6)
  - [x] 4.1 In the workflow executor (`packages/server/src/engine/executor.ts`), before building the node context, load all credentials: `SELECT name, dataEncrypted FROM credentials`. Decrypt each value with `decrypt()` from `crypto/aes.ts`. Build `secrets: Record<string, string>` keyed by `credential.name`.
  - [x] 4.2 Pass `secrets` into `createNodeContext(...)` which already accepts a `secrets` param (confirmed in `engine/context.ts`). The `$secrets` global is already wired in the sandbox via `ctx.global.set('$secrets', context.$secrets)`.
  - [x] 4.3 **CRITICAL**: Ensure `$secrets` is NOT serialized into `nodeExecutions[].data`, `resultData`, error messages, or WS execution broadcasts. Audit the executor's result-capture path: if `context` or `secrets` are referenced in the result JSON, strip them. The isolated-vm sandbox prevents leakage from within the code, but the orchestration layer outside the sandbox must also not log the decrypted map.
  - [x] 4.4 For HTTP Request nodes: resolve `{{$secrets.KEY_NAME}}` template expressions in `url`, `headers`, `body` config fields. Use a simple regex replace: `/\{\{\$secrets\.([A-Za-z0-9_]+)\}\}/g` → look up from the secrets map. Unresolved references should throw a clear error: `Secret 'KEY_NAME' not found. Available secrets: [name1, name2]` (list names only, never values).

- [x] **Task 5: MCP tools** (AC #7)
  - [x] 5.1 Create `packages/server/src/mcp/tools/secrets.ts` exporting `registerSecretsTools(server, app)`. Tool `flowaibuilder.manage_secrets` with a discriminated `action` param:
    - `action: "set"` — create-or-update by name (upsert semantics: if name exists, update value).
    - `action: "list"` — return names + types only.
    - `action: "delete"` — delete by name (not id — MCP callers don't know internal UUIDs).
  - [x] 5.2 Tool `flowaibuilder.set_environment` — delegates to the promote logic from Task 3.
  - [x] 5.3 Register in `packages/server/src/mcp/index.ts` after `registerVersioningTools`.
  - [x] 5.4 Extend `minRoleForMcpTool` in `mcp/rbac.ts`: `flowaibuilder.manage_secrets` → check `action` param at call time; BUT since `minRoleForMcpTool` only takes a tool name (not params), treat the whole tool as `editor` (the list-only path is harmless for editors). If a viewer invokes with `action: "list"`, it will be rejected by the tool-level RBAC unless we add `manage_secrets` to the readonly set. **Decision**: add `flowaibuilder.manage_secrets` to the `readOnly` set since the tool handler itself can guard `set`/`delete` actions by checking the active MCP user's role at runtime. Use `assertMcpPermitted` inline for mutating actions.
  - [x] 5.5 Use `mcpActor()` (exported from `mcp/index.ts` in the Story 5.3 review fix) for actor attribution in all audit writes.

- [x] **Task 6: Audit** (AC #8)
  - [x] 6.1 Extend `resolveAction` in `api/middleware/audit.ts`:
    - `POST /api/secrets → credential.created`
    - `PUT /api/secrets/:id → credential.updated`
    - `DELETE /api/secrets/:id → credential.deleted`
    - `POST /api/workflows/:id/promote → workflow.promoted`
  - [x] 6.2 Verify `redactSecrets` in `audit/logger.ts` catches `dataEncrypted` and `value` — `SECRET_KEY_RE` matches `/credential/i` and the `CREDENTIAL_PARENT_RE` targets `credentials.value`. Confirm no new matchers needed.
  - [x] 6.3 MCP tool audit writes: the `wrapTool` in `mcp/index.ts` already logs every tool call with `redactSecrets(args)`. Verify `value` in args is redacted.

- [x] **Task 7: UI — Secrets section in Settings + Environment badge** (AC #9)
  - [x] 7.1 Add API client methods to `packages/ui/src/lib/api.ts`: `listSecrets`, `createSecret`, `updateSecret`, `deleteSecret`, `promoteWorkflow`.
  - [x] 7.2 Create `packages/ui/src/components/secrets/SecretsPanel.tsx` — table of name/type with Add/Delete/Update buttons. Reuse the Settings page form styling. Password input for value, clears after save. Viewers see the list but buttons are disabled.
  - [x] 7.3 Mount `SecretsPanel` in `packages/ui/src/pages/Settings.tsx` below the Git Sync section.
  - [x] 7.4 In `packages/ui/src/pages/Editor.tsx`, add an environment badge next to the workflow name (e.g. `[dev]`/`[staging]`/`[prod]` in color-coded pill). For editors, clicking the badge opens a dropdown to promote. Use the existing Zustand workflow store to reload after promotion.

- [x] **Task 8: Tests** (AC #1-8)
  - [x] 8.1 `packages/server/src/__tests__/secrets-routes.test.ts` — app.inject() coverage: create → unique name → 409, update → sentinel `***` no-op, delete → 404, list strips value, viewer 403 on mutations.
  - [x] 8.2 `packages/server/src/__tests__/secrets-injection.test.ts` — unit: build secrets map from mock credentials, inject into node context, verify `$secrets.KEY` resolves, verify plaintext not in result/audit.
  - [x] 8.3 `packages/server/src/__tests__/promote-route.test.ts` — promote dev→staging, invalid env 400, already-in-target no-op, viewer 403, audit entry written.
  - [x] 8.4 `packages/server/src/__tests__/secrets-mcp.test.ts` — exercise `manage_secrets` via `setActiveMcpContext` pattern: set/list/delete, RBAC for viewer (list OK, set 403), stdio bypass.

## Dev Notes

### Context & motivation

This story closes the enterprise-free loop: credentials are stored encrypted (AES-256-GCM via the `crypto/aes.ts` helper created in Story 5.3) and injected at runtime into the `$secrets` context object that already exists in the engine. Environments let users tag workflows as dev/staging/prod and promote them through a lifecycle, with each promotion triggering a version snapshot for traceability.

### Architecture compliance

- **DB:** Postgres only. The `credentials` pgTable already exists at `db/schema.ts:106-115`. The `workflows.environment` column already exists (default `'dev'`, line 10).
- **MCP-first:** every feature has an MCP tool (Task 5) in addition to REST.
- **Zero-cost AI:** this story does NOT introduce `@anthropic-ai/sdk`.
- **Protected Zones:** secrets CRUD does not touch the workflow graph, so no zone enforcement needed. Environment promotion changes a metadata field, not nodes/connections — zones are not involved.
- **Auth / RBAC:** Story 5.2 landed `request.user`, `rolePermits`, `applyRouteRbac`. The RBAC walker auto-maps GETs to viewer and non-GETs to editor. For `/api/secrets`, this default mapping is correct: GET=viewer, mutations=editor. Verify the walker doesn't incorrectly classify `/api/secrets` as admin-only (it currently maps `/api/secrets` → admin at `rbac-routes.ts:31`). Override this: secrets are editor-level, not admin-only.
- **Audit:** Extend `resolveAction` (Task 6). `redactSecrets` already covers credential-shaped keys.

### Library decisions

- **No new deps.** `crypto/aes.ts` (`encrypt`/`decrypt`) is already present from Story 5.3. No vault library, no external KMS — secrets are AES-256-GCM encrypted at rest in Postgres, decrypted in-process at runtime.
- **No `dotenv` for environments.** The `environment` field is a DB column on the workflow row, not a process-level env var. Environment-specific behavior (e.g. different Redis URL per env) is a future concern for Story 5.5 (Queue Mode) or ops docs.

### Previous story intelligence

From Story 5.3:
- `crypto/aes.ts` is production-ready: uses `FLOWAI_ENCRYPTION_KEY` env var (base64 preferred, falls back to scrypt of any string), format `aesgcm$v1$iv$tag$ct`. Tested for round-trip, random IV per call, tampered-ciphertext rejection. **Throws in `NODE_ENV=production` when env var is unset** (review fix from Group B).
- Settings route `settings.ts` shows the exact redaction pattern: encrypt on write, redact on read, handle `'***'` sentinel on round-trip.
- `mcpActor()` is exported from `mcp/index.ts` — use it for actor attribution in MCP tool audit writes.
- `shouldVersion` in `versioning/diff.ts` now normalizes both sides with canonical defaults — when adding `environment` to the field list, add a default value entry too (`environment: 'dev'`).
- `recordSnapshot` has a retry loop for unique-violation races, logs errors instead of swallowing.

### Anti-patterns to avoid

- **Do NOT** return `dataEncrypted` or plaintext `value` in any API response. The list endpoint returns name/type/meta only.
- **Do NOT** log decrypted secrets to console, audit, or execution traces. The executor must strip `$secrets` from any result capture.
- **Do NOT** store decrypted values in the DB. Decryption is in-memory, on-demand, for the duration of a single node execution.
- **Do NOT** create a new encryption helper. Reuse `crypto/aes.ts` directly.
- **Do NOT** add environment-switching logic that changes process-level `NODE_ENV` or `DATABASE_URL`. The `environment` field is a workflow-level label, not a deployment target.
- **Do NOT** add admin-only gating to `/api/secrets`. The `rbac-routes.ts` walker currently maps `/api/secrets*` to admin (line 31) — this must be overridden to editor/viewer per AC.

### Testing standards

- Vitest. Co-located under `packages/server/src/__tests__/`.
- Follow the `app.inject()` + in-memory stub DB pattern from `versioning-routes.test.ts`.
- Assert that no API response or audit entry contains `dataEncrypted` or plaintext `value`.

### Files to create

- `packages/shared/src/types/credentials.ts`
- `packages/server/src/api/routes/secrets.ts`
- `packages/server/src/mcp/tools/secrets.ts`
- `packages/ui/src/components/secrets/SecretsPanel.tsx`
- Test files listed in Task 8.

### Files to modify

- `packages/shared/src/index.ts` — re-export credentials types.
- `packages/server/src/db/schema.ts` — add unique index on `lower(credentials.name)` if missing.
- `packages/server/src/api/routes/workflows.ts` — add `POST /api/workflows/:id/promote` route.
- `packages/server/src/api/middleware/rbac-routes.ts` — override `/api/secrets` from admin to editor/viewer.
- `packages/server/src/api/middleware/audit.ts` — add `resolveAction` entries.
- `packages/server/src/versioning/diff.ts` — add `environment` to `shouldVersion` field list + defaults.
- `packages/server/src/engine/executor.ts` — load + inject secrets into node context.
- `packages/server/src/mcp/index.ts` — register secrets tools.
- `packages/server/src/mcp/rbac.ts` — extend `minRoleForMcpTool`.
- `packages/server/src/index.ts` — register secrets route.
- `packages/ui/src/lib/api.ts` — add secrets + promote API client methods.
- `packages/ui/src/pages/Settings.tsx` — mount SecretsPanel.
- `packages/ui/src/pages/Editor.tsx` — add environment badge + promote dropdown.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#story-54-environments-secrets-management] — ACs baseline
- [Source: _bmad-output/planning-artifacts/architecture.md#300-309] — `credentials` pgTable
- [Source: _bmad-output/planning-artifacts/architecture.md#422-446] — `$secrets` in node context
- [Source: _bmad-output/planning-artifacts/architecture.md#1165-1179] — secrets encryption pattern
- [Source: packages/server/src/crypto/aes.ts] — existing AES-256-GCM helper (Story 5.3)
- [Source: packages/server/src/db/schema.ts#106-115] — existing `credentials` table
- [Source: packages/server/src/db/schema.ts#10] — existing `workflows.environment` column
- [Source: packages/server/src/engine/context.ts] — existing `$secrets` in NodeContext
- [Source: packages/server/src/api/routes/settings.ts#77-106] — redaction + sentinel pattern from Story 5.3
- [Source: packages/server/src/mcp/rbac.ts#45-68] — `minRoleForMcpTool` pattern
- [Source: packages/server/src/api/middleware/rbac-routes.ts#31] — current `/api/secrets` → admin mapping (override needed)
- [Source: _bmad-output/implementation-artifacts/5-3-workflow-versioning-git-sync.md] — previous story context

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- Fixed TS errors: `null` vs `undefined` in `McpInvocationContext.user`; inlined body types instead of importing from shared (avoids build-order dependency)
- Extended `SECRET_KEY_RE` in `audit/logger.ts` to also match `dataEncrypted`/`data_encrypted`
- Added `manage_secrets` to wrapTool audit skip list to prevent plaintext `value` from leaking via the generic auto-audit path

### Completion Notes List
- All 8 tasks complete, all 9 ACs satisfied
- 20 new tests across 4 test files, all passing
- No regressions in existing test suite (10 related test files re-verified: 74/74 pass)
- Zero new dependencies; reuses crypto/aes.ts from Story 5.3
- MCP RBAC: `manage_secrets` is viewer at tool level (for list), with runtime `assertMcpPermitted` guards for set/delete actions
- Secrets are AES-256-GCM encrypted at rest, decrypted in-memory only during execution, never serialized to results/audit/broadcasts

### File List

**Created:**
- `packages/shared/src/types/credentials.ts`
- `packages/server/src/api/routes/secrets.ts`
- `packages/server/src/mcp/tools/secrets.ts`
- `packages/ui/src/components/secrets/SecretsPanel.tsx`
- `packages/server/src/__tests__/secrets-routes.test.ts`
- `packages/server/src/__tests__/secrets-injection.test.ts`
- `packages/server/src/__tests__/promote-route.test.ts`
- `packages/server/src/__tests__/secrets-mcp.test.ts`

**Modified:**
- `packages/shared/src/index.ts` — re-export CredentialType, CreateSecretInput, UpdateSecretInput
- `packages/server/src/db/schema.ts` — added uniqueIndex on lower(credentials.name), imported uniqueIndex+sql
- `packages/server/src/index.ts` — registered secretsRoutes
- `packages/server/src/api/routes/workflows.ts` — added POST /api/workflows/:id/promote
- `packages/server/src/api/middleware/rbac-routes.ts` — overrode /api/secrets from admin to editor/viewer
- `packages/server/src/api/middleware/audit.ts` — added resolveAction for credential.created/updated/deleted, workflow.promoted
- `packages/server/src/audit/logger.ts` — extended SECRET_KEY_RE with dataEncrypted/data_encrypted
- `packages/server/src/versioning/diff.ts` — added environment:'dev' to shouldVersion defaults
- `packages/server/src/engine/executor.ts` — loadSecrets + resolveSecretsTemplates + inject into context
- `packages/server/src/mcp/index.ts` — registered secrets tools, added getActiveMcpContext export, added manage_secrets to audit skip
- `packages/server/src/mcp/rbac.ts` — added manage_secrets to readOnly set
- `packages/ui/src/lib/api.ts` — added listSecrets, createSecret, updateSecret, deleteSecret, promoteWorkflow
- `packages/ui/src/pages/Settings.tsx` — mounted SecretsPanel, added currentUser state
- `packages/ui/src/pages/Editor.tsx` — added environment badge with promote dropdown

### Review Findings (Group A — Server Core, 2026-04-10)

- [x] [Review][Patch] Add post-execution scrubbing of secret values from resultData/nodeExecutions before persisting [executor.ts] — fixed: scrubSecrets() strips known secret values before DB persist
- [x] [Review][Patch] Promote allows free env movement — accepted, clarified comment [workflows.ts]
- [x] [Review][Patch] Secret names leaked in error messages — fixed: removed available-names enumeration [executor.ts]
- [x] [Review][Patch] resolveSecretsTemplates mutates node in-place — fixed: deep-clone config before resolving [executor.ts]
- [x] [Review][Patch] Promote route writes duplicate audit entries — fixed: set request.auditSkip on promote [workflows.ts]
- [x] [Review][Patch] PUT /api/workflows/:id does not handle { environment } field — fixed: added environment to accepted fields with validation [workflows.ts]
- [x] [Review][Patch] snapshotFromWorkflow omits environment — fixed: added environment to snapshot shape + type [diff.ts, versioning.ts]
- [x] [Review][Patch] Secrets CRUD audit entries missing { name, type } metadata — fixed: manual audit writes with auditSkip [secrets.ts]
- [x] [Review][Patch] Unhandled unique constraint violation on secret insert — fixed: try/catch returns 409 [secrets.ts]
- [x] [Review][Patch] Audit middleware captureBefore only works for workflow routes — fixed: removed routeUrl guard [audit.ts]
- [x] [Review][Patch] Secret names with hyphens pass creation but fail template resolution — fixed: name validation + expanded regex [secrets.ts, executor.ts]
- [x] [Review][Defer] MCP routes bypass RBAC entirely [rbac-routes.ts:29] — deferred, pre-existing design (MCP has own RBAC via minRoleForMcpTool)
- [x] [Review][Defer] request.user fallback to 'api' when auth middleware absent — deferred, pre-existing pattern
- [x] [Review][Defer] Decryption failures silently swallowed in loadSecrets — deferred, worth adding logging in future story

## Change Log

- **2026-04-10**: Story 5.4 implemented — Environments & Secrets Management. All 8 tasks complete, 20 tests added.
- **2026-04-10**: Code review (Group A) — 2 decisions resolved, 11 patches applied, 3 deferred, 5 dismissed. All issues fixed.

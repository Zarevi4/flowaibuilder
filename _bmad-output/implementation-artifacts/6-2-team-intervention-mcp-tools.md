# Story 6.2: Team Intervention MCP Tools

Status: done

## Story

As a human overseeing Agent Teams,
I want to send messages to agents, reassign tasks, and link tasks to workflow nodes,
so that I can steer the team and connect their work to the visual canvas.

## Acceptance Criteria

1. **Given** a team is being watched **When** I call `flowaibuilder.send_team_message({ team_name, to_agent, message })` **Then** the message is appended to the agent's inbox JSON file at `~/.claude/teams/<teamName>/inboxes/<agent>.json` **And** the message has from: "human", timestamp, and read: false

2. **Given** a team has tasks **When** I call `flowaibuilder.update_task({ team_name, task_id, changes })` **Then** the task in tasks.json is updated with the specified changes (status, assignee, blockers)

3. **Given** a team exists **When** I call `flowaibuilder.add_task({ team_name, task })` **Then** a new task with generated ID and status "unassigned" is appended to tasks.json

4. **Given** a task and a workflow node **When** I call `flowaibuilder.link_task_to_node({ team_name, task_id, workflow_id, node_id })` **Then** the mapping is stored in the DB **And** a `task_linked_to_node` event is broadcast via WebSocket

## Tasks / Subtasks

- [x] Task 1: Add `taskNodeLinks` DB table and shared types (AC: #4)
  - [x] 1.1 Add `taskNodeLinks` table to `packages/server/src/db/schema.ts` — columns: `id` (uuid PK), `teamName` (text), `taskId` (text), `workflowId` (uuid, FK→workflows.id), `nodeId` (text), `createdAt` (timestamp)
  - [x] 1.2 Add `TaskNodeLink` interface to `packages/shared/src/types/agent-teams.ts`
  - [x] 1.3 Add `task_linked_to_node` to `WebSocketEventType` in `packages/shared/src/types/mcp.ts`
  - [x] 1.4 Re-export new types from `packages/shared/src/index.ts`

- [x] Task 2: Add file-writing helper to parser (AC: #1, #2, #3)
  - [x] 2.1 Add `writeTasksFile(filePath: string, tasks: TeamTask[]): Promise<void>` to `packages/server/src/agent-teams/parser.ts` — atomically writes JSON (write to `.tmp`, rename)
  - [x] 2.2 Add `appendToInbox(filePath: string, message: InboxMessage): Promise<void>` to `packages/server/src/agent-teams/parser.ts` — reads existing array, pushes new message, writes back atomically
  - [x] 2.3 Add `generateId(): string` utility to parser — `crypto.randomUUID()` or similar

- [x] Task 3: Register 4 MCP tools (AC: #1, #2, #3, #4)
  - [x] 3.1 Add `flowaibuilder.send_team_message` tool to `packages/server/src/mcp/tools/agent-teams.ts`:
    - Params: `{ team_name: string, to_agent: string, message: string }`
    - Validate names, check team is being watched
    - Build `InboxMessage` with `from: "human"`, `read: false`, current timestamp
    - Call `appendToInbox()` to write to `~/.claude/teams/<teamName>/inboxes/<to_agent>.json`
    - Return the created message
  - [x] 3.2 Add `flowaibuilder.update_task` tool:
    - Params: `{ team_name: string, task_id: string, changes: { status?, assignee?, blockers? } }`
    - Validate name, read tasks.json via `parseTasksFile()`, find task by ID
    - Apply changes (only specified fields), update `updatedAt`
    - Write back via `writeTasksFile()`
    - Return updated task
  - [x] 3.3 Add `flowaibuilder.add_task` tool:
    - Params: `{ team_name: string, task: { title: string, assignee?: string } }`
    - Generate ID, set status "unassigned" (or "assigned" if assignee provided), set timestamps
    - Read existing tasks, append, write back via `writeTasksFile()`
    - Return the created task
  - [x] 3.4 Add `flowaibuilder.link_task_to_node` tool:
    - Params: `{ team_name: string, task_id: string, workflow_id: string, node_id: string }`
    - Validate: team is watched, task exists in tasks.json, workflow exists in DB, node exists in workflow's nodes array
    - Insert row into `taskNodeLinks` table via Drizzle
    - Broadcast `task_linked_to_node` event via WebSocket
    - Return the created link

- [x] Task 4: Tests (all ACs)
  - [x] 4.1 Unit test parser write functions — `writeTasksFile` atomic write, `appendToInbox` appends correctly, handles missing file (creates new)
  - [x] 4.2 Unit test `send_team_message` — creates correct inbox message with from:"human", read:false, validates name
  - [x] 4.3 Unit test `update_task` — updates specified fields only, returns error for missing task_id
  - [x] 4.4 Unit test `add_task` — generates ID, sets status, appends to existing tasks
  - [x] 4.5 Unit test `link_task_to_node` — inserts DB row, broadcasts event, validates task/workflow/node exist
  - [x] 4.6 Integration test — full flow: add task → update task → link to node → verify DB and broadcast

### Review Findings

- [x] [Review][Patch] `validateName` duplicated in agent-teams.ts instead of imported from watcher.ts — FIXED
- [x] [Review][Patch] `validateName` throws instead of returning `isError: true` — FIXED (all 7 tools now use safeValidateName + mcpError)
- [x] [Review][Patch] No unique constraint on `taskNodeLinks` for (teamName, taskId, workflowId, nodeId) — FIXED
- [x] [Review][Patch] No `onDelete` cascade on `taskNodeLinks.workflowId` FK — FIXED (cascade delete)
- [x] [Review][Patch] `workflow_id` param should be `z.string().uuid()` not `z.string()` in link_task_to_node — FIXED
- [x] [Review][Patch] `workflowId` and `createdAt` missing `.notNull()` in taskNodeLinks schema — FIXED
- [x] [Review][Defer] Race condition in read-modify-write (appendToInbox/writeTasksFile) — accepted per dev notes, no file locking in Node.js
- [x] [Review][Defer] `generateId` uses 8 hex chars (32 bits entropy) — low practical risk for agent team scale
- [x] [Review][Defer] No cleanup of `taskNodeLinks` when nodes are deleted — address in future story

## Dev Notes

### Server-Only Story

This is server-only — no UI code. The UI for these tools comes in Story 6.3 (Team Dashboard UI).

### Existing Agent Teams Code (from Story 6.1)

Story 6.1 built the foundation you MUST reuse:

**Watcher** (`packages/server/src/agent-teams/watcher.ts`):
- `validateName(name, label)` — reuse for input validation (rejects `..`, `/`, `\`)
- `watch(teamName)` / `isWatching(teamName)` — check team is watched before intervention
- `getTeamDir(teamName)` — resolves `~/.claude/teams/<teamName>` using `os.homedir()`
- `getSnapshot(teamName)` — get current team state

**Parser** (`packages/server/src/agent-teams/parser.ts`):
- `parseTasksFile(filePath)` → `TeamTask[]` — reads and validates with zod
- `parseInboxFile(filePath)` → `InboxMessage[]` — reads and validates with zod
- Zod schemas: `TaskSchema`, `InboxMessageSchema` — reuse for validation
- Uses `z.safeParse()` for resilient parsing

**Singleton** (`packages/server/src/agent-teams/index.ts`):
- `getTeamWatcher()` — get the singleton instance

**MCP tools** (`packages/server/src/mcp/tools/agent-teams.ts`):
- `registerAgentTeamTools(server)` — add the 4 new tools HERE, alongside existing 3
- Pattern: `server.tool(name, zodSchema, asyncHandler)` → returns `{ content: [{ type: 'text', text: JSON.stringify(...) }] }`
- `validateName()` is called at the start of each tool handler

**Broadcaster** (`packages/server/src/api/ws/broadcaster.ts`):
- `getBroadcaster()?.broadcast(type, workflowId, data)` — `workflowId` is `''` for agent-team events

### File Write Safety

The existing parser only reads files. This story adds write capabilities. Critical safety requirements:

1. **Atomic writes**: Write to a `.tmp` file, then `fs.rename()` — prevents corruption if process crashes mid-write
2. **Debounce awareness**: The watcher debounces file changes at 100ms. Your writes WILL trigger watcher events — this is expected and correct (the watcher will broadcast the update to connected UI clients)
3. **No file locking**: Node.js doesn't provide file locking. Since only one server process runs and writes are atomic, this is acceptable
4. **Create missing files**: If `inboxes/<agent>.json` doesn't exist, create it with `[newMessage]`. If `tasks.json` doesn't exist, create it with `[newTask]`
5. **Preserve existing data**: Always read → modify → write. Never overwrite blindly

### Atomic Write Pattern

```typescript
import { writeFile, rename } from 'fs/promises';

async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const tmpPath = filePath + '.tmp';
  await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  await rename(tmpPath, filePath);
}
```

### Task ID Generation

Use `crypto.randomUUID()` (built into Node.js 19+, available in our runtime). Prefix with `task-` for readability:

```typescript
import { randomUUID } from 'crypto';
const taskId = `task-${randomUUID().slice(0, 8)}`;
```

### `link_task_to_node` — DB Table Required

This is the only tool that touches the database. The AC says "mapping is stored in the DB". Add a new Drizzle table:

```typescript
// packages/server/src/db/schema.ts
export const taskNodeLinks = pgTable('task_node_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  teamName: text('team_name').notNull(),
  taskId: text('task_id').notNull(),
  workflowId: uuid('workflow_id').references(() => workflows.id),
  nodeId: text('node_id').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});
```

**Validation for link_task_to_node**:
1. Verify team is being watched (`watcher.isWatching(teamName)`)
2. Verify task exists in `tasks.json` (read and find by ID)
3. Verify workflow exists in DB (`SELECT * FROM workflows WHERE id = workflow_id`)
4. Verify node exists in the workflow's `nodes` JSON array
5. If any validation fails, return descriptive error text (not a throw — MCP tools return error text)

**DB access pattern**: Import `db` from the existing database module. See how existing MCP tools in `packages/server/src/mcp/index.ts` access the DB — follow the same pattern.

### DB Access in MCP Tools

The existing MCP tools in `mcp/index.ts` access the database. Check how `db` is imported/accessed there and follow the same pattern for the `link_task_to_node` tool. The database singleton is typically imported from `packages/server/src/db/index.ts`.

### WebSocket Event for link_task_to_node

Add `task_linked_to_node` to the `WebSocketEventType` union in `packages/shared/src/types/mcp.ts`. Broadcast format:

```typescript
getBroadcaster()?.broadcast('task_linked_to_node', workflow_id, {
  teamName: team_name,
  taskId: task_id,
  workflowId: workflow_id,
  nodeId: node_id,
});
```

Note: Use `workflow_id` (not empty string) as the second arg here since this event IS workflow-specific.

### MCP Tool Error Pattern

When validation fails, return an error response (don't throw):

```typescript
return {
  content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Task not found', task_id }) }],
  isError: true,
};
```

### Shared Types Addition

```typescript
// Add to packages/shared/src/types/agent-teams.ts
export interface TaskNodeLink {
  id: string;
  teamName: string;
  taskId: string;
  workflowId: string;
  nodeId: string;
  createdAt: string;
}
```

### update_task — Partial Update Logic

The `changes` param should only update specified fields. Pattern:

```typescript
const allowedFields = ['status', 'assignee', 'blockers'] as const;
for (const field of allowedFields) {
  if (field in changes) {
    task[field] = changes[field];
  }
}
task.updatedAt = new Date().toISOString();
```

Validate `status` values against the enum: `'unassigned' | 'assigned' | 'in-progress' | 'blocked' | 'done'`.

### "Team Must Be Watched" Requirement

AC1 says "Given a team is being watched". For `send_team_message`, `update_task`, and `add_task`, check `watcher.isWatching(teamName)`. If not watched, return an error guiding the user to call `watch_team` first.

For `add_task` (AC3), the AC says "Given a team exists" — this is more lenient. The team directory must exist but doesn't need to be watched. Use `getTeamDir()` + `fs.access()` to check directory existence.

### What NOT to Do

- Do NOT add any UI code — this story is server-only
- Do NOT add REST API endpoints — MCP-first per architecture
- Do NOT create a new MCP tool file — add tools to the existing `packages/server/src/mcp/tools/agent-teams.ts`
- Do NOT import `@anthropic-ai/sdk` — zero-cost AI model principle
- Do NOT use `chokidar` or file-watching libraries — not needed (watcher already exists from 6.1)
- Do NOT modify the existing 3 read-only MCP tools from Story 6.1
- Do NOT add `unwatch_team` or `stop_watching` tools (not in ACs)
- Do NOT duplicate the `validateName` function — import it from watcher.ts or extract to a shared util
- Do NOT use `fs.writeFileSync` — use async `writeFile` + `rename` for atomic writes
- Do NOT skip validation on `link_task_to_node` — must verify task, workflow, and node all exist
- Do NOT add inbox directory creation logic — if the `inboxes/` dir doesn't exist, `mkdir` it (the dir may not exist if no agent has sent messages yet)

### Previous Story Intelligence

From Story 6.1 (direct prerequisite):
- **Path traversal fix**: `validateName()` was added during code review to prevent `../` attacks. Already exists in `watcher.ts` — reuse it
- **Re-watch idempotency**: Duplicate `watch()` calls now re-attach watchers correctly
- **Async error handling**: `.catch()` on debounce promises was a review finding — apply same care to write operations
- **Zod safeParse**: Parser uses `z.safeParse()` for resilience — invalid entries are skipped with warnings, not crashes. Follow this pattern for incoming `changes` in `update_task`
- **Singleton cleanup**: `createTeamWatcher()` now calls `closeAll()` before re-init — no changes needed here
- **Test count**: 44 server tests passing (24 from 6.1 + 20 pre-existing). 36 UI test failures are pre-existing and unrelated
- **Deferred**: `broadcast()` sends to all clients (no team-level subscription filter) — accepted, will address in 6.3

### Project Structure Notes

- All paths align with the unified project structure in CLAUDE.md
- Modified files: `packages/server/src/mcp/tools/agent-teams.ts` (add 4 tools), `packages/server/src/agent-teams/parser.ts` (add write functions), `packages/server/src/db/schema.ts` (add table), `packages/shared/src/types/agent-teams.ts` (add TaskNodeLink), `packages/shared/src/types/mcp.ts` (add event type), `packages/shared/src/index.ts` (re-export)
- New test files: `packages/server/src/__tests__/agent-teams-intervention.test.ts`
- No new directories needed — all code goes in existing locations

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.2] — Acceptance criteria
- [Source: packages/server/src/mcp/tools/agent-teams.ts] — Existing MCP tool registration (3 read-only tools)
- [Source: packages/server/src/agent-teams/watcher.ts] — TeamFileWatcher with validateName, isWatching, getTeamDir
- [Source: packages/server/src/agent-teams/parser.ts] — parseTasksFile, parseInboxFile, zod schemas
- [Source: packages/server/src/db/schema.ts] — Current DB tables (no taskNodeLinks yet)
- [Source: packages/server/src/api/ws/broadcaster.ts] — broadcast(type, workflowId, data)
- [Source: packages/shared/src/types/agent-teams.ts] — InboxMessage, TeamTask, AgentInfo, TeamSnapshot
- [Source: packages/shared/src/types/mcp.ts] — WebSocketEventType union
- [Source: 6-1-agent-teams-file-watcher-read-mcp-tools.md] — Previous story learnings and review findings
- [Source: CLAUDE.md] — MCP-first, zero-cost AI model, file-based Agent Teams integration

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
None — clean implementation, no debugging required.

### Completion Notes List
- Added `taskNodeLinks` DB table with uuid PK, FK to workflows
- Added `TaskNodeLink` interface and `task_linked_to_node` WS event type to shared types
- Implemented atomic write helpers: `writeTasksFile`, `appendToInbox`, `generateId` in parser.ts
- Registered 4 MCP tools: `send_team_message`, `update_task`, `add_task`, `link_task_to_node`
- All tools follow existing error pattern (return `isError: true` on validation failure)
- `send_team_message`/`update_task` require team to be watched; `add_task` only requires team dir to exist (per AC)
- `link_task_to_node` validates task, workflow, and node existence before DB insert
- 18 new tests added (62 total server tests, 0 regressions)

### File List
- `packages/server/src/db/schema.ts` — added `taskNodeLinks` table
- `packages/shared/src/types/agent-teams.ts` — added `TaskNodeLink` interface
- `packages/shared/src/types/mcp.ts` — added `task_linked_to_node` to `WebSocketEventType`
- `packages/shared/src/index.ts` — re-exported `TaskNodeLink`
- `packages/server/src/agent-teams/parser.ts` — added `writeTasksFile`, `appendToInbox`, `generateId`
- `packages/server/src/mcp/tools/agent-teams.ts` — added 4 new MCP tools
- `packages/server/src/__tests__/agent-teams-intervention.test.ts` — NEW: 18 unit + integration tests
- `packages/server/src/__tests__/agent-teams-mcp.test.ts` — updated mocks for new exports/schema

### Change Log
- 2026-03-28: Implemented Story 6.2 — 4 MCP intervention tools, parser write helpers, DB table, shared types, 18 tests

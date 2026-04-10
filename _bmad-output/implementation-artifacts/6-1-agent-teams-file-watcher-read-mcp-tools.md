# Story 6.1: Agent Teams File Watcher & Read MCP Tools

Status: done

## Story

As a Claude Code user running Agent Teams,
I want flowAIbuilder to watch my team's files and expose team state via MCP,
so that the visual dashboard can show what my agents are doing.

## Acceptance Criteria

1. **Given** a Claude Code Agent Team is running at `~/.claude/teams/<teamName>/` **When** I call `flowaibuilder.watch_team({ team_name })` **Then** the server starts fs.watch() on the team's `inboxes/` directory and `tasks.json` file **And** returns the current team state as initial snapshot

2. **Given** the watcher is active **When** an agent's inbox file changes (new message) **Then** the server parses the updated inbox and broadcasts an `agent_messages_updated` event via WebSocket

3. **Given** the watcher is active **When** tasks.json changes (task status update) **Then** the server parses the updated tasks and broadcasts a `team_tasks_updated` event with tasks and progress percentage

4. **Given** a team is being watched **When** I call `flowaibuilder.get_team_state({ team_name })` **Then** I receive: agents (name, status inferred from tasks, current task, completed count, recent messages), tasks (all with status/assignee), and progress percentage

5. **Given** a team is being watched **When** I call `flowaibuilder.get_agent_messages({ team_name, agent_name, limit? })` **Then** I receive the last N messages from that agent's inbox

## Tasks / Subtasks

- [x] Task 1: Add Agent Teams shared types (AC: #1, #4, #5)
  - [x] 1.1 Add `AgentTeamTypes` to `packages/shared/src/types/agent-teams.ts` — interfaces for `TeamState`, `AgentInfo`, `TeamTask`, `InboxMessage`, `TeamSnapshot`
  - [x] 1.2 Add new WebSocket event types to `packages/shared/src/types/mcp.ts` — `agent_messages_updated`, `team_tasks_updated`, `team_watch_started`, `team_watch_stopped`
  - [x] 1.3 Re-export from `packages/shared/src/index.ts`

- [x] Task 2: Create TeamFileWatcher service (AC: #1, #2, #3)
  - [x] 2.1 Create `packages/server/src/agent-teams/watcher.ts` — `TeamFileWatcher` class:
    - `watch(teamName: string): TeamSnapshot` — starts fs.watch on `~/.claude/teams/<teamName>/inboxes/` (directory) and `~/.claude/teams/<teamName>/tasks.json` (file)
    - `unwatch(teamName: string): void` — stops watchers, cleans up
    - `isWatching(teamName: string): boolean`
    - `getSnapshot(teamName: string): TeamSnapshot` — reads current state from files
    - Debounces file change events (100ms) to avoid rapid-fire broadcasts
    - On inbox change: parses JSON, broadcasts `agent_messages_updated` via Broadcaster
    - On tasks.json change: parses JSON, computes progress %, broadcasts `team_tasks_updated`
    - Handles missing files gracefully (team dir doesn't exist yet → return error, inbox file missing → skip)
  - [x] 2.2 Create `packages/server/src/agent-teams/parser.ts` — pure functions:
    - `parseTasksFile(filePath: string): TeamTask[]` — reads and parses tasks.json
    - `parseInboxFile(filePath: string): InboxMessage[]` — reads and parses agent inbox JSON
    - `computeProgress(tasks: TeamTask[]): number` — percentage of done tasks
    - `inferAgentStatus(agentName: string, tasks: TeamTask[]): string` — 'active'/'idle'/'blocked' based on assigned tasks
    - `buildTeamSnapshot(teamDir: string): TeamSnapshot` — combines all parsing into full snapshot
  - [x] 2.3 Create `packages/server/src/agent-teams/index.ts` — singleton export pattern (like broadcaster)

- [x] Task 3: Register MCP tools (AC: #1, #4, #5)
  - [x] 3.1 Create `packages/server/src/mcp/tools/agent-teams.ts` — register 3 tools on the McpServer instance:
    - `flowaibuilder.watch_team` — params: `{ team_name: string }`, calls watcher.watch(), returns initial snapshot
    - `flowaibuilder.get_team_state` — params: `{ team_name: string }`, calls watcher.getSnapshot(), returns full state
    - `flowaibuilder.get_agent_messages` — params: `{ team_name: string, agent_name: string, limit?: number }`, reads inbox file, returns messages
  - [x] 3.2 Modify `packages/server/src/mcp/index.ts` — import and call the tool registration function from agent-teams.ts (pass `server` instance)

- [x] Task 4: Wire into server startup (AC: #2, #3)
  - [x] 4.1 Modify `packages/server/src/index.ts` — import and initialize TeamFileWatcher, passing broadcaster reference
  - [x] 4.2 Ensure watcher cleanup on server shutdown (close watchers on SIGTERM/SIGINT)

- [x] Task 5: Tests (all ACs)
  - [x] 5.1 Unit test `parser.ts` — test parseTasksFile, parseInboxFile, computeProgress, inferAgentStatus with fixture data
  - [x] 5.2 Unit test `watcher.ts` — test watch/unwatch lifecycle, snapshot building, error handling for missing dirs
  - [x] 5.3 Integration test MCP tools — test watch_team returns snapshot, get_team_state returns state, get_agent_messages returns messages
  - [x] 5.4 Test WebSocket broadcasts — verify agent_messages_updated and team_tasks_updated events are broadcast on file changes

## Dev Notes

### Claude Code Agent Teams File Format

Claude Code Agent Teams uses a simple file-based protocol at `~/.claude/teams/<teamName>/`:

```
~/.claude/teams/
  my-team/
    tasks.json          # Array of task objects
    inboxes/
      agent-1.json      # Array of message objects per agent
      agent-2.json
```

**tasks.json** structure (inferred from Claude Code docs):
```json
[
  {
    "id": "task-1",
    "title": "Implement auth middleware",
    "status": "in-progress",      // "unassigned" | "assigned" | "in-progress" | "blocked" | "done"
    "assignee": "agent-1",        // agent name or null
    "blockers": [],
    "createdAt": "2026-03-27T...",
    "updatedAt": "2026-03-27T..."
  }
]
```

**inboxes/<agent>.json** structure:
```json
[
  {
    "id": "msg-1",
    "from": "agent-2",           // agent name or "human"
    "message": "Auth module is ready for integration",
    "timestamp": "2026-03-27T...",
    "read": true
  }
]
```

**IMPORTANT**: These file formats are based on the Claude Code Agent Teams protocol. If the actual format differs at runtime, the parser should be resilient — log warnings for unexpected shapes but don't crash. Use `z.safeParse()` with zod schemas for validation.

### Architecture: Where Agent Teams Code Lives

```
packages/server/src/
  agent-teams/
    index.ts          # Singleton export (getTeamWatcher / createTeamWatcher)
    watcher.ts        # TeamFileWatcher class — fs.watch + debounce + broadcast
    parser.ts         # Pure parsing functions — no side effects, easily testable
  mcp/
    tools/
      agent-teams.ts  # MCP tool registration (watch_team, get_team_state, get_agent_messages)
    index.ts          # Modified — imports and calls agent-teams tool registration
```

### Current MCP Tool Pattern

All MCP tools are currently registered inline in `packages/server/src/mcp/index.ts` using `server.tool()`. This story introduces the first **extracted tool file** in `mcp/tools/`. Pattern:

```typescript
// packages/server/src/mcp/tools/agent-teams.ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTeamWatcher } from '../../agent-teams/index.js';

export function registerAgentTeamTools(server: McpServer) {
  server.tool(
    'flowaibuilder.watch_team',
    { team_name: z.string().describe('Team name (directory name under ~/.claude/teams/)') },
    async ({ team_name }) => {
      const watcher = getTeamWatcher();
      const snapshot = await watcher.watch(team_name);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(snapshot, null, 2) }],
      };
    },
  );
  // ... more tools
}
```

Then in `mcp/index.ts`, add at the end of `createMcpServer()` before `return server`:
```typescript
import { registerAgentTeamTools } from './tools/agent-teams.js';
// ... inside createMcpServer():
registerAgentTeamTools(server);
```

### WebSocket Broadcasting Pattern

The existing `Broadcaster` class (see `packages/server/src/api/ws/broadcaster.ts`) uses:
- `broadcast(type, workflowId, data)` — to all clients
- `broadcastToWorkflow(workflowId, type, data)` — to subscribed clients

For agent teams events, use `broadcast()` (not workflow-specific) since team events are global. The watcher needs a reference to the broadcaster — pass it during initialization or use `getBroadcaster()`.

New WebSocket event types to add to `WebSocketEventType` in `packages/shared/src/types/mcp.ts`:
- `'agent_messages_updated'`
- `'team_tasks_updated'`
- `'team_watch_started'`
- `'team_watch_stopped'`

### fs.watch Considerations

- Use `fs.watch()` (not `fs.watchFile()` — polling is wasteful)
- Watch `inboxes/` as a **directory** (detects new/changed files inside)
- Watch `tasks.json` as a **file**
- **Debounce**: fs.watch fires multiple events per save. Use a 100ms debounce per watched path.
- **Error handling**: `ENOENT` if team dir doesn't exist → return clear error message. `EPERM` → log warning.
- **Cleanup**: Store `FSWatcher` references in a Map, close all on unwatch/shutdown.
- Use `os.homedir()` to resolve `~` — do NOT hardcode home directory paths.

### Singleton Pattern (Follow Broadcaster)

```typescript
// packages/server/src/agent-teams/index.ts
import { TeamFileWatcher } from './watcher.js';

let instance: TeamFileWatcher | null = null;

export function createTeamWatcher(): TeamFileWatcher {
  instance = new TeamFileWatcher();
  return instance;
}

export function getTeamWatcher(): TeamFileWatcher {
  if (!instance) throw new Error('TeamFileWatcher not initialized — call createTeamWatcher() first');
  return instance;
}
```

### Server Startup Integration

In `packages/server/src/index.ts`, add after broadcaster creation:
```typescript
import { createTeamWatcher } from './agent-teams/index.js';

// After: const broadcaster = createBroadcaster(WS_PORT, getWorkflowById);
const teamWatcher = createTeamWatcher();
```

Add shutdown cleanup:
```typescript
process.on('SIGTERM', () => { teamWatcher.closeAll(); broadcaster.close(); });
process.on('SIGINT', () => { teamWatcher.closeAll(); broadcaster.close(); });
```

### Shared Types Design

```typescript
// packages/shared/src/types/agent-teams.ts

export interface InboxMessage {
  id: string;
  from: string;            // agent name or "human"
  message: string;
  timestamp: string;       // ISO string
  read: boolean;
}

export interface TeamTask {
  id: string;
  title: string;
  status: 'unassigned' | 'assigned' | 'in-progress' | 'blocked' | 'done';
  assignee: string | null;
  blockers?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentInfo {
  name: string;
  status: 'active' | 'idle' | 'blocked';  // inferred from tasks
  currentTask: string | null;              // task ID
  completedCount: number;
  recentMessages: InboxMessage[];          // last 5
}

export interface TeamSnapshot {
  teamName: string;
  agents: AgentInfo[];
  tasks: TeamTask[];
  progress: number;        // 0-100 percentage
  watchedSince: string;    // ISO string
}
```

### Testing Strategy

- **Parser tests** (`packages/server/src/__tests__/agent-teams-parser.test.ts`): Pure function tests with fixture data. No filesystem mocking needed — create temp files with known content.
- **Watcher tests** (`packages/server/src/__tests__/agent-teams-watcher.test.ts`): Create temp directories mimicking `~/.claude/teams/`, instantiate watcher, verify snapshot results. For fs.watch testing, write to temp files and assert broadcasts.
- **MCP tool tests** (`packages/server/src/__tests__/agent-teams-mcp.test.ts`): Follow pattern from existing `mcp-tools.test.ts`. Test tool registration and responses.
- Test framework: `vitest` (already configured in server package)
- Use `os.tmpdir()` for temp test directories, clean up in `afterEach`

### What NOT to Do

- Do NOT use `chokidar` or any file-watching library — use Node.js native `fs.watch()`
- Do NOT poll files with `fs.watchFile()` — use event-based `fs.watch()`
- Do NOT hardcode `~` or `/Users/...` — use `os.homedir()`
- Do NOT add any UI code — this story is server-only
- Do NOT implement `send_team_message`, `update_task`, `add_task`, or `link_task_to_node` — those are Story 6.2
- Do NOT create a database table for agent teams — all data lives in the filesystem
- Do NOT add REST API endpoints for agent teams — MCP-first per architecture
- Do NOT move existing MCP tools out of `mcp/index.ts` — only add the new extracted pattern for agent-teams tools
- Do NOT add `unwatch_team` as an MCP tool (not in ACs) — but DO implement `unwatch()` on the class for cleanup
- Do NOT import `@anthropic-ai/sdk` — zero-cost AI model principle

### Previous Story Intelligence

From Story 1.6 (most recent completed story):
- **Test patterns**: vitest + vi.fn() mocking. 83 tests across 15 files — all passing.
- **Review findings**: ARIA attributes, null fallbacks, and touch/keyboard accessibility were common review patches. Anticipate similar attention to error handling edge cases.
- **Code patterns**: Named exports, TypeScript strict mode, no default exports (except route components).
- **Deferred issues**: `request()` breaks on 204 No Content (issue #17) — not relevant to this story since we return JSON.

### Project Structure Notes

- All paths align with the unified project structure in CLAUDE.md
- New directory: `packages/server/src/agent-teams/` (3 files)
- New file: `packages/server/src/mcp/tools/agent-teams.ts`
- Modified files: `packages/server/src/mcp/index.ts`, `packages/server/src/index.ts`, `packages/shared/src/types/mcp.ts`
- New shared types file: `packages/shared/src/types/agent-teams.ts`
- Test files: `packages/server/src/__tests__/agent-teams-parser.test.ts`, `packages/server/src/__tests__/agent-teams-watcher.test.ts`, `packages/server/src/__tests__/agent-teams-mcp.test.ts`

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.1] — Acceptance criteria and epic context
- [Source: packages/server/src/mcp/index.ts] — Current MCP tool registration pattern (inline server.tool() calls)
- [Source: packages/server/src/api/ws/broadcaster.ts] — WebSocket broadcast pattern, singleton export
- [Source: packages/shared/src/types/mcp.ts] — WebSocketEventType union, WebSocketMessage interface
- [Source: packages/server/src/index.ts] — Server startup, broadcaster init, MCP server creation
- [Source: CLAUDE.md] — File-based Agent Teams integration principle, MCP-first principle, zero-cost AI model
- [Source: 1-6-dashboard-workflow-management.md] — Previous story learnings, test conventions

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None — clean implementation with no blockers.

### Completion Notes List

- Created shared types for Agent Teams: `InboxMessage`, `TeamTask`, `AgentInfo`, `TeamSnapshot` with zod validation schemas in parser
- Added 4 new WebSocket event types: `agent_messages_updated`, `team_tasks_updated`, `team_watch_started`, `team_watch_stopped`
- Built `TeamFileWatcher` class with fs.watch() on team directories, 100ms debounce, graceful error handling for missing files/dirs
- Built pure parser functions with zod safeParse for resilient JSON parsing — invalid entries are skipped with warnings, not crashes
- Registered 3 MCP tools: `watch_team`, `get_team_state`, `get_agent_messages` following extracted tool file pattern
- Introduced first extracted MCP tool file (`mcp/tools/agent-teams.ts`) — existing tools remain inline in mcp/index.ts per story spec
- Wired TeamFileWatcher into server startup with singleton pattern matching Broadcaster
- Added graceful shutdown (SIGTERM/SIGINT) closing all watchers and broadcaster
- 24 new tests across 3 test files — all passing. 44 total server tests pass, 0 regressions. (36 pre-existing UI test failures unrelated to this story)

### File List

- `packages/shared/src/types/agent-teams.ts` — new (InboxMessage, TeamTask, AgentInfo, TeamSnapshot interfaces)
- `packages/shared/src/types/mcp.ts` — modified (4 new WebSocket event types)
- `packages/shared/src/index.ts` — modified (re-export agent-teams types)
- `packages/server/src/agent-teams/parser.ts` — new (pure parsing functions with zod validation)
- `packages/server/src/agent-teams/watcher.ts` — new (TeamFileWatcher class with fs.watch + debounce)
- `packages/server/src/agent-teams/index.ts` — new (singleton export pattern)
- `packages/server/src/mcp/tools/agent-teams.ts` — new (3 MCP tool registrations)
- `packages/server/src/mcp/index.ts` — modified (imports and calls registerAgentTeamTools)
- `packages/server/src/index.ts` — modified (createTeamWatcher init + shutdown handlers)
- `packages/server/src/__tests__/agent-teams-parser.test.ts` — new (15 tests)
- `packages/server/src/__tests__/agent-teams-watcher.test.ts` — new (7 tests)
- `packages/server/src/__tests__/agent-teams-mcp.test.ts` — new (2 tests)

### Review Findings

- [x] [Review][Decision] Duplicate `watch_team` call silently returns stale snapshot without re-attaching watchers — resolved: re-watch (unwatch + re-attach) [watcher.ts]
- [x] [Review][Patch] Path traversal via unsanitized `team_name` — added validateName() [watcher.ts, mcp/tools/agent-teams.ts]
- [x] [Review][Patch] Path traversal via unsanitized `agent_name` — added validateName() [mcp/tools/agent-teams.ts]
- [x] [Review][Patch] `tasks.json`/`inboxes/` created after `watch()` not detected — re-watch tears down and re-attaches [watcher.ts]
- [x] [Review][Patch] Async errors in `debounce` callback — added `.catch()` on promise [watcher.ts]
- [x] [Review][Patch] `get_agent_messages` recalculates `teamDir` from `homedir()` instead of using watcher entry — now uses `watcher.getTeamDir()` [mcp/tools/agent-teams.ts]
- [x] [Review][Patch] `filename.replace('.json', '')` strips first occurrence not suffix — now uses `basename(f, '.json')` [watcher.ts]
- [x] [Review][Patch] Singleton `createTeamWatcher()` overwrites without cleanup on re-init — now calls `closeAll()` first [agent-teams/index.ts]
- [x] [Review][Defer] `broadcast()` sends to all clients — no team-level subscription filter — deferred, architecture decision for Story 6.3
- [x] [Review][Defer] `recentMessages` hard-coded to 5 vs `get_agent_messages` default 20 — deferred, cosmetic inconsistency
- [x] [Review][Defer] No file size guard before JSON parse — deferred, pre-existing pattern (all readFile calls in codebase)
- [x] [Review][Defer] `computeProgress` gives no signal for "all blocked" vs "just started" — deferred, UX concern for Story 6.3

### Change Log

- 2026-03-28: Implemented Story 6.1 — Agent Teams File Watcher & Read MCP Tools. Server-side file watching, parsing, and MCP tool exposure for Claude Code Agent Teams integration.
- 2026-03-28: Code review — 8 findings fixed (path traversal, re-watch idempotency, async error handling, basename fix, singleton cleanup), 4 deferred.

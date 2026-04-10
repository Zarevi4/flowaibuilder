# Story 6.3: Team Dashboard UI

Status: done

## Story

As a human overseeing Agent Teams,
I want a visual dashboard showing agent status, tasks, and messages,
so that I can understand team progress at a glance instead of reading terminal output.

## Acceptance Criteria

1. **Given** a team is being watched **When** I navigate to the team dashboard view **Then** I see agent cards showing: name, inferred status (working/idle/blocked), current task, completed task count

2. **Given** the dashboard is open **When** I view the task board section **Then** tasks are displayed in columns by status (unassigned, in-progress, blocked, done) with assignee labels

3. **Given** the dashboard is open **When** I view the message feed **Then** inter-agent messages appear in chronological order with sender, recipient, and timestamp

4. **Given** the dashboard is open **When** a WebSocket event updates team state (new message, task change) **Then** the dashboard updates in real-time without page refresh

5. **Given** the dashboard header **When** displayed **Then** it shows team name, agent count, and overall progress bar (% tasks done)

## Tasks / Subtasks

- [x] Task 1: Add REST API endpoints for agent teams (AC: #1, #2, #3, #5)
  - [x] 1.1 Add `GET /api/teams` endpoint to `packages/server/src/api/routes/teams.ts` — returns list of watched team names from `getTeamWatcher().getWatchedTeams()`
  - [x] 1.2 Add `GET /api/teams/:teamName` endpoint — returns `TeamSnapshot` from `getTeamWatcher().getSnapshot(teamName)`
  - [x] 1.3 Add `GET /api/teams/:teamName/messages` endpoint — aggregates all agent inbox files into a flat, chronologically-sorted message list with agent names
  - [x] 1.4 Register routes in `packages/server/src/index.ts` — follow existing `workflowRoutes(app)` pattern
  - [x] 1.5 Add `getWatchedTeams(): string[]` method to `TeamFileWatcher` class in `watcher.ts` if not already present — returns `Array.from(this.watchers.keys())`

- [x] Task 2: Create Zustand team store (AC: #1, #4, #5)
  - [x] 2.1 Create `packages/ui/src/store/teams.ts` — `useTeamStore` with state: `teamName: string | null`, `snapshot: TeamSnapshot | null`, `messages: InboxMessage[]`, `loading: boolean`, `error: string | null`
  - [x] 2.2 Add `loadTeam(teamName: string)` action — fetches `GET /api/teams/:teamName` and `GET /api/teams/:teamName/messages`, populates state
  - [x] 2.3 Add `applyWsMessage(msg: WebSocketMessage)` action — handles `team_tasks_updated`, `agent_messages_updated`, `team_watch_started`, `team_watch_stopped` events by updating snapshot/messages in-place
  - [x] 2.4 Add `clearTeam()` action — resets state to initial

- [x] Task 3: Wire WebSocket team events to team store (AC: #4)
  - [x] 3.1 Modify `packages/ui/src/store/ws.ts` `onmessage` handler — before the RAF `queueMessage()` fallthrough, check if `msg.type` starts with `team_` or `agent_` and route to `useTeamStore.getState().applyWsMessage(msg)` (apply immediately, no batching needed for team events)
  - [x] 3.2 Handle `task_linked_to_node` event type the same way — route to team store

- [x] Task 4: Add API client functions (AC: #1, #2, #3)
  - [x] 4.1 Add to `packages/ui/src/lib/api.ts`: `listTeams(): Promise<{ teams: string[] }>`, `getTeamSnapshot(teamName: string): Promise<TeamSnapshot>`, `getTeamMessages(teamName: string): Promise<{ messages: InboxMessage[] }>`

- [x] Task 5: Create TeamDashboard page and route (AC: #1, #2, #3, #5)
  - [x] 5.1 Create `packages/ui/src/pages/TeamDashboard.tsx` — reads `teamName` from URL param, calls `useTeamStore.loadTeam()` on mount, renders header + 3-panel layout (agents, tasks, messages)
  - [x] 5.2 Add route `"/teams/:teamName"` to `packages/ui/src/App.tsx`
  - [x] 5.3 Add "Teams" link to header nav in `App.tsx` — navigate to a team picker or first watched team

- [x] Task 6: Create agent-teams UI components (AC: #1, #2, #3, #5)
  - [x] 6.1 Create `packages/ui/src/components/agent-teams/TeamHeader.tsx` — team name, agent count pill, progress bar (AC: #5)
  - [x] 6.2 Create `packages/ui/src/components/agent-teams/AgentCard.tsx` — agent name, status dot (green=active, yellow=idle, red=blocked), current task title, completed count badge (AC: #1)
  - [x] 6.3 Create `packages/ui/src/components/agent-teams/TaskBoard.tsx` — 4 columns (unassigned, in-progress, blocked, done), each task as a card with title + assignee label (AC: #2)
  - [x] 6.4 Create `packages/ui/src/components/agent-teams/MessageFeed.tsx` — scrollable list, each message shows sender, recipient (derive from inbox file name), timestamp, message text. Most recent at bottom with auto-scroll (AC: #3)

- [x] Task 7: Add team navigation to main Dashboard (AC: #1)
  - [x] 7.1 Add a "Watched Teams" section to `packages/ui/src/pages/Dashboard.tsx` — below workflows grid, fetches `GET /api/teams`, shows team name cards linking to `/teams/:teamName`
  - [x] 7.2 Show empty state if no teams are being watched ("No teams watched. Use Claude Code to run `watch_team` via MCP.")

- [x] Task 8: Tests (all ACs)
  - [x] 8.1 Unit test `useTeamStore` — loadTeam populates state, applyWsMessage updates correctly for each event type, clearTeam resets
  - [x] 8.2 Unit test `AgentCard` — renders name, status dot color, current task, completed count
  - [x] 8.3 Unit test `TaskBoard` — renders tasks in correct columns, shows assignee labels
  - [x] 8.4 Unit test `MessageFeed` — renders messages chronologically, shows sender/timestamp
  - [x] 8.5 Unit test `TeamHeader` — renders team name, agent count, progress bar width
  - [x] 8.6 Integration test `TeamDashboard` page — mocks API, verifies all sections render with test data

## Dev Notes

### UI-First Story with Minimal Server Additions

This story is primarily UI code. The only server change is adding REST endpoints to expose existing watcher data to the UI. The watcher, parser, MCP tools, and WebSocket broadcasting already exist from Stories 6.1 and 6.2.

### REST Endpoints Are Required

The MCP tools cannot be called from the browser. The UI needs REST API endpoints to fetch initial team state. Pattern to follow — see `packages/server/src/api/routes/workflows.ts`:

```typescript
// packages/server/src/api/routes/teams.ts
import type { FastifyInstance } from 'fastify';
import { getTeamWatcher } from '../../agent-teams/index.js';

export async function teamRoutes(app: FastifyInstance) {
  app.get('/api/teams', async () => {
    const watcher = getTeamWatcher();
    return { teams: watcher.getWatchedTeams() };
  });

  app.get('/api/teams/:teamName', async (request) => {
    const { teamName } = request.params as { teamName: string };
    const watcher = getTeamWatcher();
    const snapshot = await watcher.getSnapshot(teamName);
    return snapshot;
  });

  app.get('/api/teams/:teamName/messages', async (request) => {
    const { teamName } = request.params as { teamName: string };
    // Aggregate all agent inbox files into flat sorted list
    // Reuse parser functions from agent-teams/parser.ts
  });
}
```

Register in `packages/server/src/index.ts`:
```typescript
import { teamRoutes } from './api/routes/teams.js';
// after workflowRoutes(app):
await teamRoutes(app);
```

### WebSocket Integration — Critical Architecture Decision

The current `ws.ts` routes ALL non-execution messages through `queueMessage()` → `flushMessages()` → `useWorkflowStore.applyWsMessages()`. Team events (workflowId: `''`) fall through to the `default` case in `reduceWsMessage` and are silently ignored.

**Fix**: In `ws.ts`'s `onmessage` handler, add a check BEFORE the `queueMessage()` fallthrough:

```typescript
// In ws.onmessage, after execution event handling, before queueMessage:
const teamEventTypes = ['agent_messages_updated', 'team_tasks_updated',
  'team_watch_started', 'team_watch_stopped', 'task_linked_to_node'];
if (teamEventTypes.includes(msg.type)) {
  // Import at top: import { useTeamStore } from './teams';
  useTeamStore.getState().applyWsMessage(msg);
  return; // Don't queue for workflow store
}
```

Team events should be applied immediately (not RAF-batched) — they're infrequent and the dashboard should update instantly.

### Team Store Design

```typescript
// packages/ui/src/store/teams.ts
import { create } from 'zustand';
import type { TeamSnapshot, InboxMessage, WebSocketMessage } from '@flowaibuilder/shared';
import { getTeamSnapshot, getTeamMessages } from '../lib/api';

interface TeamState {
  teamName: string | null;
  snapshot: TeamSnapshot | null;
  messages: InboxMessage[];
  loading: boolean;
  error: string | null;
  loadTeam: (teamName: string) => Promise<void>;
  applyWsMessage: (msg: WebSocketMessage) => void;
  clearTeam: () => void;
}
```

For `applyWsMessage`, handle each event type:
- `team_tasks_updated`: Replace `snapshot.tasks` and `snapshot.progress` from `msg.data`
- `agent_messages_updated`: Merge new messages into `messages` array, update agent's `recentMessages` in snapshot
- `team_watch_stopped`: If `msg.data.teamName === teamName`, clear state (team unwatched)
- `task_linked_to_node`: Informational for now — can be used in Story 6.4

### Aggregated Messages Endpoint

The server stores messages per-agent in separate inbox files. The UI message feed needs ALL messages across ALL agents, sorted chronologically. The `GET /api/teams/:teamName/messages` endpoint should:

1. Get snapshot via `watcher.getSnapshot(teamName)`
2. Flatten all `agent.recentMessages` from the snapshot
3. OR better: read all inbox files from `~/.claude/teams/<teamName>/inboxes/*.json` using the parser
4. Sort by `timestamp` ascending
5. Return `{ messages: InboxMessage[] }`

Note: `InboxMessage` has a `from` field but no `to` field. The recipient is implicit from the inbox file name. Add `to` field to the response by deriving it from the file name (e.g., `inboxes/agent-1.json` → messages have `to: "agent-1"`).

Consider adding a `to` field to the message response shape. You can create a local `DashboardMessage` type extending `InboxMessage` with `to: string`, or add the field to the shared type if it makes sense.

### Component Layout

```
+-- TeamHeader ---- [team name] [4 agents] [========57%========] --+
|                                                                    |
|  +-- Agent Cards (horizontal scroll) -------------------------+   |
|  | [AgentCard] [AgentCard] [AgentCard] [AgentCard]            |   |
|  +------------------------------------------------------------+   |
|                                                                    |
|  +-- TaskBoard -----------+ +-- MessageFeed ------------------+   |
|  | Unassigned | In-prog   | | [agent-2 → agent-1] 10:30am   |   |
|  | [task]     | [task]    | | Auth module ready               |   |
|  |            | [task]    | | [agent-1 → team-lead] 10:32am  |   |
|  | Blocked    | Done      | | Integration complete            |   |
|  | [task]     | [task]    | |                                 |   |
|  +------------------------+ +---------------------------------+   |
+--------------------------------------------------------------------+
```

Use CSS Grid for the main layout: agent cards span full width top, task board and message feed split the bottom half.

### Color Palette and Conventions (Match Existing UI)

Follow the exact patterns found in existing components:

- **Page bg**: `bg-gray-950`
- **Card bg**: `bg-gray-900 border border-gray-800 rounded-lg`
- **Hover**: `hover:bg-gray-800`
- **Primary accent**: `bg-purple-600 hover:bg-purple-700` (buttons/active)
- **Status dots** (`w-2 h-2 rounded-full`):
  - Active/working: `bg-green-400`
  - Idle: `bg-yellow-400`
  - Blocked: `bg-red-400`
- **Text**: `text-white` (primary), `text-gray-400` (secondary), `text-gray-600` (muted)
- **Error state**: `bg-red-900/30 border border-red-800 rounded-lg` + `text-red-400`
- **Loading skeleton**: `animate-pulse bg-gray-800 rounded-lg`
- **Icons**: `lucide-react` only (Users, CheckCircle, MessageSquare, AlertTriangle, Clock, etc.)
- **Named exports**: `export function ComponentName()` (not default exports)
- **Props interface**: declared above component as `interface ComponentNameProps { ... }`

### Progress Bar Implementation

The `TeamSnapshot.progress` field is 0-100 (percentage of tasks done). Render as:

```tsx
<div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
  <div
    className="h-full bg-purple-500 rounded-full transition-all duration-300"
    style={{ width: `${progress}%` }}
  />
</div>
```

### Task Board — No Drag-and-Drop

No drag-and-drop library is installed (`@dnd-kit` etc.), and the ACs don't require it. Render tasks as static cards in status columns. Task reassignment is done via MCP tools (Story 6.2), not the UI. Keep it simple.

Status columns to display: `unassigned`, `in-progress`, `blocked`, `done`. The `assigned` status should be grouped with `unassigned` (or shown as its own column if desired — use judgment).

### Message Feed — Auto-Scroll

Messages should auto-scroll to bottom when new messages arrive (via WS). Use a `ref` on the scroll container and `scrollIntoView()` on the last message element. Only auto-scroll if the user was already at the bottom (don't interrupt if they're reading older messages).

### TeamDashboard Page Lifecycle

```typescript
// packages/ui/src/pages/TeamDashboard.tsx
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useTeamStore } from '../store/teams';

export function TeamDashboard() {
  const { teamName } = useParams<{ teamName: string }>();
  const { snapshot, messages, loading, error, loadTeam, clearTeam } = useTeamStore();

  useEffect(() => {
    if (teamName) loadTeam(teamName);
    return () => clearTeam();
  }, [teamName, loadTeam, clearTeam]);

  // Render TeamHeader, AgentCards, TaskBoard, MessageFeed
}
```

No WebSocket connection management needed — the ws.ts store handles the global WS connection. Team events are broadcast to ALL connected clients, so the dashboard receives them automatically as long as any WS connection is open. However, the dashboard page does NOT currently open a WS connection (only the Editor page does).

**Options**:
1. Open a WS connection from TeamDashboard page too (connect with a dummy/empty workflowId — server must handle this)
2. Add a separate "global" WS connection that doesn't subscribe to a workflow

**Recommended approach**: Modify ws.ts to support connecting without a workflowId. Add a `connectGlobal()` method that opens the WS and sends `{ type: 'subscribe', workflowId: '' }`. The server's broadcaster already accepts any subscription — it just stores the workflowId for targeted broadcasts. Team events use `broadcast()` (all clients), so any connected client receives them.

### Server WS Subscription for Team Events

Check `packages/server/src/api/ws/broadcaster.ts` to see how subscriptions work. The broadcaster sends team events via `broadcast()` (to all clients), not `broadcastToWorkflow()`. So the team dashboard just needs ANY open WS connection to receive events. The `connectGlobal()` approach above ensures this.

### getWatchedTeams() Method

The `TeamFileWatcher` class in `watcher.ts` maintains a `Map<string, ...>` of watched teams. Add a public method if not already present:

```typescript
getWatchedTeams(): string[] {
  return Array.from(this.watchers.keys());
}
```

Check if this method already exists before adding it.

### What NOT to Do

- Do NOT install `@dnd-kit` or any drag-and-drop library — not needed for this story
- Do NOT add MCP tools — server already has all needed tools from 6.1 and 6.2
- Do NOT modify existing MCP tools or watcher logic (except adding `getWatchedTeams()` if missing)
- Do NOT import `@anthropic-ai/sdk` — zero-cost AI model principle
- Do NOT add send-message or update-task UI controls — those are intervention features, possibly Story 6.4 or future work. This story is read-only dashboard view
- Do NOT create a separate WebSocket server or connection — reuse the existing one
- Do NOT use CSS modules or styled-components — Tailwind only
- Do NOT use default exports for components — named exports only
- Do NOT add charts/graphs libraries — the progress bar is simple HTML/CSS

### Previous Story Intelligence

From Story 6.2 (direct prerequisite):
- **`safeValidateName` + `mcpError`** pattern: All 7 MCP tools use this for input validation with `isError: true` returns. REST endpoints should validate `teamName` similarly (reject `..`, `/`, `\`)
- **Atomic write helpers**: `writeTasksFile`, `appendToInbox` exist in parser.ts — not needed for this UI story but good to know they exist
- **18 tests added** (62 total server) — maintain test count, don't break existing
- **Deferred from 6.1**: `broadcast()` sends to all clients (no team-level subscription filter) — this is actually fine for the dashboard since we filter client-side by `teamName`
- **Deferred from 6.1**: `computeProgress` gives no signal for "all blocked" vs "just started" — the progress bar will show 0% for both. Consider adding a visual indicator in the header if all non-done tasks are blocked

From Story 6.1:
- **`getSnapshot(teamName)`** returns full `TeamSnapshot` with computed `agents` array, `tasks`, and `progress` — this is the primary data source for the dashboard
- **`AgentInfo.status`** is inferred: `blocked` if assigned task is blocked, `active` if assigned task is in-progress, `idle` otherwise
- **`AgentInfo.recentMessages`** contains last 5 messages — the REST messages endpoint should return ALL messages, not just recent
- **WebSocket event data shapes** (from watcher.ts broadcasts):
  - `team_tasks_updated`: `{ teamName, tasks: TeamTask[], progress: number }`
  - `agent_messages_updated`: `{ teamName, agentName, messages: InboxMessage[] }`
  - `team_watch_started`: `{ teamName, snapshot: TeamSnapshot }`
  - `team_watch_stopped`: `{ teamName }`

### Project Structure Notes

- All paths align with the unified project structure in CLAUDE.md
- New directory: `packages/ui/src/components/agent-teams/` (4 component files)
- New files: `packages/ui/src/store/teams.ts`, `packages/ui/src/pages/TeamDashboard.tsx`, `packages/server/src/api/routes/teams.ts`
- Modified files: `packages/ui/src/App.tsx` (route), `packages/ui/src/store/ws.ts` (team event routing), `packages/ui/src/lib/api.ts` (team API functions), `packages/ui/src/pages/Dashboard.tsx` (teams section), `packages/server/src/index.ts` (register routes)
- Possibly modified: `packages/server/src/agent-teams/watcher.ts` (add `getWatchedTeams()` if missing)

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.3] — Acceptance criteria
- [Source: _bmad-output/planning-artifacts/prd.md#View 1: Team Dashboard] — Dashboard layout mockup and requirements
- [Source: _bmad-output/planning-artifacts/architecture.md] — Component tree: `agent-teams/TeamDashboard.tsx`, `AgentCard.tsx`, `TaskBoard.tsx`, `MessageFeed.tsx`
- [Source: packages/shared/src/types/agent-teams.ts] — `TeamSnapshot`, `AgentInfo`, `TeamTask`, `InboxMessage`, `TaskNodeLink`
- [Source: packages/shared/src/types/mcp.ts] — `WebSocketEventType` with team event types
- [Source: packages/server/src/agent-teams/watcher.ts] — `getSnapshot()`, `isWatching()`, broadcast event data shapes
- [Source: packages/server/src/agent-teams/parser.ts] — `parseInboxFile()`, `parseTasksFile()` for REST endpoint
- [Source: packages/ui/src/store/ws.ts] — Current WS message routing (team events fall through to default)
- [Source: packages/ui/src/lib/api.ts] — `request()` helper pattern for REST calls
- [Source: packages/ui/src/pages/Dashboard.tsx] — Existing page pattern (local state + REST fetch)
- [Source: packages/ui/src/components/dashboard/WorkflowCard.tsx] — Card component pattern
- [Source: packages/ui/src/components/canvas/nodes/BaseNode.tsx] — Status dot color conventions
- [Source: 6-1-agent-teams-file-watcher-read-mcp-tools.md] — Watcher architecture, parser functions, event shapes
- [Source: 6-2-team-intervention-mcp-tools.md] — MCP intervention tools, safeValidateName pattern, DB schema
- [Source: CLAUDE.md] — MCP-first, zero-cost AI model, file-based Agent Teams integration

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- Fixed `scrollIntoView` call in MessageFeed to use optional chaining for jsdom compatibility
- Updated existing dashboard.test.ts mock to include `Users` icon and `listTeams` API function after Dashboard modifications

### Completion Notes List

- Task 1: Created `teams.ts` REST routes with 3 endpoints (list, snapshot, messages). Added `getWatchedTeams()` to watcher. Validated teamName input. Registered routes in index.ts.
- Task 2: Created Zustand `useTeamStore` with `loadTeam`, `applyWsMessage`, `clearTeam`. Uses `DashboardMessage` extending `InboxMessage` with `to` field.
- Task 3: Added team event routing in `ws.ts` before RAF batching. Added `connectGlobal()` method for TeamDashboard WS connection.
- Task 4: Added `listTeams`, `getTeamSnapshot`, `getTeamMessages` to API client with URL encoding.
- Task 5: Created TeamDashboard page with loading/error/empty states, CSS Grid layout, WS connection lifecycle.
- Task 6: Created 4 components: TeamHeader (progress bar), AgentCard (status dots), TaskBoard (4 status columns), MessageFeed (auto-scroll, chronological).
- Task 7: Added "Watched Teams" section to Dashboard with team cards linking to `/teams/:teamName` and empty state message.
- Task 8: 30 new tests (7 server, 23 UI). All 175 tests pass (69 server + 106 UI). Zero regressions.

### File List

New files:
- packages/server/src/api/routes/teams.ts
- packages/ui/src/store/teams.ts
- packages/ui/src/pages/TeamDashboard.tsx
- packages/ui/src/components/agent-teams/TeamHeader.tsx
- packages/ui/src/components/agent-teams/AgentCard.tsx
- packages/ui/src/components/agent-teams/TaskBoard.tsx
- packages/ui/src/components/agent-teams/MessageFeed.tsx
- packages/server/src/__tests__/teams-routes.test.ts
- packages/ui/src/__tests__/team-store.test.ts
- packages/ui/src/__tests__/agent-teams-components.test.ts
- packages/ui/src/__tests__/team-dashboard.test.ts

Modified files:
- packages/server/src/agent-teams/watcher.ts (added `getWatchedTeams()`)
- packages/server/src/index.ts (registered team routes)
- packages/ui/src/store/ws.ts (team event routing + `connectGlobal()`)
- packages/ui/src/lib/api.ts (team API functions)
- packages/ui/src/App.tsx (route + nav link)
- packages/ui/src/pages/Dashboard.tsx (watched teams section)
- packages/ui/src/__tests__/dashboard.test.ts (updated mock for new imports)

### Review Findings

- [x] [Review][Decision] Silent swallowing of `listTeams()` errors in Dashboard — resolved: keep silent degradation (teams secondary to workflows on Dashboard)
- [x] [Review][Patch] Teams nav link points to `/` instead of teams section [packages/ui/src/App.tsx:18] — fixed: link now navigates to `/?section=teams` with scroll-to behavior
- [x] [Review][Patch] `connectGlobal()` sets `currentWorkflowId = ''` (falsy) — WS won't auto-reconnect [packages/ui/src/store/ws.ts:63] — fixed: use `'__global__'` sentinel (truthy) instead of empty string
- [x] [Review][Patch] `team_watch_started` event routed to store but not handled in switch [packages/ui/src/store/teams.ts] — fixed: added case to apply incoming snapshot
- [x] [Review][Patch] Race condition: WS events arrive before `loadTeam` REST response sets `snapshot` [packages/ui/src/store/teams.ts] — fixed: loadTeam checks teamName still matches before applying stale response
- [x] [Review][Patch] Graceful shutdown doesn't await `server.close()` or async cleanup [packages/server/src/index.ts:59-63] — fixed: shutdown is now async, awaits server.close()
- [x] [Review][Patch] Unsafe `as` cast on `msg.data` — crashes if data is null [packages/ui/src/store/teams.ts:45] — fixed: added null/type guard before cast
- [x] [Review][Patch] Double `set()` in `agent_messages_updated` causes two re-renders [packages/ui/src/store/teams.ts:71,78] — fixed: merged into single set() call
- [x] [Review][Defer] `connectGlobal` subscription fragility — empty workflowId not stored by server [packages/server/src/api/ws/broadcaster.ts:32] — deferred, works today via broadcast() to all clients
- [x] [Review][Defer] No pagination on messages endpoint [packages/server/src/api/routes/teams.ts] — deferred, scalability concern for future
- [x] [Review][Defer] Error response body not parsed in `api.ts` request() [packages/ui/src/lib/api.ts:14-17] — deferred, pre-existing pattern
- [x] [Review][Defer] Duplicate `DashboardMessage` type across 3 files — deferred, spec allows local types
- [x] [Review][Defer] Agent status doesn't update in real-time via WS [packages/ui/src/store/teams.ts] — deferred, computed server-side in buildTeamSnapshot

### Change Log

- 2026-03-28: Implemented Story 6.3 — Team Dashboard UI with REST endpoints, Zustand store, WebSocket integration, 4 dashboard components, navigation, and 30 tests.
- 2026-03-28: Code review completed — 1 decision-needed, 7 patches, 5 deferred, 13 dismissed.

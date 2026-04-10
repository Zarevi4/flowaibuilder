# Story 6.4: Canvas Agent Integration & Team Templates

Status: done

## Story

As a workflow user with Agent Teams,
I want to see which agent is building each node on the canvas and launch teams from templates,
so that I can track multi-agent workflow construction in real-time.

## Acceptance Criteria

1. **Given** tasks are linked to workflow nodes (via `link_task_to_node`) **When** the canvas renders **Then** each linked node displays an agent name badge (small pill below the node) color-coded by agent

2. **Given** an agent's linked task has status `in-progress` **When** the canvas renders **Then** the node shows a building indicator (pulsing border or spinner)

3. **Given** team templates exist (Webhook Pipeline 3-agent, AI Workflow 4-agent, Full-Stack 5-agent) **When** I open the "Launch Team" dialog **Then** I see available templates with agent roles and task descriptions

4. **Given** I select a template and click "Launch" **When** the team is created **Then** flowAIbuilder writes the team config to `~/.claude/teams/<teamName>/` with `tasks.json` populated from the template **And** the dashboard begins watching the new team

## Tasks / Subtasks

- [x] Task 1: Add REST endpoint to query task-node links for a workflow (AC: #1, #2)
  - [x] 1.1 Add `GET /api/workflows/:workflowId/task-links` endpoint to `packages/server/src/api/routes/workflows.ts` -- queries `taskNodeLinks` table filtered by workflowId, joins with team watcher to get task status and assignee
  - [x] 1.2 Return shape: `{ links: Array<{ taskId, nodeId, teamName, assignee, taskStatus, taskTitle }> }` -- enriched with live data from `getSnapshot()`
  - [x] 1.3 Add `getTaskLinks(workflowId: string)` to `packages/ui/src/lib/api.ts`

- [x] Task 2: Add task-link state to workflow store and canvas (AC: #1, #2)
  - [x] 2.1 Add `taskLinks: TaskLinkInfo[]` to workflow store state in `packages/ui/src/store/workflow.ts` -- type `TaskLinkInfo = { taskId: string; nodeId: string; teamName: string; assignee: string | null; taskStatus: string; taskTitle: string }`
  - [x] 2.2 Add `loadTaskLinks(workflowId: string)` action -- fetches `GET /api/workflows/:workflowId/task-links`, populates state
  - [x] 2.3 Handle `task_linked_to_node` WS event in `reduceWsMessage` -- append to `taskLinks` array (the event already contains `teamName, taskId, workflowId, nodeId`)
  - [x] 2.4 Handle `team_tasks_updated` WS event in workflow store (new) -- update `taskStatus` and `assignee` fields in existing `taskLinks` entries for matching `teamName`. Route this event to BOTH team store and workflow store in `ws.ts`.
  - [x] 2.5 Call `loadTaskLinks(workflowId)` in `Editor.tsx` on mount (alongside existing workflow load)

- [x] Task 3: Merge task-link data into React Flow nodes (AC: #1, #2)
  - [x] 3.1 In `packages/ui/src/components/canvas/Canvas.tsx`, extend the existing `useMemo` that merges `executionStatus` into node data -- also merge `taskLink` by matching `nodeId`. Add to `node.data`: `{ linkedAgent?: string, linkedTaskStatus?: string, linkedTaskTitle?: string }`
  - [x] 3.2 Generate a stable agent color map: hash agent name to one of 8 predefined colors (e.g., teal, coral, amber, violet, rose, cyan, lime, sky). Store in a `useMemo` derived from `taskLinks`.

- [x] Task 4: Add agent badge and building indicator to BaseNode (AC: #1, #2)
  - [x] 4.1 In `packages/ui/src/components/canvas/nodes/BaseNode.tsx`, add an agent badge pill below the node when `data.linkedAgent` is present -- small rounded pill with agent name, colored background from agent color map
  - [x] 4.2 Add building indicator when `data.linkedTaskStatus === 'in-progress'` -- pulsing border animation (use Tailwind `animate-pulse` on the border ring, similar to existing execution running state but with a different color, e.g., `ring-2 ring-purple-400 animate-pulse`)
  - [x] 4.3 Show task title as tooltip on the badge (use `title` attribute, no tooltip library)

- [x] Task 5: Create team template data and types (AC: #3, #4)
  - [x] 5.1 Add `TeamTemplate` type to `packages/shared/src/types/agent-teams.ts`: `{ id: string; name: string; description: string; agents: Array<{ name: string; role: string }>; tasks: Array<{ title: string; assignee: string; status: 'unassigned' }> }`
  - [x] 5.2 Create `packages/server/src/agent-teams/templates.ts` with 3 built-in templates:
    - **Webhook Pipeline** (3 agents): api-builder, logic-builder, reviewer -- with 5-6 tasks
    - **AI Workflow** (4 agents): api-builder, ai-prompt-engineer, error-handler, reviewer -- with 6-8 tasks
    - **Full-Stack Automation** (5 agents): architect, api-builder, ai-builder, tester, reviewer -- with 8-10 tasks
  - [x] 5.3 Export `getTemplates()` and `getTemplateById(id)` functions

- [x] Task 6: Add template REST endpoints and MCP tool (AC: #3, #4)
  - [x] 6.1 Add `GET /api/teams/templates` endpoint to `packages/server/src/api/routes/teams.ts` -- returns all templates
  - [x] 6.2 Add `POST /api/teams/launch` endpoint -- accepts `{ templateId, teamName }`, writes team directory structure to `~/.claude/teams/<teamName>/` with `tasks.json` from template, then calls `watcher.watch(teamName)` to start watching
  - [x] 6.3 Add `flowaibuilder.launch_team` MCP tool to `packages/server/src/mcp/tools/agent-teams.ts` -- same logic as the REST endpoint (MCP-first principle). Schema: `{ template_id: string, team_name: string }`
  - [x] 6.4 Add `listTemplates()` and `launchTeam(templateId, teamName)` to `packages/ui/src/lib/api.ts`

- [x] Task 7: Create Launch Team dialog UI (AC: #3, #4)
  - [x] 7.1 Create `packages/ui/src/components/agent-teams/LaunchTeamDialog.tsx` -- modal dialog with template cards, team name input, and Launch button
  - [x] 7.2 Each template card shows: name, description, agent count, agent roles list, task count
  - [x] 7.3 Team name input with validation (no special chars -- reuse `validateName` pattern)
  - [x] 7.4 On launch: call `launchTeam()` API, then navigate to `/teams/<teamName>`
  - [x] 7.5 Add "Launch Team" button to the TeamDashboard header (or Dashboard page Watched Teams section) that opens the dialog

- [x] Task 8: Tests (all ACs)
  - [x] 8.1 Server: test `GET /api/workflows/:id/task-links` returns enriched links
  - [x] 8.2 Server: test `GET /api/teams/templates` returns 3 templates
  - [x] 8.3 Server: test `POST /api/teams/launch` creates team directory and starts watching
  - [x] 8.4 UI: test workflow store `task_linked_to_node` WS handler appends to taskLinks
  - [x] 8.5 UI: test Canvas merges taskLink data into node.data
  - [x] 8.6 UI: test BaseNode renders agent badge when `linkedAgent` is set
  - [x] 8.7 UI: test BaseNode renders pulsing border when `linkedTaskStatus` is `in-progress`
  - [x] 8.8 UI: test LaunchTeamDialog renders templates, validates team name, calls API on launch
  - [x] 8.9 UI: test template card renders agent roles and task count

## Dev Notes

### Canvas Integration Architecture -- Follow Existing Patterns

The canvas already merges execution status into React Flow node data via a `useMemo` in `Canvas.tsx`. **Follow this exact pattern** for task-link data:

```typescript
// In Canvas.tsx, extend the existing useMemo:
const enrichedNodes = useMemo(() => {
  return nodes.map(node => {
    const execStatus = executionNodeMap.get(node.id);
    const taskLink = taskLinkMap.get(node.id); // NEW
    return {
      ...node,
      data: {
        ...node.data,
        executionStatus: execStatus?.status,
        // NEW: agent badge data
        linkedAgent: taskLink?.assignee ?? undefined,
        linkedTaskStatus: taskLink?.taskStatus ?? undefined,
        linkedTaskTitle: taskLink?.taskTitle ?? undefined,
      },
    };
  });
}, [nodes, executionNodeMap, taskLinkMap]);
```

### BaseNode Badge Pattern -- Follow Error Badge

The `BaseNode` already renders an error badge as an absolute-positioned element in the top-right corner. The agent badge should follow the same pattern but positioned **below the node**:

```tsx
{/* Agent badge -- positioned below the node */}
{data.linkedAgent && (
  <div
    className={`absolute -bottom-5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-[10px] font-medium text-white whitespace-nowrap ${agentColor}`}
    title={data.linkedTaskTitle}
  >
    {data.linkedAgent}
  </div>
)}
```

### Agent Color Map -- Deterministic Hash

Use a simple string hash to assign consistent colors to agent names:

```typescript
const AGENT_COLORS = [
  'bg-teal-500', 'bg-coral-500', 'bg-amber-500', 'bg-violet-500',
  'bg-rose-500', 'bg-cyan-500', 'bg-lime-500', 'bg-sky-500',
];

function agentColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length];
}
```

Note: Tailwind doesn't have `bg-coral-500`. Use `bg-orange-500` instead. Valid Tailwind 500-shade colors: teal, orange, amber, violet, rose, cyan, lime, sky.

### Building Indicator -- Pulsing Border

Reuse the execution status ring pattern from `BaseNode`. When `linkedTaskStatus === 'in-progress'`, add:

```tsx
const buildingRing = data.linkedTaskStatus === 'in-progress'
  ? 'ring-2 ring-purple-400 animate-pulse'
  : '';
```

Apply to the outermost card div, alongside the existing execution ring logic. Building and execution status should not conflict -- execution runs AFTER building is done.

### WebSocket Event Routing for `task_linked_to_node`

Currently `ws.ts` routes `task_linked_to_node` to the team store only. For story 6-4, it must ALSO reach the workflow store. Modify `ws.ts`:

```typescript
// In the team event routing block:
if (teamEventTypes.includes(msg.type)) {
  useTeamStore.getState().applyWsMessage(msg);
  // Also route task_linked_to_node to workflow store (it has a real workflowId)
  if (msg.type === 'task_linked_to_node') {
    queueMessage(msg); // Let workflow store handle it too
  }
  return; // Don't double-queue other team events
}
```

Similarly, `team_tasks_updated` needs to reach the workflow store to update task statuses on canvas badges. Add it to the dual-routing:

```typescript
if (msg.type === 'task_linked_to_node' || msg.type === 'team_tasks_updated') {
  queueMessage(msg);
}
```

### Task-Links REST Endpoint -- Enrichment Pattern

The `taskNodeLinks` DB table only stores IDs. The REST endpoint must enrich with live data:

```typescript
app.get<{ Params: { workflowId: string } }>('/api/workflows/:workflowId/task-links', async (request) => {
  const { workflowId } = request.params;
  const links = await db.select().from(taskNodeLinks).where(eq(taskNodeLinks.workflowId, workflowId));

  // Enrich with live task data from team snapshots
  const enriched = await Promise.all(links.map(async (link) => {
    const watcher = getTeamWatcher();
    let assignee = null, taskStatus = 'unknown', taskTitle = '';
    if (watcher.isWatching(link.teamName)) {
      const snapshot = await watcher.getSnapshot(link.teamName);
      const task = snapshot.tasks.find(t => t.id === link.taskId);
      if (task) {
        assignee = task.assignee;
        taskStatus = task.status;
        taskTitle = task.title;
      }
    }
    return { taskId: link.taskId, nodeId: link.nodeId, teamName: link.teamName, assignee, taskStatus, taskTitle };
  }));

  return { links: enriched };
});
```

### Team Template File Structure

When launching a team, write this to `~/.claude/teams/<teamName>/`:

```
~/.claude/teams/<teamName>/
  tasks.json       # Array of TeamTask objects from template
  inboxes/         # Empty directory (agents create their own inbox files)
```

The `tasks.json` structure matches the existing Zod schema in `parser.ts`:
```json
[
  { "id": "task-abc12345", "title": "Set up webhook endpoint", "status": "unassigned", "assignee": "api-builder", "createdAt": "...", "updatedAt": "..." }
]
```

Use `generateId()` from `parser.ts` for task IDs. Use `writeTasksFile()` for atomic writes. Create the `inboxes/` directory with `mkdir`.

### Launch Team MCP Tool -- MCP-First Principle

Per CLAUDE.md, every feature is MCP first. The `launch_team` MCP tool should exist AND the REST endpoint should exist. They share the same core logic -- extract to a helper:

```typescript
// packages/server/src/agent-teams/templates.ts
export async function launchTeamFromTemplate(templateId: string, teamName: string): Promise<TeamSnapshot> {
  const template = getTemplateById(templateId);
  if (!template) throw new Error(`Template "${templateId}" not found`);

  validateName(teamName, 'team_name');
  const teamDir = join(homedir(), '.claude', 'teams', teamName);

  // Create directory structure
  await mkdir(teamDir, { recursive: true });
  await mkdir(join(teamDir, 'inboxes'), { recursive: true });

  // Write tasks.json from template
  const tasks: TeamTask[] = template.tasks.map(t => ({
    id: generateId(),
    title: t.title,
    status: t.assignee ? 'assigned' as const : 'unassigned' as const,
    assignee: t.assignee || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
  await writeTasksFile(join(teamDir, 'tasks.json'), tasks);

  // Start watching
  const watcher = getTeamWatcher();
  return watcher.watch(teamName);
}
```

### LaunchTeamDialog -- Follow Existing Dialog Pattern

Follow the `DeleteConfirmDialog` pattern for the modal. Dark theme, Tailwind only:

```tsx
// Overlay
<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
  <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
    {/* Header, template cards, team name input, buttons */}
  </div>
</div>
```

### What NOT to Do

- Do NOT install any new dependencies -- no tooltip libraries, no animation libraries, no drag-and-drop
- Do NOT create a new WebSocket connection or server -- reuse existing
- Do NOT modify the `taskNodeLinks` DB table schema -- it already has everything needed
- Do NOT add `@anthropic-ai/sdk` -- zero-cost AI model principle
- Do NOT use default exports for components -- named exports only
- Do NOT use CSS modules or styled-components -- Tailwind only
- Do NOT add an agent-team-specific React Flow node type -- agent badges are overlays on existing nodes
- Do NOT implement "propose-then-confirm" (dashed borders) -- that's the design+launch mode, not MVP for this story. The ACs only require badges and building indicators on existing nodes.
- Do NOT implement the three operation modes (observe, design+launch, hybrid) -- this story covers observe mode canvas integration + template launch. Full mode support is future work.
- Do NOT implement `get_team_workflow` or `set_task_assignment` MCP tools -- not in ACs

### Previous Story Intelligence

From Story 6-3 (direct prerequisite):
- **`connectGlobal()`** uses `'__global__'` sentinel (not empty string) for team dashboard WS. The Editor page uses `connect(workflowId)` which subscribes to workflow events. Task-link and task-update events on the canvas come via the workflow subscription (they have real `workflowId`), so no changes to Editor WS connection needed.
- **Team store's `applyWsMessage`** has a placeholder `case 'task_linked_to_node': break` -- keep this placeholder, the real handling goes in the workflow store.
- **DashboardMessage** type is duplicated across 3 files -- do NOT add a 4th copy. Task-link types go in the workflow store, not the team store.
- **175 total tests** (69 server + 106 UI) is the current baseline. Target: ~195+ after this story.

From Story 6-2:
- **`link_task_to_node` MCP tool** already exists and works. It inserts into `taskNodeLinks` DB and broadcasts `task_linked_to_node` with `{ teamName, taskId, workflowId, nodeId }`. This story CONSUMES that event on the canvas -- does not modify the tool.
- **`safeValidateName` + `mcpError`** pattern for all MCP tools -- use for `launch_team`.
- **`writeTasksFile`** and **`generateId`** from `parser.ts` -- reuse for template launch.
- **Deferred**: No cleanup of `taskNodeLinks` when nodes are deleted -- be aware that dangling links may exist. The canvas should gracefully handle links pointing to deleted nodes (filter them out).

From Story 6-1:
- **`watcher.watch(teamName)`** returns `TeamSnapshot` and broadcasts `team_watch_started`. Call this after writing template files.
- **Broadcast pattern**: Team events use `broadcast()` (global), but `task_linked_to_node` uses `broadcast()` too (not `broadcastToWorkflow()`). This means ALL clients get it. The workflow store reducer filters by `msg.workflowId`.

### Color Palette Conventions (Match Existing UI)

- **Page bg**: `bg-gray-950`
- **Card bg**: `bg-gray-900 border border-gray-800 rounded-lg`
- **Hover**: `hover:bg-gray-800`
- **Primary accent**: `bg-purple-600 hover:bg-purple-700` (buttons/active)
- **Text**: `text-white` (primary), `text-gray-400` (secondary), `text-gray-600` (muted)
- **Error**: `bg-red-900/30 border border-red-800 rounded-lg` + `text-red-400`
- **Icons**: `lucide-react` only
- **Named exports**: `export function ComponentName()`
- **Props interface**: declared above component

### Project Structure Notes

New files:
- `packages/server/src/agent-teams/templates.ts` (template data + launchTeamFromTemplate)
- `packages/ui/src/components/agent-teams/LaunchTeamDialog.tsx`

Modified files:
- `packages/server/src/api/routes/workflows.ts` (task-links endpoint)
- `packages/server/src/api/routes/teams.ts` (template endpoints)
- `packages/server/src/mcp/tools/agent-teams.ts` (launch_team tool)
- `packages/shared/src/types/agent-teams.ts` (TeamTemplate type)
- `packages/shared/src/index.ts` (re-export TeamTemplate)
- `packages/ui/src/store/workflow.ts` (taskLinks state + WS handler)
- `packages/ui/src/store/ws.ts` (dual-route task_linked_to_node + team_tasks_updated)
- `packages/ui/src/components/canvas/Canvas.tsx` (merge taskLink data into nodes)
- `packages/ui/src/components/canvas/nodes/BaseNode.tsx` (agent badge + building indicator)
- `packages/ui/src/lib/api.ts` (getTaskLinks, listTemplates, launchTeam)
- `packages/ui/src/pages/Editor.tsx` (load task links on mount)
- `packages/ui/src/pages/Dashboard.tsx` or `TeamDashboard.tsx` (Launch Team button)

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.4] -- Acceptance criteria
- [Source: _bmad-output/planning-artifacts/prd.md#View 2: Workflow Canvas] -- Agent name badges, color-coded, live status
- [Source: _bmad-output/planning-artifacts/prd.md#Agent Team Templates] -- 3 templates with roles/tasks
- [Source: _bmad-output/planning-artifacts/architecture.md#Agent Teams MCP Tools] -- link_task_to_node schema
- [Source: _bmad-output/planning-artifacts/architecture.md#WebSocket Protocol] -- task_linked_to_node event type
- [Source: packages/shared/src/types/agent-teams.ts] -- TeamSnapshot, AgentInfo, TeamTask, TaskNodeLink
- [Source: packages/server/src/db/schema.ts] -- taskNodeLinks table (exists, has unique constraint)
- [Source: packages/server/src/mcp/tools/agent-teams.ts] -- 7 existing tools including link_task_to_node
- [Source: packages/server/src/agent-teams/parser.ts] -- writeTasksFile, generateId, parseTasksFile
- [Source: packages/server/src/agent-teams/watcher.ts] -- watch(), getSnapshot(), broadcast patterns
- [Source: packages/ui/src/components/canvas/Canvas.tsx] -- executionStatus merge pattern in useMemo
- [Source: packages/ui/src/components/canvas/nodes/BaseNode.tsx] -- execution ring + error badge patterns
- [Source: packages/ui/src/store/workflow.ts] -- reduceWsMessage pure reducer pattern
- [Source: packages/ui/src/store/ws.ts] -- team event routing, __global__ sentinel
- [Source: 6-1-agent-teams-file-watcher-read-mcp-tools.md] -- Watcher architecture, broadcast patterns
- [Source: 6-2-team-intervention-mcp-tools.md] -- link_task_to_node tool, safeValidateName, atomic writes
- [Source: 6-3-team-dashboard-ui.md] -- Dashboard components, team store, connectGlobal, review findings
- [Source: CLAUDE.md] -- MCP-first, zero-cost AI model, file-based Agent Teams integration

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- Pre-existing dashboard.test.ts failure (useSearchParams mock missing from Story 6-3) — fixed as part of this story
- Pre-existing store-node-actions.test.ts TS error (null source in onConnect test) — not related, left as-is

### Completion Notes List
- Task 1: Added `GET /api/workflows/:workflowId/task-links` endpoint that queries `taskNodeLinks` DB table and enriches with live task data from team watcher snapshots. Added `getTaskLinks()` API client.
- Task 2: Added `taskLinks` state to workflow store with `loadTaskLinks` action, `task_linked_to_node` and `team_tasks_updated` WS handlers in reducer, dual-routing in `ws.ts`, and `loadTaskLinks` call in Editor mount.
- Task 3: Extended Canvas `useMemo` to merge task-link data into React Flow nodes alongside execution status. Created deterministic `agentColor()` hash function with 8 Tailwind colors.
- Task 4: Added agent badge pill below BaseNode (color-coded by agent name) and purple pulsing ring for `in-progress` building status. Execution status takes priority over building indicator. Updated all 6 node components.
- Task 5: Added `TeamTemplate` type to shared types. Created `templates.ts` with 3 templates (Webhook Pipeline 3-agent/6-task, AI Workflow 4-agent/8-task, Full-Stack 5-agent/10-task) and `launchTeamFromTemplate` helper.
- Task 6: Added `GET /api/teams/templates` and `POST /api/teams/launch` REST endpoints. Added `flowaibuilder.launch_team` MCP tool. Added `listTemplates()` and `launchTeam()` API clients.
- Task 7: Created `LaunchTeamDialog` modal with template cards (name, description, agent roles, task count), team name validation, and launch flow that navigates to `/teams/<name>`. Added "Launch Team" button to Dashboard.
- Task 8: 26 new tests (8 server + 18 UI) — total 201 tests (77 server + 124 UI), all passing. Fixed pre-existing dashboard test mock gaps.

### Change Log
- 2026-03-28: Implemented Story 6.4 — Canvas agent integration with agent badges, building indicators, team templates, and Launch Team dialog. 201 total tests passing.

### File List
New files:
- packages/server/src/agent-teams/templates.ts
- packages/server/src/__tests__/task-links-and-templates.test.ts
- packages/ui/src/components/agent-teams/LaunchTeamDialog.tsx
- packages/ui/src/__tests__/canvas-agent-integration.test.ts
- packages/ui/src/__tests__/launch-team-dialog.test.ts

Modified files:
- packages/server/src/api/routes/workflows.ts (task-links endpoint)
- packages/server/src/api/routes/teams.ts (template endpoints)
- packages/server/src/mcp/tools/agent-teams.ts (launch_team MCP tool)
- packages/shared/src/types/agent-teams.ts (TeamTemplate type)
- packages/shared/src/index.ts (re-export TeamTemplate)
- packages/ui/src/store/workflow.ts (taskLinks state + WS handlers)
- packages/ui/src/store/ws.ts (dual-route task events to workflow store)
- packages/ui/src/components/canvas/Canvas.tsx (task-link merge + agentColor)
- packages/ui/src/components/canvas/nodes/BaseNode.tsx (agent badge + building indicator)
- packages/ui/src/components/canvas/nodes/TriggerNode.tsx (pass linked agent props)
- packages/ui/src/components/canvas/nodes/CodeNode.tsx (pass linked agent props)
- packages/ui/src/components/canvas/nodes/HttpNode.tsx (pass linked agent props)
- packages/ui/src/components/canvas/nodes/LogicNode.tsx (pass linked agent props)
- packages/ui/src/components/canvas/nodes/AiNode.tsx (pass linked agent props)
- packages/ui/src/components/canvas/nodes/OutputNode.tsx (pass linked agent props)
- packages/ui/src/lib/api.ts (getTaskLinks, listTemplates, launchTeam)
- packages/ui/src/pages/Editor.tsx (load task links on mount)
- packages/ui/src/pages/Dashboard.tsx (Launch Team button + dialog)
- packages/ui/src/__tests__/dashboard.test.ts (fixed pre-existing mock gaps)

### Review Findings

- [x] [Review][Patch] launchTeamFromTemplate overwrites existing team directory without existence check — `mkdir({recursive:true})` + `writeTasksFile` silently destroys existing team data if team name already exists [packages/server/src/agent-teams/templates.ts:90]
- [x] [Review][Patch] getSnapshot race with unwatch in task-links endpoint — if team is unwatched between `isWatching()` and `getSnapshot()`, unhandled exception crashes the request with 500 [packages/server/src/api/routes/workflows.ts:215]
- [x] [Review][Patch] task_linked_to_node WS event creates link with null assignee — badge won't render until a subsequent team_tasks_updated event arrives; real-time linking while canvas is open shows no badge [packages/ui/src/store/workflow.ts:374-386]
- [x] [Review][Defer] Race condition: TOCTOU on workflow node mutation endpoints — concurrent read-modify-write without locking can silently drop mutations — deferred, pre-existing
- [x] [Review][Defer] connection_removed WS handler drops ALL connections between two nodes when connection_id is absent — deferred, pre-existing
- [x] [Review][Defer] node_updated WS reducer IIFE spreads unknown payload fields into node data — deferred, pre-existing
- [x] [Review][Defer] updateNodePosition debounce captures stale workflow state, can overwrite concurrent changes — deferred, pre-existing
- [x] [Review][Defer] add_task MCP tool doesn't require watching but update_task does — inconsistent behavior — deferred, pre-existing
- [x] [Review][Defer] Duplicate link_task_to_node inserts — unique constraint error unhandled gracefully — deferred, pre-existing
- [x] [Review][Defer] workflow_updated WS handler explicitly discards nodes/connections from server updates — deferred, pre-existing
- [x] [Review][Defer] duplicate endpoint copies node IDs verbatim — cross-workflow taskNodeLink collisions possible — deferred, pre-existing
- [x] [Review][Defer] API client throws generic status text, drops server JSON error body — deferred, pre-existing
- [x] [Review][Defer] Module-level mutable singletons (saveTimeout etc.) persist across tests — deferred, pre-existing
- [x] [Review][Defer] WS subscribe with empty workflowId (global connections) skips subscription registration — deferred, pre-existing
- [x] [Review][Defer] appendToInbox not atomic under concurrent writes — messages can be lost — deferred, pre-existing
- [x] [Review][Defer] validateName allows dot-prefix names creating hidden directories — deferred, pre-existing
- [x] [Review][Defer] Team events broadcast to ALL clients, not filtered by team subscription — deferred, pre-existing
- [x] [Review][Defer] No cycle detection in connection creation — deferred, pre-existing
- [x] [Review][Defer] Path traversal risk in get_agent_messages/send_team_message via agent_name if validateName has gaps — deferred, pre-existing

# flowAIbuilder

**Visual control center for Claude Code — see what your AI agents are building.**

flowAIbuilder gives you a real-time visual layer on top of Claude Code Agent Teams. Watch agents build workflows on a canvas, monitor their tasks and messages, and intervene when needed — all from your browser.

> **Zero AI cost model** — flowAIbuilder never calls the Claude API. It reads your local `~/.claude/teams/` files and exposes 15+ MCP tools that Claude Code calls directly.

---

## What it does

### Workflow Editor
Build and execute automation workflows visually. Add nodes, connect them, configure each step, hit Run, and watch data flow through in real-time.

- 6 node types: Webhook, HTTP Request, Code (JS), IF/Switch, Set, Respond
- Monaco code editor for JavaScript nodes
- Real-time execution overlay — blue (running), green (success), red (error) status rings
- WebSocket live sync — changes appear instantly, no refresh needed

### Agent Teams Dashboard
The feature nobody else has. When Claude Code Agent Teams build workflows, you see everything:

- **Agent cards** — who's working, who's idle, who's blocked
- **Task board** — Kanban-style board (unassigned → assigned → in-progress → done)
- **Message feed** — real-time messages between agents with auto-scroll
- **Canvas badges** — nodes show which agent is building them, with pulsing indicators for active work

### MCP Integration
15+ built-in MCP tools so Claude Code can create, edit, and execute workflows directly from the terminal:

```
flowaibuilder.create_workflow
flowaibuilder.add_node
flowaibuilder.connect_nodes
flowaibuilder.execute_workflow
flowaibuilder.watch_team
flowaibuilder.get_team_state
flowaibuilder.send_team_message
flowaibuilder.update_task
flowaibuilder.add_task
flowaibuilder.link_task_to_node
flowaibuilder.launch_team
...
```

---

## Quick Start

### Docker (recommended)

```bash
git clone https://github.com/zarevi4/flowaibuilder.git
cd flowaibuilder
docker compose up -d
```

Open [http://localhost:5173](http://localhost:5173) — that's it.

### Dev Mode

```bash
git clone https://github.com/zarevi4/flowaibuilder.git
cd flowaibuilder
npm install
```

Start PostgreSQL and Redis (or use Docker for just the databases):
```bash
docker compose up -d postgres redis
```

Then run the server and UI:
```bash
# Terminal 1 — server
npm run dev --workspace=@flowaibuilder/server

# Terminal 2 — UI
npm run dev --workspace=@flowaibuilder/ui
```

Open [http://localhost:5173](http://localhost:5173).

### Demo with test data

```bash
bash test-demo.sh
```

Creates a Lead Qualification Pipeline (5 nodes) + fake Agent Teams data with 3 agents, 5 tasks, and messages. Opens workflow editor and team dashboard.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Browser (UI)                    │
│  React + @xyflow/react + Zustand + Tailwind     │
│  Canvas, Sidebar, Dashboard, Team Dashboard     │
└──────────────┬───────────────┬──────────────────┘
               │ REST API      │ WebSocket
┌──────────────▼───────────────▼──────────────────┐
│                Server (Fastify)                  │
│  REST routes · MCP server (SSE) · WS broadcast  │
│  Workflow executor · Agent Teams file watcher    │
├──────────────┬───────────────┬──────────────────┤
│  PostgreSQL  │     Redis     │  ~/.claude/teams/ │
│  (workflows, │   (queues,    │  (fs.watch for    │
│   executions)│    future)    │   agent files)    │
└──────────────┴───────────────┴──────────────────┘
```

### Monorepo structure

```
packages/
├── server/          # Fastify API, MCP server, executor, agent-teams watcher
│   └── src/
│       ├── api/         # REST routes + WebSocket broadcaster
│       ├── engine/      # Workflow executor + node runners
│       ├── mcp/         # MCP server + 15 tools
│       ├── agent-teams/ # File watcher, parser, templates
│       ├── nodes/       # Node type handlers (webhook, http, code, if, set)
│       └── db/          # Drizzle ORM schema + migrations
├── ui/              # React SPA
│   └── src/
│       ├── components/  # Canvas nodes, sidebar forms, toolbar, dashboard
│       ├── pages/       # Dashboard, Editor, TeamDashboard
│       ├── store/       # Zustand stores (workflow, execution, ws, teams, ui)
│       └── lib/         # API client, utilities, mappers
└── shared/          # TypeScript types shared between server and UI
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Server | Fastify 5, Node.js 22 |
| Database | PostgreSQL 16, Drizzle ORM |
| Queue | Redis 7, BullMQ (provisioned) |
| UI | React 19, @xyflow/react, Zustand |
| Code Editor | Monaco Editor |
| Styling | Tailwind CSS |
| MCP | @modelcontextprotocol/sdk |
| Auth | Lucia Auth (provisioned) |
| Tests | Vitest (200+ tests) |
| Deploy | Docker Compose |

---

## Using with Claude Code

### Connect as MCP server

Add to your Claude Code config (`~/.claude.json`):

```json
{
  "mcpServers": {
    "flowaibuilder": {
      "command": "node",
      "args": ["packages/server/dist/mcp-stdio.js"],
      "cwd": "/path/to/flowaibuilder"
    }
  }
}
```

Or connect via SSE (when server is running):
```
http://localhost:3000/mcp/sse
```

### Example: Build a workflow from terminal

```
> claude

You: Create a lead qualification workflow with flowaibuilder.
     Add a webhook trigger, a code node that scores leads 1-10,
     an IF node that routes score >= 7 to a Slack notification.

Claude: [calls flowaibuilder.create_workflow]
        [calls flowaibuilder.add_node × 4]
        [calls flowaibuilder.connect_nodes × 3]
        Done! Open http://localhost:5173/editor/<id> to see it.
```

### Agent Teams integration

When you use Claude Code Agent Teams, flowAIbuilder watches `~/.claude/teams/` and shows:
- Which agents are working on which tasks
- Messages between agents
- Task status in real-time
- Agent badges on workflow nodes

---

## Node Types

| Type | Color | Description |
|------|-------|-------------|
| Webhook | Purple `#7F77DD` | HTTP trigger — receives incoming requests |
| HTTP Request | Coral `#D85A30` | Make external API calls |
| Code (JS) | Teal `#1D9E75` | Run JavaScript with access to `$json` input |
| IF | Amber `#BA7517` | Conditional routing based on field values |
| Set | Amber `#BA7517` | Transform data — add/modify fields |
| Respond Webhook | Gray `#888780` | Send response back to webhook caller |

---

## Tests

```bash
# Run all tests
npm test --workspaces

# Server tests only
npm test --workspace=@flowaibuilder/server

# UI tests only
npm test --workspace=@flowaibuilder/ui
```

200+ tests covering server routes, MCP tools, workflow executor, UI stores, and components.

---

## Workflow Versioning & Git Sync

Every graph-changing mutation records a point-in-time snapshot into
`workflow_versions`. You can list versions, diff any two, revert to one, or
push a version to a user-owned git repo as JSON.

**Env vars:**

- `FLOWAI_DATA_DIR` — directory used for the local git checkout (default `./.flowai`).
- `FLOWAI_ENCRYPTION_KEY` — 32-byte base64 key used to encrypt the git access
  token at rest via AES-256-GCM. If unset, a dev-only derived key is used.

**Enable git sync** in the Settings page: repo URL (https/ssh), branch, author
name + email, and a personal access token. With sync enabled, the Versions
panel shows a `Push` button per version and the MCP tools
`flowaibuilder.git_push` / `flowaibuilder.git_history` become available.

Reverts always produce a new version (never flip deployment state), and a
revert by a `viewer` is refused at both REST and MCP layers.

---

## Project Status

### Done
- ✅ Visual workflow canvas with React Flow
- ✅ 6 custom node types with config forms
- ✅ WebSocket real-time sync
- ✅ Monaco code editor in sidebar
- ✅ Toolbar — add, delete, connect nodes
- ✅ Workflow execution with live status overlay
- ✅ Dashboard with create/delete workflows
- ✅ Agent Teams file watcher + MCP read tools
- ✅ Agent Teams intervention MCP tools
- ✅ Agent Teams dashboard UI (cards, Kanban, messages)
- ✅ Canvas agent badges + team templates
- ✅ Docker one-command deploy

### Backlog
- ⬜ Execution history & trace viewer
- ⬜ AI Review system (annotations on canvas)
- ⬜ Protected Zones (pin nodes from AI modification)
- ⬜ n8n workflow import
- ⬜ Export to TypeScript/Docker/Mermaid
- ⬜ Authentication & RBAC
- ⬜ Git sync & versioning

---

## License

MIT — use it however you want.

---

## Built with

Built in 4 days using [Claude Code](https://claude.ai/code) + [BMAD methodology](https://github.com/bmad-method) for structured AI-assisted development.

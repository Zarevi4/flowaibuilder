# flowAIbuilder v3 - PRD (BMAD Format)

## Project Overview

**Product name:** flowAIbuilder  
**Tagline:** Open-source workflow engine built for AI agents and humans. All features free.  
**License:** MIT (true open source, not "fair-code")  
**BMAD Scale Level:** 2 (MVP in a day, full product over weeks)

## Vision

flowAIbuilder is a **direct open-source alternative to n8n** with four fundamental differences:

1. **AI-native** - designed from ground up for Claude Code / AI agents to create, edit, and execute workflows via MCP, not just humans clicking in a GUI
2. **AI Review (zero-cost)** - flowAIbuilder gives Claude the full workflow context via MCP, Claude analyzes it using the user's own subscription (Pro/Max) - no API costs on our side
3. **Agent Teams** - Claude doesn't just execute instructions - it autonomously proposes architecture, splits work into agent roles (Architect, Builder, Reviewer, Debugger), and the canvas visualizes what each agent is doing in real-time. Human steers, Claude drives.
4. **All enterprise features free** - SSO, audit logs, git versioning, environments, log streaming, queue scaling - everything n8n charges $333-$4000+/month for ships free in open source

## What n8n Charges For (That flowAIbuilder Gives Free)

| Feature | n8n tier | n8n cost | flowAIbuilder |
|---------|----------|----------|-----------|
| SSO (SAML/LDAP) | Enterprise | Custom ($$$) | Free, day one architecture |
| Audit logs | Enterprise | Custom | Free - every action logged |
| Git version control | Business | $333+/mo | Free - git-native by design |
| Environments (dev/staging/prod) | Business | $333+/mo | Free - env configs in repo |
| Log streaming | Enterprise | Custom | Free - stdout/webhook/S3 |
| Queue-mode scaling | Business | $333+/mo | Free - BullMQ + Redis |
| Workflow history & versioning | Limited free | Pro+ for full | Free - unlimited |
| External secrets | Enterprise | Custom | Free - Vault/env/KMS |
| Advanced execution data | Business+ | $333+/mo | Free - full execution traces |
| Shared projects & collaboration | Pro+ | $50+/mo | Free - unlimited |
| Worker nodes (horizontal scale) | Business | $333+/mo | Free - spawn workers |
| Custom RBAC | Enterprise | Custom | Free - role system built in |

## Why This Can Work

n8n's "Sustainable Use License" means it's NOT truly open source - companies can't freely compete with it. flowAIbuilder under MIT has no restrictions. The community frustration is real: people want enterprise features without enterprise pricing.

The n8n-skills knowledge base (7 skills, 525+ nodes, 2653 templates) proves Claude already understands workflow patterns deeply. flowAIbuilder channels that understanding into a native execution engine.

## Core Architecture

```
+--Human (browser)--+     +--Claude Code (terminal)--+
|  React Flow       |     |  n8n-skills loaded        |
|  Visual Canvas    |     |  MCP client               |
+---------+---------+     +-----------+---------------+
          |                           |
     WebSocket                   MCP (stdio)
          |                           |
+---------+---------------------------+---------+
|            flowAIbuilder Server                    |
|                                                |
|  +-- API Layer (REST + WebSocket + MCP) ----+ |
|  |                                          | |
|  |  +-- Workflow Engine -------+            | |
|  |  |  Execute nodes           |            | |
|  |  |  Manage state            |            | |
|  |  |  Error handling          |            | |
|  |  |  Retry logic             |            | |
|  |  +--------------------------+            | |
|  |                                          | |
|  |  +-- Enterprise Layer (ALL FREE) -----+ | |
|  |  |  Auth (local + SSO/SAML/LDAP)      | | |
|  |  |  Audit log (every action)           | | |
|  |  |  Git sync (workflow-as-code)        | | |
|  |  |  Environments (dev/staging/prod)    | | |
|  |  |  Execution history (full traces)    | | |
|  |  |  Log streaming (stdout/webhook/S3)  | | |
|  |  |  Queue mode (BullMQ + Redis)        | | |
|  |  |  RBAC (roles + permissions)         | | |
|  |  |  Secrets manager (env/Vault)        | | |
|  |  +------------------------------------+ | |
|  |                                          | |
|  |  +-- Node Runtime ---------+            | |
|  |  |  Code (JS/Python)       |  <-- 80%   | |
|  |  |  HTTP Request           |  of usage  | |
|  |  |  Webhook trigger        |            | |
|  |  |  IF / Switch / Merge    |            | |
|  |  |  Set / Transform        |            | |
|  |  |  AI Agent (Claude/GPT)  |            | |
|  |  |  + community nodes      |            | |
|  |  +--------------------------+            | |
|  +------------------------------------------+ |
|                                                |
|  +-- Storage ---------+                        |
|  |  SQLite (dev)      |                        |
|  |  PostgreSQL (prod) |                        |
|  |  Redis (queue)     |                        |
|  +--------------------+                        |
+------------------------------------------------+
```

## AI Review - Core Feature

The visual graph IS a structured prompt. Claude reads the entire workflow graph through MCP - every node config, every API endpoint, every expression, every connection - and generates actionable annotations directly on the canvas.

### How It Works

1. Human (or Claude) builds a workflow on the canvas
2. Human clicks "AI Review" (or Claude auto-reviews on save)
3. Claude calls `flowaibuilder.review_workflow` via MCP
4. flowAIbuilder returns the full graph context: nodes, connections, data flow, credentials used
5. Claude analyzes and returns structured suggestions
6. Suggestions appear as annotations ON the canvas, attached to specific nodes
7. Human clicks a suggestion to either:
   - "Apply" - Claude fixes it automatically via MCP
   - "Explain" - Claude explains the issue in chat
   - "Dismiss" - human disagrees, annotation goes away

### Three Levels of Annotations

**Errors (red)** - things that will break:
- "HTTP Request node has no Authorization header - API will return 401"
- "Expression `{{email}}` references a field that doesn't exist at this point in the graph - data arrives as `$json.body.email`"
- "Code node returns `{result: data}` but next node expects `[{json: {...}}]` format"
- "Webhook path /api/leads conflicts with another active workflow"
- "Circular dependency detected: Node A -> B -> C -> A"

**Warnings (amber)** - things that should be improved:
- "IF node's false branch leads to dead end - cold leads are silently dropped"
- "No error handling after HTTP Request - if CRM API is down, whole workflow fails silently"
- "Slack notification says 'New hot lead!' but includes no lead details (name, score, CRM link)"
- "Code node is 85 lines - consider splitting into transform + API call for readability"
- "No retry logic on external API calls - transient failures will lose data"
- "Hardcoded API URL - should use $env or $secrets for different environments"

**Suggestions (blue)** - optimizations:
- "Two sequential HTTP Requests to same API can be batched into one call"
- "This pattern matches 'webhook processing' - consider adding a 'Respond to Webhook' node to return 200 early before heavy processing"
- "Rate limiting: Slack API allows 1 msg/sec - add a delay node before the loop"
- "Similar workflow exists in templates (#1247) with better error handling - want to see it?"
- "Add execution metadata logging (timestamp, source IP, processing time) for observability"

### Review Modes

**On-demand review** - human clicks "AI Review" button, Claude analyzes the current state.

**Auto-review on save** - every time the workflow is saved (by human or Claude), a background review runs. New annotations appear on canvas. Can be toggled on/off in settings.

**Continuous review** - Claude watches changes via WebSocket. As human edits in real-time, Claude updates suggestions within seconds. Premium mode for complex workflows.

**Execution review** - after a workflow runs (especially on error), Claude analyzes the execution trace. "Node 3 failed because the CRM API returned 429 Too Many Requests. Your loop processes 500 items without delay. Add a rate limiter: $helpers.wait(200) between iterations."

**Pre-deploy review** - before activating a workflow for production, Claude runs a comprehensive check: security (exposed secrets?), performance (unbounded loops?), reliability (error handling?), data integrity (are all fields mapped correctly?).

### Knowledge Sources for Review

Claude's review quality comes from layering multiple knowledge sources:

**n8n-skills knowledge base:**
- Expression syntax rules (e.g. "webhook data is under $json.body")
- Code node patterns (correct return format, $helpers usage)
- Workflow pattern best practices (5 architectural patterns)
- Common validation errors and fixes
- Node configuration dependencies

**Workflow context:**
- Full node graph with all configs
- Data flow between nodes (what fields are available at each step)
- Credential types and API requirements
- Execution history (if available - what failed before)

**General API knowledge:**
- Common API authentication patterns
- Rate limiting conventions
- Error response formats
- REST/GraphQL best practices

### Technical Implementation: Zero-Cost Architecture

flowAIbuilder does NOT call Claude API. The user's own Claude (Pro/Max subscription) does all the thinking. flowAIbuilder only provides tools and data.

**The flow:**
1. User in Claude Code: "Review my workflow for issues"
2. Claude calls `flowaibuilder.get_review_context({ workflow_id })` via MCP
3. flowAIbuilder returns: full graph (nodes, configs, connections, data flow, execution history)
4. Claude THINKS (on user's subscription - zero cost for us)
5. Claude calls `flowaibuilder.save_annotations({ workflow_id, annotations: [...] })` via MCP
6. flowAIbuilder saves to DB, broadcasts to canvas via WebSocket
7. User sees annotations on canvas in browser

```typescript
// MCP tool: flowaibuilder.get_review_context
// Returns EVERYTHING Claude needs to analyze the workflow
// Claude does the analysis itself - we just serve data
interface ReviewContext {
  workflow: {
    id: string;
    name: string;
    nodes: Array<{
      id: string;
      type: string;
      name: string;
      config: Record<string, unknown>;
      incoming_data_fields: string[];    // what fields arrive at this node
      outgoing_data_fields: string[];    // what fields this node outputs
    }>;
    connections: Connection[];
    detected_pattern: string;            // "webhook_processing" | "api_chain" etc
    credentials_used: string[];
  };
  // Execution history (if available)
  recent_executions?: Array<{
    status: string;
    error?: string;
    node_errors?: Array<{ node_id: string; error: string }>;
    duration_ms: number;
  }>;
  // Existing annotations (so Claude doesn't duplicate)
  current_annotations: Annotation[];
}

// MCP tool: flowaibuilder.save_annotations  
// Claude writes its analysis back through this tool
interface SaveAnnotationsInput {
  workflow_id: string;
  annotations: Array<{
    node_id: string;
    severity: "error" | "warning" | "suggestion";
    title: string;
    description: string;
    fix?: {
      tool: string;         // e.g. "flowaibuilder.update_node"
      params: object;       // exact MCP call to fix it
      description: string;
    };
  }>;
  health_score: number;       // 0-100
}

// MCP tool: flowaibuilder.apply_fix
// Claude can also immediately apply its own fix
interface ApplyFixInput {
  workflow_id: string;
  annotation_id: string;     // applies the fix defined in the annotation
}
```

**What flowAIbuilder computes server-side (no AI needed):**
- Data flow tracing (which fields are available at each node)
- Pattern detection (simple rule-based: has webhook? has AI agent? has schedule?)
- Credential type extraction
- Connection validation (orphan nodes, circular deps)

**What Claude computes client-side (on user's subscription):**
- Semantic analysis (is the prompt good? is the API call correct?)
- Security review (missing auth? exposed secrets?)
- Best practice suggestions (error handling, retry logic, rate limiting)
- Fix generation (exact MCP tool calls to resolve each issue)

### Canvas UI for Annotations

```
+---[Enrich from CRM]---+     +-- AI suggestion --------+
|  GET /api/contacts     | --- | ! Missing auth           |
|  No auth header!       |     | API requires Bearer      |
+------------------------+     | token from $secrets      |
                               |                          |
                               | [Apply fix] [Explain]    |
                               +--------------------------+
```

Each annotation:
- Attaches to a specific node via a connector line
- Color-coded by severity (red/amber/blue)
- Shows title + short description
- Has action buttons: "Apply" (Claude fixes via MCP), "Explain" (opens chat), "Dismiss"
- Can be toggled on/off globally via "AI Review" button
- Counter badge shows total annotation count

### Workflow Health Score

Every review generates a 0-100 health score visible on the canvas header:

- **90-100 (green)**: Production ready. All APIs authenticated, error handling in place, no dead ends.
- **70-89 (amber)**: Working but improvable. Missing some best practices.
- **50-69 (orange)**: Has issues. Some nodes will likely fail in production.
- **0-49 (red)**: Critical problems. Missing auth, broken connections, data mismatches.

Score breakdown:
- Security (auth, secrets, exposed data): 25 points
- Reliability (error handling, retries, dead ends): 25 points
- Data integrity (field mapping, types, expressions): 25 points
- Best practices (patterns, readability, documentation): 25 points

## Agent Teams - Visual Dashboard for Claude Code Multi-Agent

Claude Code Agent Teams (experimental, shipped with Opus 4.6) lets multiple Claude Code sessions work together: one lead coordinates, teammates work in parallel, each in its own context window, with shared task lists and peer-to-peer messaging.

Right now this all happens **in the terminal**. Text output, JSON inbox files, tmux panes. Nobody can see the big picture.

flowAIbuilder becomes the **visual control center** for Agent Teams. Two views:

### View 1: Team Dashboard

Shows agents as cards, tasks as a board, messages as a feed:

- **Agent cards**: name, role, status (working/idle/blocked), current task, completed tasks
- **Task board**: all tasks with status (unassigned/in-progress/blocked/done), assigned agent, dependencies
- **Message feed**: inter-agent messages in real-time
- **Progress bar**: overall completion percentage

Human can:
- Add/remove teammates (writes to team config)
- Reassign tasks (edits tasks.json)
- Add new tasks
- Wake idle agents early
- Send messages to any agent
- Pause/stop the whole team

### View 2: Workflow Canvas (same React Flow canvas)

Each node on the canvas shows **which agent is building it**:
- Agent name badge on each node
- Color-coded by agent (api-builder = teal, ai-classifier = coral, etc)
- Proposed nodes (dashed) vs confirmed nodes (solid)
- Live: nodes transition from proposed -> building -> configured -> tested as agents work

Human can see the workflow being built by multiple agents simultaneously, and intervene on any node.

### How It Works Technically

Claude Code Agent Teams communicate via files on disk:
```
~/.claude/teams/<teamName>/
  inboxes/<agentName>.json    # peer-to-peer messages
  tasks.json                   # shared task list
```

flowAIbuilder MCP server watches these files with `fs.watch()` and:
1. Parses agent messages, task status changes
2. Broadcasts to canvas via WebSocket
3. Translates human actions (reassign, add task) back to file writes

**flowAIbuilder does NOT spawn or control agents.** Claude Code handles that. flowAIbuilder is a read-mostly observer that provides visual feedback and human controls.

### MCP Tools for Agent Teams Visualization

```
# Read-only: observe what Agent Teams are doing
flowaibuilder.watch_team          { team_name }                    # start watching inbox/task files
flowaibuilder.get_team_state      { team_name }                    # current snapshot: agents, tasks, messages
flowaibuilder.get_agent_messages  { team_name, agent_name, limit? }

# Write: human interventions (writes to same files Agent Teams use)
flowaibuilder.send_team_message   { team_name, to_agent, message }  # human -> agent message
flowaibuilder.update_task         { team_name, task_id, changes }   # reassign, change status, add blockers
flowaibuilder.add_task            { team_name, task }                # add new task to shared list
flowaibuilder.set_task_assignment { team_name, task_id, agent_name } # reassign task

# Bridge: connect Agent Teams work to the workflow canvas
flowaibuilder.link_task_to_node   { team_name, task_id, workflow_id, node_id }  # this task builds this node
flowaibuilder.get_team_workflow    { team_name }  # auto-generate workflow from team's completed tasks
```

### Three Modes of Operation

**Mode 1: Agent Teams -> flowAIbuilder (observe)**
Claude Code spawns Agent Teams normally (in terminal). flowAIbuilder watches and visualizes. Human sees the dashboard, but the team was started from CLI.

```bash
# Terminal
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
claude "Build a lead qualification workflow with 3 teammates"
# Claude spawns team-lead + api-builder + ai-classifier + reviewer

# Browser: flowAIbuilder auto-detects the team at ~/.claude/teams/
# Dashboard appears with live agent cards, tasks, messages
```

**Mode 2: flowAIbuilder -> Agent Teams (design + launch)**
Human designs the team structure visually on flowAIbuilder canvas, then launches it. flowAIbuilder writes the initial team config and task list, then Claude Code picks it up.

```
Human on canvas:
1. Drags "Agent" cards onto team view
2. Names them: api-builder, ai-classifier, reviewer
3. Creates tasks, assigns to agents, sets dependencies
4. Clicks "Launch Team"

flowAIbuilder:
1. Writes team config to ~/.claude/teams/<teamName>/
2. Writes tasks.json with all tasks
3. Triggers Claude Code to start the team (or user starts manually)

Agent Teams run. flowAIbuilder watches and visualizes.
```

**Mode 3: Hybrid (most common)**
Human starts in Claude Code: "Build me a lead qualification system". Claude proposes a team. flowAIbuilder shows the proposed team on dashboard. Human edits: adds a testing agent, changes task assignments, adds a task. Changes write back to the files. Agent Teams pick up the changes.

### Agent Team Templates

flowAIbuilder ships with pre-built team templates:

**Webhook Pipeline Team** (3 agents):
- api-builder: webhook setup, HTTP nodes, data extraction
- logic-builder: conditions, routing, transforms
- reviewer: reviews all nodes, runs tests

**AI Workflow Team** (4 agents):
- api-builder: HTTP integrations, data plumbing
- ai-prompt-engineer: Claude/GPT prompts, output parsing
- error-handler: retry logic, fallbacks, logging
- reviewer: security review, test execution

**Full-Stack Automation Team** (5 agents):
- architect: designs the workflow structure
- api-builder: builds HTTP/Code nodes
- ai-builder: builds AI/LLM nodes
- tester: writes test data, runs executions, validates
- reviewer: security, best practices, documentation

Users can create and share custom templates.

### What the Canvas Shows During Agent Team Execution

```
+-- Team: lead-qualification-build ---- [4 agents] [57%] ----+
|                                                              |
|  [team-lead]     [api-builder]    [ai-classifier] [reviewer]|
|   Coordinating    Building          Building        Idle     |
|   2 messages      Task 3: CRM      Task 4: Score   Waiting  |
|                                                              |
+--------------------------------------------------------------+

+-- Workflow canvas (live) ------------------------------------+
|                                                              |
|  [Webhook]          built by: api-builder   ✓ done          |
|       |                                                      |
|  [Extract data]     built by: api-builder   ✓ done          |
|       |                                                      |
|  [CRM Enrichment]   built by: api-builder   ⟳ building     |
|       |                                                      |
|  [AI Score]         built by: ai-classifier  ⊘ blocked      |
|       |                                                      |
|  [IF >= 7?]         unassigned               ○ pending      |
|     /     \                                                  |
|  [Slack]  [Nurture]  unassigned              ○ pending      |
|                                                              |
+--------------------------------------------------------------+
```

### Why This Is Powerful

**For the human**: Instead of staring at 4 tmux panes of scrolling text, you see a clean dashboard + live workflow. You know exactly what each agent is doing, what's blocked, and where to intervene.

**For the agents**: flowAIbuilder doesn't slow them down. It's read-mostly. But when the human sends a message or reassigns a task, agents see it immediately (same inbox files).

**For flowAIbuilder**: This is the killer feature that no other workflow tool has. n8n can't do this. Make can't do this. Even n8n-mcp can't do this. Only flowAIbuilder sits at the intersection of visual workflow editor + Claude Code Agent Teams.

**For adoption**: Anyone who uses Claude Code Agent Teams will want flowAIbuilder as their dashboard. And once they have flowAIbuilder, they also get the workflow engine, AI Review, and enterprise features.

## How It Differs From n8n (For Users)

### For humans:
- Same visual canvas experience (React Flow based, just like n8n)
- Same concept: nodes, connections, triggers, executions
- PLUS: AI Review annotations on canvas - Claude reviews using your subscription, zero cost
- PLUS: Agent Teams dashboard - see multiple Claude Code sessions building your workflow in real-time, edit team structure, reassign tasks, send messages
- PLUS: all enterprise features unlocked from day one
- PLUS: workflow-as-code (git-native, not bolted on)

### For AI agents:
- MCP server built in (not a separate tool)
- Claude can create_workflow, add_node, execute, debug - all via MCP
- Claude Code Agent Teams integration: flowAIbuilder watches `~/.claude/teams/` and visualizes everything
- Human edits team structure visually, changes write back to same files agents use
- All AI runs on user's Claude subscription - flowAIbuilder is just tools, data, and visualization
- n8n-skills knowledge base compatible
- Workflow JSON designed to be LLM-readable (clear field names, descriptions)
- AI can read execution logs and self-debug

### For developers:
- MIT license (truly open, no "sustainable use" restrictions)
- Plugin system for custom nodes (npm packages)
- TypeScript-first codebase
- Standard tools: Docker, PostgreSQL, Redis - no proprietary components

## Protected Zones - Pin What Works, Let AI Iterate the Rest

When humans and AI build workflows together, the biggest fear is: "AI will break what I already got working." Protected Zones solve this.

### The Concept

The human selects a group of nodes on the canvas and clicks "Pin zone" (or draws a rectangle around them). Those nodes become a **Protected Zone** - a visually distinct area with a colored boundary that AI cannot modify.

Claude (via MCP) can still **read** pinned nodes (see configs, trace data flow through them), but cannot **write** (no update_node, remove_node, disconnect on pinned nodes). The MCP server enforces this - if Claude tries to modify a pinned node, the tool returns an error: "Node is in protected zone 'CRM Integration'. Unpin to modify."

### What It Looks Like on Canvas

```
+== Protected: CRM Integration ====  (blue dashed boundary, lock icon) ==+
‖                                                                          ‖
‖  [Webhook]  ----  [Extract Data]  ----  [CRM Enrichment]                ‖
‖   POST /leads      name, email          GET /api/contacts               ‖
‖                                         Bearer $secrets.CRM_KEY         ‖
‖                                                                          ‖
+== pinned by Alex, Mar 24 ============================================== +
         |
         | (data flows OUT of protected zone into editable area)
         v
  [AI Scoring]  ----  [IF >= 7?]  ----  [Slack Notify]
   editable           editable           editable
```

Nodes inside the zone:
- **Blue dashed boundary** around the group
- **Lock icon** on each pinned node
- **Slightly dimmed** to visually separate from editable area
- **Label**: zone name + who pinned it + when
- **Cannot be dragged** out of the zone (positions locked too)

Nodes outside:
- Normal appearance, fully editable
- AI can add, remove, reconnect, modify freely
- Data flows freely between pinned and unpinned zones

### Use Cases

**"This integration took me 3 hours to get right - don't touch it"**
Human pins the CRM integration chain. Tells Claude: "Add error handling and a Slack notification after the CRM nodes, but don't change the CRM chain itself." Claude can add nodes after the pinned zone, read the pinned nodes' output schema, but can't modify them.

**"Build around this core"**
Human pins 2-3 nodes that are the proven core of the workflow. Tells Claude: "I need pre-processing before these nodes and post-processing after. Design the full pipeline." Claude sees the pinned nodes as fixed waypoints and builds around them.

**"Multiple teams, one workflow"**
Team A owns the data ingestion (pinned). Team B owns the AI processing (pinned). Claude (or a new teammate) builds the glue between them. Neither pinned zone can be modified by anyone except the team that pinned it.

**"Iterative development"**
Build workflow step by step. Each time a section works, pin it. Tell Claude to build the next section. Pin that too. Eventually the whole workflow is pinned = production-ready.

### MCP Enforcement

```
flowaibuilder.create_zone      { workflow_id, name, node_ids[], color? }
flowaibuilder.delete_zone      { workflow_id, zone_id }
flowaibuilder.add_to_zone      { workflow_id, zone_id, node_ids[] }
flowaibuilder.remove_from_zone { workflow_id, zone_id, node_ids[] }
flowaibuilder.get_zones        { workflow_id }
```

**Server-side enforcement** - the MCP server checks every write operation:

```typescript
// Before any node modification:
async function enforceZones(workflow_id: string, node_id: string, operation: string) {
  const zones = await getZones(workflow_id);
  const zone = zones.find(z => z.node_ids.includes(node_id));
  if (zone) {
    throw new McpError(
      `Cannot ${operation} node "${node_id}" - it is in protected zone "${zone.name}". ` +
      `Pinned by ${zone.pinned_by} on ${zone.pinned_at}. ` +
      `You can read this node's config and data flow, but not modify it. ` +
      `Build around it or ask the human to unpin.`
    );
  }
}
```

Claude gets a clear error message explaining WHY it can't modify and WHAT to do instead. This guides Claude to work around the zone rather than fight it.

**Read access is unrestricted** - Claude can always:
- Read pinned node configs (to understand data flow)
- Trace data flowing through pinned nodes
- Connect new nodes to pinned nodes' outputs
- Reference pinned nodes in conditions and expressions

### Zone Data Model

```typescript
interface ProtectedZone {
  id: string;
  workflow_id: string;
  name: string;                    // "CRM Integration"
  node_ids: string[];              // nodes in this zone
  color: string;                   // boundary color on canvas
  
  // Lock metadata
  pinned_by: string;               // "user:alex@..." or "agent:reviewer"
  pinned_at: string;
  reason?: string;                 // "Production-tested, do not modify"
  
  // Permissions (future: RBAC per zone)
  can_unpin: string[];             // who can unpin (default: creator + admins)
}
```

### Canvas Interactions

**Pin**: Select nodes -> right-click -> "Create protected zone" -> name it
**Unpin**: Click zone boundary -> "Unpin zone" (only if you have permission)
**Expand**: Drag new node into zone boundary -> "Add to zone?"
**Shrink**: Drag node out of zone boundary -> "Remove from zone?"

### AI Review + Protected Zones

When Claude runs AI Review, it treats pinned zones differently:
- **No error/warning annotations** on pinned nodes (they're considered "accepted as-is")
- **Suggestions** can reference pinned nodes ("The output of your CRM zone lacks error handling - consider adding a try/catch node AFTER the zone")
- **Health score** for pinned zones is locked at their last review score - overall score is weighted average

### Agent Teams + Protected Zones

When Agent Teams build a workflow, zones add safety:
- Lead agent can pin zones before assigning tasks: "Don't touch the webhook chain"
- Teammates automatically respect zones (MCP enforcement)
- After a teammate finishes their section and it's reviewed, it can be pinned
- Progressive pinning: as sections get built and tested, they get locked down

## Node Strategy

Based on n8n-skills data, Claude uses ~15 node types for 95% of workflows.

### Core nodes (ship day one)

**Triggers:**
- Webhook (HTTP endpoint)
- Schedule (cron)
- Manual (button click)

**Logic:**
- Code (JavaScript) - THE workhorse, handles 80% of logic
- Code (Python) - for data science / ML cases
- IF (condition with true/false branches)
- Switch (multi-branch routing)
- Merge (combine data streams)
- Loop (iterate over items)
- Set (set/modify data fields)

**Integration:**
- HTTP Request (any API - Claude's primary integration tool)
- AI Agent (LLM with tool calling)

**Output:**
- Respond to Webhook (return HTTP response)

### Community nodes (week 2+)
- npm-based plugin system
- Anyone can publish a flowAIbuilder node
- n8n node compatibility layer (converter tool)

## MCP Server (Built Into flowAIbuilder)

Not a separate package - the MCP server IS part of flowAIbuilder server.

### Workflow management
```
flowaibuilder.create_workflow    { name, description, nodes?, edges? }
flowaibuilder.get_workflow       { id }
flowaibuilder.list_workflows     { filter?, limit? }
flowaibuilder.delete_workflow    { id }
flowaibuilder.duplicate_workflow { id, new_name }
```

### Node operations  
```
flowaibuilder.add_node          { workflow_id, type, name, config, connect_after? }
flowaibuilder.update_node       { workflow_id, node_id, changes }
flowaibuilder.remove_node       { workflow_id, node_id }
flowaibuilder.connect_nodes     { workflow_id, source, target, label? }
flowaibuilder.disconnect_nodes  { workflow_id, source, target }
```

### Execution
```
flowaibuilder.execute_workflow   { id, input_data? }
flowaibuilder.get_execution      { execution_id }
flowaibuilder.list_executions    { workflow_id, limit?, status? }
flowaibuilder.stop_execution     { execution_id }
flowaibuilder.retry_execution    { execution_id }
```

### Export & import
```
flowaibuilder.export             { workflow_id, format: "prompt"|"typescript"|"python"|"mermaid"|"json" }
flowaibuilder.import_n8n         { n8n_workflow_json }  // import from n8n!
flowaibuilder.validate           { workflow_id }
```

### Enterprise tools (free!)
```
flowaibuilder.get_audit_log      { workflow_id?, user?, since? }
flowaibuilder.get_execution_log  { execution_id, detail_level: "summary"|"full"|"debug" }
flowaibuilder.git_push           { workflow_id, message }
flowaibuilder.git_history        { workflow_id }
flowaibuilder.set_environment    { workflow_id, env: "dev"|"staging"|"prod" }
flowaibuilder.manage_secrets     { action: "list"|"set"|"delete", key?, value? }
```

### AI Review tools (zero-cost - Claude does the thinking, we just serve data)
```
flowaibuilder.get_review_context  { workflow_id }                // returns full graph + data flow + execution history
flowaibuilder.save_annotations    { workflow_id, annotations[], health_score }  // Claude writes analysis back
flowaibuilder.apply_fix           { workflow_id, annotation_id }  // applies fix defined in annotation
flowaibuilder.dismiss_annotation  { workflow_id, annotation_id, reason? }
flowaibuilder.get_annotations     { workflow_id, severity? }
```

### Agent Teams tools (visual dashboard for Claude Code Agent Teams)
```
# Observe: read from ~/.claude/teams/ files
flowaibuilder.watch_team           { team_name }                    # start file watcher on team inboxes + tasks
flowaibuilder.get_team_state       { team_name }                    # snapshot: agents, tasks, messages, progress
flowaibuilder.get_agent_messages   { team_name, agent_name, limit? }

# Intervene: write to same files Agent Teams use
flowaibuilder.send_team_message    { team_name, to_agent, message } # human -> agent via inbox file
flowaibuilder.update_task          { team_name, task_id, changes }  # reassign, add blockers, change status
flowaibuilder.add_task             { team_name, task }              # new task in shared task list
flowaibuilder.set_task_assignment  { team_name, task_id, agent_name }

# Bridge: connect Agent Teams work to workflow canvas
flowaibuilder.link_task_to_node    { team_name, task_id, workflow_id, node_id }  # this task builds this node
flowaibuilder.get_team_workflow     { team_name }                   # auto-generate workflow from completed tasks
```

flowAIbuilder reads/writes the same `~/.claude/teams/<teamName>/` files that Agent Teams use. No custom protocol - just file system integration. This means flowAIbuilder works with any version of Agent Teams without API coupling.

## Data Model

### Workflow
```typescript
interface Workflow {
  id: string;
  name: string;
  description: string;
  active: boolean;
  
  // Graph
  nodes: WorkflowNode[];
  connections: Connection[];
  
  // Enterprise (ALL FREE)
  version: number;
  environment: "dev" | "staging" | "prod";
  git_sha?: string;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  tags: string[];
  
  // Visual state
  canvas: {
    positions: Record<string, { x: number; y: number }>;
    viewport: { x: number; y: number; zoom: number };
    annotations: Annotation[];       // AI Review annotations on canvas
  };
  
  // AI Review state
  review: {
    health_score: number;            // 0-100
    last_reviewed_at?: string;
    auto_review_enabled: boolean;    // review on every save
    annotations_count: {
      errors: number;
      warnings: number;
      suggestions: number;
    };
  };
  
  // Settings
  settings: {
    timezone: string;
    error_workflow_id?: string;  // workflow to run on error
    max_execution_time: number;
    retry_on_fail: boolean;
    retry_attempts: number;
  };
}
```

### Execution (full logging - FREE)
```typescript
interface Execution {
  id: string;
  workflow_id: string;
  workflow_version: number;
  
  status: "running" | "success" | "error" | "cancelled" | "waiting";
  started_at: string;
  finished_at?: string;
  duration_ms?: number;
  
  // Full execution data (n8n charges for this)
  mode: "manual" | "trigger" | "webhook" | "retry";
  trigger_data?: unknown;
  
  // Per-node execution trace (enterprise feature in n8n)
  node_executions: Array<{
    node_id: string;
    node_name: string;
    status: "success" | "error" | "skipped";
    started_at: string;
    duration_ms: number;
    input_data: unknown;     // what went in
    output_data: unknown;    // what came out
    error?: {
      message: string;
      stack: string;
    };
  }>;
  
  // Audit (enterprise in n8n)
  triggered_by: string;     // user or "system" or "mcp:claude"
}
```

### Audit Log (enterprise in n8n - FREE here)
```typescript
interface AuditEntry {
  id: string;
  timestamp: string;
  actor: string;           // user email or "mcp:claude-code"
  action: string;          // "workflow.created" | "node.updated" | "execution.started" etc
  resource_type: string;   // "workflow" | "node" | "credential" | "user"
  resource_id: string;
  changes?: {              // what changed
    before: unknown;
    after: unknown;
  };
  metadata?: {
    ip?: string;
    user_agent?: string;
    mcp_tool?: string;     // which MCP tool was used
  };
}
```

### AI Review Annotation
```typescript
interface Annotation {
  id: string;
  workflow_id: string;
  node_id: string;                // which node this is attached to
  
  severity: "error" | "warning" | "suggestion";
  title: string;                  // short label for canvas (e.g. "Missing auth")
  description: string;            // detailed explanation
  
  // Actionable fix - Claude can apply this via MCP with one click
  fix?: {
    tool: string;                 // MCP tool to call (e.g. "flowaibuilder.update_node")
    params: Record<string, unknown>;  // exact params for the MCP call
    description: string;          // human-readable fix description
    estimated_impact: string;     // "Prevents 401 errors on CRM API calls"
  };
  
  // Context
  related_nodes?: string[];       // other nodes involved in this issue
  knowledge_source?: string;      // which n8n-skill identified this
  template_reference?: number;    // similar template from n8n-skills library
  
  // State
  status: "active" | "applied" | "dismissed";
  dismissed_reason?: string;      // if human dismissed, why
  created_at: string;
  applied_at?: string;
}

// Review result (returned by flowaibuilder.review_workflow)
interface WorkflowReview {
  workflow_id: string;
  review_type: "full" | "quick" | "security" | "performance";
  
  summary: string;                // "Found 2 errors, 3 warnings, 1 suggestion"
  health_score: number;           // 0-100
  
  // Score breakdown
  scores: {
    security: number;             // 0-25 (auth, secrets, data exposure)
    reliability: number;          // 0-25 (error handling, retries, dead ends)
    data_integrity: number;       // 0-25 (field mapping, types, expressions)
    best_practices: number;       // 0-25 (patterns, readability, docs)
  };
  
  annotations: Annotation[];
  patterns_detected: string[];    // ["webhook_processing", "api_chain"]
  
  // Execution-specific (only for review_execution)
  execution_insights?: {
    bottleneck_node?: string;     // slowest node
    failure_root_cause?: string;  // what actually caused the failure
    data_flow_issues?: string[];  // fields that were null/undefined unexpectedly
  };
}
```

| Layer | Choice | Why |
|-------|--------|-----|
| Runtime | Node.js + TypeScript | Same as n8n, familiar to ecosystem |
| Framework | Fastify | Faster than Express, schema validation built in |
| Canvas UI | React + @xyflow/react + Tailwind | Industry standard for node editors |
| State (UI) | Zustand | Lightweight, React Flow compatible |
| Database | SQLite (dev) / PostgreSQL (prod) | Same as n8n, easy migration path |
| Queue | BullMQ + Redis | Production-grade job queue, free |
| Auth | Lucia Auth | MIT, supports local + OAuth + SAML |
| MCP | @modelcontextprotocol/sdk | Official SDK |
| Real-time | WebSocket (ws) | Push updates to canvas |
| Git sync | isomorphic-git | Pure JS git implementation |
| Secrets | env vars + optional Vault | Simple default, enterprise optional |
| ORM | Drizzle | TypeScript-first, lightweight |
| Build (server) | tsup | Fast TS bundler |
| Build (UI) | Vite | Fast dev, good DX |
| Container | Docker + docker-compose | One-command deploy |

## Deploy Model

### Local (like n8n self-hosted)
```bash
git clone https://github.com/user/flowaibuilder && cd flowaibuilder
docker compose up -d
# flowAIbuilder UI: http://localhost:5173
# flowAIbuilder API: http://localhost:3000
```

Then in Claude Code:
```bash
claude --mcp-config '{"flowaibuilder": {"command": "npx", "args": ["flowaibuilder-mcp", "--url", "http://localhost:3000"]}}'
```

Or add to `.claude/mcp.json`:
```json
{
  "mcpServers": {
    "flowaibuilder": {
      "command": "npx",
      "args": ["flowaibuilder-mcp", "--url", "http://localhost:3000"]
    }
  }
}
```

### VPS (for teams)
Same docker compose, any $5/mo VPS:
```bash
ssh my-vps
docker compose up -d
# Accessible at https://flowaibuilder.mycompany.com
```

Claude Code connects via SSE/HTTP MCP transport:
```json
{
  "mcpServers": {
    "flowaibuilder": {
      "type": "sse",
      "url": "https://flowaibuilder.mycompany.com/mcp/sse",
      "headers": { "Authorization": "Bearer <user-token>" }
    }
  }
}
```

### Requirements
- Docker + Docker Compose (or Node.js 20+ for bare metal)
- PostgreSQL 16+ (included in docker compose)
- Redis 7+ (included in docker compose)
- 1 CPU / 1GB RAM minimum (enough for dev)
- 2 CPU / 4GB RAM recommended (for production with queue mode)
- Claude Code / Claude Desktop / Cursor / Cline with MCP support (user's subscription)

## Cost Model: 100% Free

**flowAIbuilder costs nothing to run for us or the user:**

| Component | Cost | Who pays |
|-----------|------|----------|
| flowAIbuilder server | Open source, MIT | User hosts (VPS ~$5-20/mo or local) |
| PostgreSQL + Redis | Open source | Included in Docker compose |
| AI for review/building | User's Claude subscription | User already pays Anthropic |
| Workflow execution | CPU on user's server | User's infrastructure |
| Enterprise features | All included, no tiers | Nobody - it's free |

**No API keys needed on flowAIbuilder side.** The MCP server is purely tools + data storage. All intelligence comes from the user's own Claude subscription. flowAIbuilder never sees, stores, or proxies Claude API calls.

**Monetization (future, optional):**
- Managed hosting (we run the VPS, user pays for infrastructure convenience)
- Premium templates / node packs
- Enterprise support contracts
- Training / consulting

But for now: 100% free, open source, no strings.

## Implementation Plan

### DAY ONE - Working core

**Block 1: Project scaffold (30 min)**
```
Monorepo: packages/server + packages/ui + packages/shared
Docker compose: postgres + redis + flowaibuilder
Basic Fastify server with health check
Drizzle schema for workflows + executions
```

**Block 2: Workflow engine (2 hours)**
```
Node executor framework:
  - BaseNode class with execute(input) -> output
  - CodeNode: runs JS/Python in VM sandbox
  - HttpRequestNode: axios wrapper with auth
  - WebhookTriggerNode: registers Fastify routes
  - IfNode: evaluates conditions
  - SetNode: transforms data
  - MergeNode: combines inputs

Execution runner:
  - Topological sort of node graph
  - Sequential execution with data passing
  - Error handling + per-node status tracking
  - Full execution log stored in DB
```

**Block 3: MCP server (1 hour)**
```
Built into Fastify server (stdio + HTTP transport)
Core tools: create/get/list workflow, add/update/remove node, execute
Claude can create and run workflows from terminal
```

**Block 4: Visual canvas (1.5 hours)**
```
React Flow canvas with custom nodes (color-coded by type)
Node config sidebar
WebSocket connection to server
Add node toolbar
Live execution status on canvas (green=success, red=error, blue=running)
```

**Block 5: Enterprise foundations - FREE (1 hour)**
```
Execution history with full traces (stored, queryable)
Audit log table (every API/MCP action logged)
Workflow versioning (version++ on every save)
Basic auth (email/password via Lucia)
Export: structured prompt + TypeScript + mermaid
```

**Block 5.5: AI Review MVP (1 hour)**
```
MCP tools: review_workflow, apply_fix, get_annotations
Review engine:
  - Serialize full workflow graph as context for Claude
  - Parse Claude's structured response into Annotation objects
  - Store annotations in DB, broadcast to canvas via WebSocket
Canvas UI:
  - Annotation cards attached to nodes (amber cards with connector lines)
  - "AI Review" toggle button with counter badge
  - "Apply fix" button on each annotation (calls Claude MCP tool)
  - Health score badge in canvas header (0-100)
Review triggers:
  - Manual: "AI Review" button click
  - Auto: on workflow save (configurable)
  - Post-execution: after failed runs
```

**Block 6: Docker + deploy (30 min)**
```
docker-compose.yml (postgres + redis + flowaibuilder)
Dockerfile for server
README with quick start
Record demo
```

### WEEK 2 - Enterprise features + AI Review v2

- SSO (SAML/LDAP via Lucia adapters)
- Git sync (push/pull workflows to Git repo)
- Environments (dev/staging/prod with promotion)
- Log streaming (webhook + S3 destinations)
- Queue mode (BullMQ workers for parallel execution)
- RBAC (admin/editor/viewer roles)
- Secrets manager (encrypted at rest)
- n8n import tool (convert n8n JSON to flowAIbuilder format)
- AI Review: continuous mode (Claude watches edits via WebSocket, updates suggestions in real-time)
- AI Review: pre-deploy check (comprehensive security + reliability scan before activating workflow)
- AI Review: execution post-mortem (after failed runs, Claude analyzes trace and pinpoints root cause)

### WEEK 3-4 - Ecosystem

- npm-based plugin system for custom nodes
- Community node registry
- Template marketplace
- API documentation (Swagger/OpenAPI)
- Webhook management UI
- Credential encryption + management
- AI Review: custom rules (user-defined review rules, e.g. "always require error handling after HTTP nodes")
- AI Review: team patterns (learn from team's workflow history, suggest consistent patterns)

### MONTH 2+ - Scale

- n8n compatibility layer (run n8n nodes natively)
- Multi-tenant hosting option
- Execution analytics dashboard
- AI Review: workflow generation from natural language ("I need a pipeline that monitors Stripe, enriches leads, and sends to Slack" -> Claude generates full workflow + auto-reviews it)
- AI Review: cross-workflow analysis ("Workflow A and Workflow B both call the same API without caching - consolidate into shared sub-workflow")
- AI Review: performance profiling (identify slow nodes, suggest parallelization, caching)
- Managed cloud offering (optional paid tier for hosting only)

## Example: Full AI+Human Workflow

```
Human in Claude Code:
> "Create a workflow that monitors a Stripe webhook for new payments,
>  enriches the customer data from our API, classifies the customer
>  segment with Claude, and sends a personalized Slack message"

Claude Code calls flowAIbuilder MCP:

1. flowaibuilder.create_workflow({ name: "Payment Notification Pipeline" })

2. flowaibuilder.add_node({
     type: "webhook",
     name: "Stripe Webhook",
     config: { path: "/stripe", method: "POST" }
   })

3. flowaibuilder.add_node({
     type: "code",
     name: "Extract Payment Data",
     config: { language: "javascript", code: `
       const event = $input.body;
       return [{
         json: {
           customer_id: event.data.object.customer,
           amount: event.data.object.amount / 100,
           currency: event.data.object.currency
         }
       }];
     `},
     connect_after: "Stripe Webhook"
   })

4. flowaibuilder.add_node({
     type: "http_request",
     name: "Enrich Customer",
     config: {
       url: "https://api.ourcompany.com/customers/{{$json.customer_id}}",
       method: "GET",
       headers: { "Authorization": "Bearer {{$secrets.API_KEY}}" }
     },
     connect_after: "Extract Payment Data"
   })

5. flowaibuilder.add_node({
     type: "code",
     name: "Classify with Claude",
     config: { language: "javascript", code: `
       const customer = $input.json;
       const resp = await $helpers.httpRequest({
         method: 'POST',
         url: 'https://api.anthropic.com/v1/messages',
         headers: {
           'x-api-key': $secrets.ANTHROPIC_KEY,
           'content-type': 'application/json',
           'anthropic-version': '2023-06-01'
         },
         body: {
           model: 'claude-sonnet-4-20250514',
           max_tokens: 100,
           messages: [{
             role: 'user',
             content: 'Classify customer: ' + JSON.stringify(customer) +
                      '. Return: {"segment": "vip"|"regular"|"new", "message": "..."}'
           }]
         }
       });
       return [{ json: JSON.parse(resp.content[0].text) }];
     `},
     connect_after: "Enrich Customer"
   })

6. flowaibuilder.add_node({
     type: "http_request",
     name: "Send Slack Message",
     config: {
       url: "https://hooks.slack.com/services/{{$secrets.SLACK_WEBHOOK}}",
       method: "POST",
       body: {
         text: "{{$json.segment}} customer paid {{$json.amount}}: {{$json.message}}"
       }
     },
     connect_after: "Classify with Claude"
   })

Human opens browser at localhost:5173:
-> Sees 6 nodes connected in a clear vertical flow
-> Clicks "Classify with Claude" node
-> Tweaks the prompt in sidebar
-> Adds an IF node after classification to handle VIP differently
-> Clicks "AI Review" button
-> Claude analyzes the full graph via MCP...
-> 3 annotations appear on canvas:
   - RED on "Enrich Customer": "Missing Authorization header - API will return 401"
   - AMBER on IF node: "False branch has no handler - cold leads silently dropped"  
   - BLUE on "Send Slack": "Message lacks lead details - add name, score, CRM link"
-> Human clicks "Apply fix" on the auth error -> Claude adds Bearer header via MCP
-> Human clicks "Explain" on the dead end warning -> Claude suggests nurture flow in chat
-> Human clicks "Apply all remaining" -> Claude fixes everything
-> Health score jumps from 45 to 92
-> Clicks "Test" -> sees green checkmarks flow through each node
-> Sees full execution log with input/output for every step
-> Clicks "Activate" -> workflow is live

All of this logged in audit trail.
All of this versioned.
All of this free.
```

## Positioning & Marketing

**For n8n users frustrated with pricing:**
"Everything n8n Enterprise gives you, flowAIbuilder gives you free. SSO, audit logs, git sync, scaling - no paywall."

**For AI-first developers:**
"The first workflow engine where Claude Code is a first-class citizen. Create, edit, review, debug, and run workflows from your terminal."

**For teams building automations:**
"AI Review catches your mistakes before production does. Missing auth headers, dead-end branches, weak notifications - Claude reviews your entire flow and fixes it with one click."

**For open-source advocates:**
"MIT licensed. Not fair-code. Not sustainable-use. Actual open source. Fork it, sell it, do whatever you want."

**Killer demo moment:**
Human builds a 5-node workflow in 2 minutes. Clicks "AI Review". Three annotations pop up on canvas with amber cards. Clicks "Apply all". Claude fixes everything via MCP in 3 seconds. Health score goes from 45 to 92. That's the moment people share on Twitter.

## Competitive Differentiation

| | n8n Community | n8n Enterprise | flowAIbuilder |
|--|--------------|----------------|-----------|
| Price | Free | $333-4000+/mo | Free |
| License | Sustainable Use | Proprietary | MIT |
| AI cost model | N/A | N/A | Zero - user's own Claude subscription |
| Agent Teams (auto-build) | No | No | Yes - visual dashboard for Claude Code Agent Teams |
| Propose-then-confirm | No | No | Yes - human approves before Claude commits |
| AI Review of workflows | No | No | Yes - Claude analyzes via MCP, zero cost |
| Workflow health score | No | No | Yes - 0-100 with breakdown |
| Post-execution AI analysis | No | No | Yes - Claude reads traces, finds root cause |
| SSO | No | Yes | Yes |
| Audit logs | No | Yes | Yes |
| Git sync | No | Yes | Yes |
| Environments | No | Yes | Yes |
| Queue scaling | No | Yes | Yes |
| Log streaming | No | Yes | Yes |
| Execution history | Limited | Full | Full |
| RBAC | Basic | Advanced | Advanced |
| MCP for AI agents | No (separate tool) | No | Built-in |
| Deploy | Local/Cloud | Cloud | Local Docker / VPS / any infra |
| n8n import | N/A | N/A | Yes |

## Success Metrics

### Day one:
- Working workflow engine that can execute 5+ node types
- Claude Code can create + execute a workflow via MCP
- Visual canvas shows workflow + execution status
- Full execution logs stored and viewable
- AI Review generates annotations on a test workflow
- "Apply fix" button works (Claude fixes via MCP)

### Week one:
- GitHub repo published
- Docker one-command deploy works
- 5-node workflow created by Claude, edited by human, executed successfully
- AI Review catches at least 3 real issues on a demo workflow
- Health score displayed and changes after fixes applied
- 100+ GitHub stars

### Month one:
- All enterprise features implemented and free
- n8n import tool working
- AI Review: continuous mode + post-execution analysis working
- Average review finds 2-4 actionable issues per workflow
- 10+ community members contributing
- 500+ GitHub stars
- First production deployment by external user

### Month three:
- Plugin ecosystem with 20+ community nodes
- AI Review: custom rules + cross-workflow analysis
- 2000+ GitHub stars
- Featured on Hacker News / Product Hunt
- Companies migrating from n8n Enterprise

## Risks

| Risk | Probability | Mitigation |
|------|------------|------------|
| n8n license prevents importing their nodes | Medium | Build own nodes, not copy n8n code |
| Scope too big for day one | High | MVP = engine + 6 nodes + MCP + canvas. Enterprise features week 2 |
| Node execution security (sandboxing) | Medium | VM2/isolated-vm for Code nodes |
| Single maintainer burnout | Medium | MIT license attracts contributors early |
| n8n community defensive reaction | Low | Position as complement, offer import tool |

## Name Alternatives

- flowAIbuilder (current - strong, may conflict with existing "flowAIbuilder" Node-RED company)
- OpenFlow
- RunGraph
- PipeForge
- FlowPilot
- AgenFlow (AI agent + flow)
- NodeForge
- WorkflowKit

Need to check trademark availability before launch.

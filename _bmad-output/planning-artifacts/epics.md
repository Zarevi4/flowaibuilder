---
stepsCompleted: ["step-01-validate-prerequisites", "step-02-design-epics", "step-03-create-stories"]
inputDocuments:
  - "_bmad-output/planning-artifacts/prd.md"
  - "_bmad-output/planning-artifacts/architecture.md"
alreadyImplemented:
  - "DB Schema (Drizzle tables: workflows, executions, audit_log, workflow_versions, users, credentials, annotations, workflow_reviews, protected_zones)"
  - "Workflow Engine (executor.ts, node-runner.ts, context.ts, sandbox.ts, retry.ts)"
  - "6 Node Handlers (webhook, schedule, manual, code-js, if, http-request)"
  - "Shared TypeScript types (packages/shared/src/)"
notYetImplemented:
  - "REST API routes (packages/server/src/api/routes/ is empty)"
  - "WebSocket broadcaster (packages/server/src/api/ws/ is empty)"
  - "Server wiring (index.ts is placeholder — no DB connection, no routes, no WebSocket)"
  - "MCP tools (packages/server/src/mcp/tools/ not wired)"
---

# flowAIbuilder - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for flowAIbuilder, decomposing the requirements from the PRD and Architecture into implementable stories.

**Note:** Stories 2-4 from the original PRD implementation plan (DB Schema, Workflow Engine, Node Implementations) plus the MCP server base, REST API base, and WebSocket broadcaster are already implemented in `packages/server/src/`. Epics account for this existing work.

## Requirements Inventory

### Functional Requirements

FR1: Workflow CRUD operations — create, get, list, delete, duplicate workflows via MCP and REST API
FR2: Node operations — add, update, remove, connect, disconnect nodes within workflows via MCP and REST
FR3: Workflow execution — execute workflows, get/list executions, stop, retry executions
FR4: Export/Import — export workflows as prompt/typescript/python/mermaid/json; import n8n workflows; validate workflows
FR5: Webhook trigger node — HTTP endpoint that starts workflow execution on incoming requests
FR6: Schedule trigger node — cron-based trigger for scheduled workflow execution
FR7: Manual trigger node — button-click trigger for testing/manual execution
FR8: Code JS node — JavaScript execution in isolated VM sandbox with $input/$json/$helpers/$secrets context
FR9: Code Python node — Python execution via child process
FR10: IF node — boolean condition evaluation with true/false branch routing
FR11: Switch node — multi-branch routing based on conditions
FR12: Merge node — combine multiple data streams
FR13: Loop node — iterate over items in a collection
FR14: Set node — set/modify/transform data fields
FR15: HTTP Request node — generic HTTP client with auth, retry, timeout support
FR16: AI Agent node — LLM integration with tool calling capability
FR17: Respond to Webhook node — return HTTP response to webhook caller
FR18: MCP server built into Fastify server with stdio + HTTP/SSE transport
FR19: AI Review — get_review_context MCP tool returns full workflow graph, data flow, execution history, existing annotations
FR20: AI Review — save_annotations MCP tool accepts structured annotations from Claude with health score
FR21: AI Review — apply_fix MCP tool executes the fix defined in an annotation
FR22: AI Review — dismiss_annotation MCP tool with optional reason
FR23: AI Review — get_annotations MCP tool with optional severity filter
FR24: AI Review — Three annotation severity levels: error (red), warning (amber), suggestion (blue)
FR25: AI Review — Health score 0-100 with breakdown: security (25), reliability (25), data_integrity (25), best_practices (25)
FR26: AI Review — On-demand review mode (human clicks "AI Review" button)
FR27: AI Review — Auto-review on save (configurable toggle)
FR28: AI Review — Continuous review mode (watch edits via WebSocket, debounced re-review)
FR29: AI Review — Execution review (post-failure analysis of execution traces)
FR30: AI Review — Pre-deploy review (comprehensive check before workflow activation)
FR31: Protected Zones — create_zone MCP tool (name, node_ids, color)
FR32: Protected Zones — delete_zone, add_to_zone, remove_from_zone, get_zones MCP tools
FR33: Protected Zones — Server-side ZoneEnforcer middleware blocks writes to pinned nodes with descriptive error messages
FR34: Protected Zones — Read access remains unrestricted for pinned nodes
FR35: Protected Zones — Canvas UI: blue dashed boundary, lock icon on pinned nodes, zone label (name + who + when)
FR36: Protected Zones — Node positions locked within zones, cannot be dragged out
FR37: Protected Zones — Context menu: create/expand/shrink/unpin zone
FR38: Agent Teams — watch_team MCP tool (fs.watch on ~/.claude/teams/ inboxes + tasks.json)
FR39: Agent Teams — get_team_state MCP tool (snapshot: agents, tasks, messages, progress)
FR40: Agent Teams — get_agent_messages MCP tool with limit
FR41: Agent Teams — send_team_message MCP tool (human writes to agent inbox file)
FR42: Agent Teams — update_task, add_task, set_task_assignment MCP tools
FR43: Agent Teams — link_task_to_node MCP tool (bridge agent task to workflow canvas node)
FR44: Agent Teams — Team Dashboard view: agent cards (name, role, status, current task), task board, message feed, progress bar
FR45: Agent Teams — Workflow Canvas integration: agent name badge on nodes, color-coded by agent, proposed (dashed) vs confirmed (solid), live status transitions
FR46: Agent Teams — Three operation modes: observe, design+launch, hybrid
FR47: Agent Teams — Pre-built team templates (Webhook Pipeline, AI Workflow, Full-Stack Automation)
FR48: Enterprise — Audit log: every API/MCP action logged with actor, action, resource, changes, metadata
FR49: Enterprise — SSO authentication (SAML/LDAP via Lucia adapters)
FR50: Enterprise — RBAC (admin/editor/viewer roles with permission checks)
FR51: Enterprise — Git sync: push/pull workflows to git repo, visual diff between versions
FR52: Enterprise — Environments: dev/staging/prod with promotion workflow
FR53: Enterprise — Log streaming: stdout/webhook/S3 destinations
FR54: Enterprise — Queue mode: BullMQ workers for parallel execution
FR55: Enterprise — Secrets manager: encrypted at rest (AES-256-GCM), CRUD via MCP
FR56: Enterprise — Execution history with full per-node traces (input/output data)
FR57: Enterprise — Workflow versioning: version++ on save, snapshot storage, git SHA tracking
FR58: Visual Canvas — React Flow canvas with custom color-coded nodes (Trigger=purple, Code=teal, HTTP=coral, Logic=amber, AI=pink, Output=gray)
FR59: Visual Canvas — Node config sidebar with dynamic form for selected node
FR60: Visual Canvas — Code editor (Monaco-lite) for Code nodes
FR61: Visual Canvas — WebSocket real-time sync (server pushes all changes to canvas)
FR62: Visual Canvas — Add node toolbar with node categories dropdown
FR63: Visual Canvas — Execution overlay: green/red/blue status on nodes during execution
FR64: Visual Canvas — Export dialog with format selection and preview
FR65: Visual Canvas — Dashboard page: workflow list with stats
FR66: Visual Canvas — Execution history page and execution detail/trace view
FR67: Visual Canvas — Audit log viewer page
FR68: Visual Canvas — Settings page
FR69: Docker one-command deploy via docker-compose (postgres + redis + flowaibuilder + UI)
FR70: Visual Canvas — Auto-layout algorithm for node positioning
FR71: Visual Canvas — Breadcrumb with workflow name + environment badge + health score

### NonFunctional Requirements

NFR1: Zero-cost AI model — flowAIbuilder NEVER calls Claude API; no @anthropic-ai/sdk dependency on server
NFR2: Code node sandboxing via isolated-vm with 128MB memory limit and 30s execution timeout
NFR3: Secrets encrypted with AES-256-GCM at rest
NFR4: MIT license — true open source, no restrictions
NFR5: Database portability — SQLite for development, PostgreSQL for production via Drizzle ORM
NFR6: Minimum hardware: 1 CPU / 1GB RAM; recommended: 2 CPU / 4GB RAM
NFR7: MCP-first design principle — every feature is MCP tool first, REST API second, UI button third
NFR8: TypeScript throughout entire codebase
NFR9: n8n-compatible variable naming ($input, $json, $helpers, $secrets, $env) for developer familiarity
NFR10: Workflow JSON designed to be LLM-readable (clear field names, descriptions)
NFR11: WebSocket real-time updates — canvas reflects changes within seconds
NFR12: Docker-based deployment with one-command startup

### Additional Requirements

- Monorepo structure: packages/server + packages/ui + packages/shared
- Fastify server framework with TypeBox schema validation
- Drizzle ORM with migration support
- BullMQ + Redis for job queue
- Zustand for UI state management
- @xyflow/react for canvas
- Tailwind CSS for UI styling
- Topological sort algorithm for node execution ordering
- WebSocket protocol with defined message types for all server->UI and UI->server events
- ZoneEnforcer middleware wraps node operations (update, remove, disconnect)
- Review context builder: server-side rule-based pattern detection (no AI)
- Data flow tracing: server computes incoming/outgoing fields per node (graph traversal, no AI)
- Agent Teams file watcher: fs.watch() on ~/.claude/teams/ directory
- Lucia Auth framework for local + SSO authentication
- isomorphic-git for pure JS git operations
- tsup for server build, Vite for UI build

### UX Design Requirements

No UX Design document was provided. UX requirements are derived from the PRD canvas descriptions and architecture component structure.

### FR Coverage Map

**Already Implemented (engine layer only — no REST/WS/MCP wiring yet):**
FR1: Workflow CRUD — engine logic exists, REST routes and MCP tools NOT wired (wired in Story 1.0)
FR2: Node operations — engine logic exists, REST routes and MCP tools NOT wired (wired in Story 1.0)
FR3: Workflow execution — engine logic exists, REST routes and MCP tools NOT wired (wired in Story 1.0)
FR5-FR17: 6 node handlers implemented (webhook, schedule, manual, code-js, if, http-request); remaining node types need handlers
FR18: MCP server base — SDK installed, tools NOT wired (wired in Story 1.0)

**Epic 1 — Visual Workflow Canvas:**
FR58: React Flow canvas with custom color-coded nodes
FR59: Node config sidebar with dynamic form
FR60: Code editor (Monaco-lite) for Code nodes
FR61: WebSocket real-time sync
FR62: Add node toolbar with categories dropdown
FR63: Execution overlay (green/red/blue status)
FR64: Export dialog with format selection and preview
FR65: Dashboard page — workflow list with stats
FR66: Execution history page and execution detail/trace view
FR67: Audit log viewer page
FR68: Settings page
FR70: Auto-layout algorithm for node positioning
FR71: Breadcrumb with workflow name + environment badge + health score

**Epic 2 — AI Review System:**
FR19: get_review_context MCP tool
FR20: save_annotations MCP tool
FR21: apply_fix MCP tool
FR22: dismiss_annotation MCP tool
FR23: get_annotations MCP tool
FR24: Three annotation severity levels (error/warning/suggestion)
FR25: Health score 0-100 with breakdown
FR26: On-demand review mode
FR27: Auto-review on save
FR28: Continuous review mode
FR29: Execution review (post-failure)
FR30: Pre-deploy review

**Epic 3 — Protected Zones:**
FR31: create_zone MCP tool
FR32: delete_zone, add_to_zone, remove_from_zone, get_zones MCP tools
FR33: Server-side ZoneEnforcer middleware
FR34: Read access unrestricted for pinned nodes
FR35: Canvas UI (boundary, lock icon, zone label)
FR36: Node positions locked within zones
FR37: Context menu (create/expand/shrink/unpin)

**Epic 4 — Export, Import & Deploy:**
FR4: Export (prompt/typescript/python/mermaid/json), import n8n, validate
FR69: Docker one-command deploy

**Epic 5 — Enterprise Features:**
FR48: Audit log
FR49: SSO (SAML/LDAP)
FR50: RBAC (admin/editor/viewer)
FR51: Git sync with visual diff
FR52: Environments (dev/staging/prod)
FR53: Log streaming (stdout/webhook/S3)
FR54: Queue mode (BullMQ workers)
FR55: Secrets manager (AES-256-GCM)
FR56: Execution history with full traces
FR57: Workflow versioning

**Epic 6 — Agent Teams Dashboard:**
FR38: watch_team MCP tool
FR39: get_team_state MCP tool
FR40: get_agent_messages MCP tool
FR41: send_team_message MCP tool
FR42: update_task, add_task, set_task_assignment MCP tools
FR43: link_task_to_node MCP tool
FR44: Team Dashboard view (agent cards, task board, message feed)
FR45: Workflow Canvas integration (agent badges, live status)
FR46: Three operation modes (observe, design+launch, hybrid)
FR47: Pre-built team templates

## Epic List

### Epic 1: Visual Workflow Canvas
Users can visually create, edit, and monitor workflow execution on an interactive React Flow canvas — custom color-coded nodes, config sidebar, code editor, real-time WebSocket sync, execution overlays, dashboard, and execution history viewer.
**FRs covered:** FR58, FR59, FR60, FR61, FR62, FR63, FR64, FR65, FR66, FR67, FR68, FR70, FR71

### Epic 2: AI Review System
Users can have Claude analyze their workflows via MCP and see actionable annotations (errors, warnings, suggestions) directly on the canvas with one-click fixes, a 0-100 health score, and multiple review modes (on-demand, auto-on-save, continuous, post-execution, pre-deploy).
**FRs covered:** FR19, FR20, FR21, FR22, FR23, FR24, FR25, FR26, FR27, FR28, FR29, FR30

### Epic 3: Protected Zones
Users can pin working workflow sections with visual boundaries so AI and other users cannot modify them — server-side enforcement via ZoneEnforcer, canvas UI with lock icons, and context menu for zone management.
**FRs covered:** FR31, FR32, FR33, FR34, FR35, FR36, FR37

### Epic 4: Export, Import & Deploy
Users can export workflows in 5 formats (prompt, TypeScript, Python, Mermaid, JSON), import existing n8n workflows, validate correctness, and deploy the full stack with a single Docker command.
**FRs covered:** FR4, FR69

### Epic 5: Enterprise Features (All Free)
Users get SSO/LDAP login, role-based access control, git-synced workflow versioning with visual diffs, environment promotion (dev/staging/prod), encrypted secrets, BullMQ queue scaling, log streaming, and full execution traces — all free, no paywall.
**FRs covered:** FR48, FR49, FR50, FR51, FR52, FR53, FR54, FR55, FR56, FR57

### Epic 6: Agent Teams Dashboard
Users can visualize and control Claude Code Agent Teams from the canvas — agent status cards, task boards, message feeds, agent badges on workflow nodes, three operation modes (observe, design+launch, hybrid), and pre-built team templates.
**FRs covered:** FR38, FR39, FR40, FR41, FR42, FR43, FR44, FR45, FR46, FR47

---

## Epic 1: Visual Workflow Canvas

Users can visually create, edit, and monitor workflow execution on an interactive React Flow canvas.

### Story 1.0: Wire Server Foundation

As a developer (human or AI agent),
I want the Fastify server fully wired with DB connection, REST API routes, WebSocket broadcaster, and MCP tool registration,
So that the UI and Claude Code have working endpoints to interact with.

**Acceptance Criteria:**

**Given** the server starts via `npm run dev:server`
**When** it initializes
**Then** it connects to the database (SQLite in dev), registers all Fastify route plugins, starts the WebSocket server, and registers MCP tools on stdio + HTTP/SSE transport
**And** a health check at `GET /api/health` returns 200

**Given** the workflow engine and node handlers already exist
**When** REST routes for `/api/workflows` are registered
**Then** CRUD operations (create, get, list, delete, duplicate) work via HTTP
**And** `POST /api/workflows/:id/execute` triggers the engine and returns execution results

**Given** the WebSocket server is running
**When** a client connects to the WS endpoint
**Then** the client receives a connection acknowledgment
**And** all server-side mutations (node add/update/remove, execution status) broadcast to connected clients

**Given** the MCP server is registered
**When** Claude Code connects via stdio or HTTP/SSE
**Then** core MCP tools are available: create_workflow, get_workflow, list_workflows, delete_workflow, add_node, update_node, remove_node, connect_nodes, disconnect_nodes, execute_workflow, get_execution, list_executions

### Story 1.1: UI Scaffold & React Flow Canvas with Custom Nodes

As a workflow user,
I want to see my workflow rendered as an interactive node graph in the browser,
So that I can visually understand the structure and flow of my automation.

**Acceptance Criteria:**

**Given** the packages/ui project is set up with Vite, React, Tailwind, Zustand, and @xyflow/react
**When** I navigate to `/editor/:workflowId`
**Then** the workflow is fetched from the server REST API and rendered on a React Flow canvas

**Given** a workflow with nodes of different types
**When** the canvas renders
**Then** each node type displays with its correct color and visual treatment (Trigger=purple, Code=teal, HTTP=coral, Logic=amber, AI=pink, Output=gray)
**And** nodes show their name, type icon, and a brief config preview (URL for HTTP, code snippet for Code, etc.)

**Given** the canvas is loaded
**When** I pan, zoom, select, or drag nodes
**Then** standard React Flow interactions work correctly
**And** node position changes are persisted to the server

### Story 1.2: WebSocket Integration & Real-Time Sync

As a workflow user,
I want changes made by AI agents (via MCP) to appear on my canvas in real-time,
So that I can see workflows being built and modified without refreshing.

**Acceptance Criteria:**

**Given** the canvas is open for a workflow
**When** a node is added, updated, or removed via MCP or REST API
**Then** the change appears on the canvas within 1 second via WebSocket push

**Given** the WebSocket connection drops
**When** it reconnects
**Then** a full_sync message restores the canvas to the current server state

**Given** multiple server events fire in rapid succession
**When** the UI receives them
**Then** all events are applied in order without visual glitching

### Story 1.3: Node Config Sidebar & Code Editor

As a workflow user,
I want to click a node and edit its configuration in a sidebar panel,
So that I can configure node behavior without leaving the canvas.

**Acceptance Criteria:**

**Given** I click on a node on the canvas
**When** the sidebar opens
**Then** it displays a dynamic form with fields appropriate for that node type (e.g., URL/method/headers for HTTP Request, condition for IF, cron expression for Schedule)

**Given** I select a Code (JS or Python) node
**When** the sidebar opens
**Then** it includes a Monaco-based code editor with syntax highlighting and the code field pre-populated

**Given** I edit a field in the sidebar and it loses focus or I press save
**When** the change is submitted
**Then** the node config is updated on the server via API
**And** the canvas node preview updates to reflect the change

### Story 1.4: Canvas Toolbar & Node Management

As a workflow user,
I want a toolbar to add new nodes and trigger common actions,
So that I can build workflows visually without using the CLI.

**Acceptance Criteria:**

**Given** the canvas editor is open
**When** I click the "Add Node" button in the toolbar
**Then** a dropdown appears with node categories (Triggers, Logic, Integration, Output) and node types within each

**Given** I select a node type from the dropdown
**When** the node is created
**Then** it appears on the canvas at a sensible default position using the auto-layout algorithm
**And** the new node is persisted to the server

**Given** I select a node and press Delete or use the context menu
**When** the node is removed
**Then** it disappears from the canvas, its connections are cleaned up, and the deletion is persisted

**Given** I drag from one node's output handle to another node's input handle
**When** I release
**Then** a connection (edge) is created between them and persisted to the server

### Story 1.5: Workflow Execution & Status Overlay

As a workflow user,
I want to execute my workflow from the canvas and see live status on each node,
So that I can test workflows and identify failures visually.

**Acceptance Criteria:**

**Given** I click the "Run" button in the toolbar
**When** the workflow begins executing
**Then** each node displays a status overlay: blue (running), green (success), red (error) as execution progresses via WebSocket updates

**Given** a node execution completes with an error
**When** I click on the failed (red) node
**Then** the sidebar shows the error message, stack trace, and the node's input data

**Given** execution completes
**When** all nodes have finished
**Then** the toolbar shows execution status (success/error) and duration

### Story 1.6: Dashboard & Workflow Management

As a workflow user,
I want a dashboard showing all my workflows with key stats,
So that I can manage and navigate between workflows.

**Acceptance Criteria:**

**Given** I navigate to the root URL `/`
**When** the dashboard loads
**Then** I see a list/grid of all workflows with name, status (active/inactive), last modified date, and last execution status

**Given** I click "New Workflow" on the dashboard
**When** the workflow is created
**Then** I am redirected to the canvas editor for the new workflow

**Given** I click delete on a workflow card
**When** I confirm the deletion
**Then** the workflow is removed from the server and disappears from the dashboard

### Story 1.7: Execution History & Trace Viewer

As a workflow user,
I want to view past executions and inspect per-node traces,
So that I can debug issues and understand workflow behavior over time.

**Acceptance Criteria:**

**Given** I navigate to the executions page for a workflow
**When** the page loads
**Then** I see a list of past executions with status, trigger mode, duration, and timestamp

**Given** I click on an execution in the list
**When** the execution detail page loads
**Then** I see the workflow graph with each node annotated with its execution status (success/error/skipped)
**And** I can click any node to see its input data, output data, and duration

**Given** an execution had a node error
**When** I view the execution detail
**Then** the error node is highlighted in red and shows the error message and stack trace

### Story 1.8: Breadcrumb, Export Dialog & Utility Pages

As a workflow user,
I want a breadcrumb showing my current context, an export dialog shell, and utility pages for audit logs and settings,
So that I have complete navigation and access to all platform features.

**Acceptance Criteria:**

**Given** I am in the canvas editor
**When** I look at the top bar
**Then** I see a breadcrumb showing the workflow name, environment badge (dev/staging/prod), and health score pill (0-100, color-coded)

**Given** I click "Export" in the toolbar
**When** the export dialog opens
**Then** I see format options (prompt, TypeScript, Python, Mermaid, JSON) and a preview area
**And** a "Copy to Clipboard" button copies the raw workflow JSON (actual format compilers are implemented in Epic 4)

**Given** I navigate to `/audit-log`
**When** the page loads
**Then** I see a filterable list of audit entries with timestamp, actor, action, and resource

**Given** I navigate to `/settings`
**When** the page loads
**Then** I can configure instance settings (timezone, auto-review toggle, error workflow)

---

## Epic 2: AI Review System

Users can have Claude analyze their workflows via MCP and see actionable annotations directly on the canvas with one-click fixes and a health score.

### Story 2.1: Review Context Builder & Core MCP Tools

As a Claude Code user,
I want MCP tools that serialize my workflow into a structured context and let me save analysis results back,
So that I can review workflows and provide actionable annotations.

**Acceptance Criteria:**

**Given** a workflow exists with nodes, connections, and execution history
**When** Claude calls `flowaibuilder.get_review_context({ workflow_id })`
**Then** the tool returns: full node graph (id, type, name, config), connections, per-node incoming/outgoing data fields (computed via graph traversal), detected pattern (rule-based), credentials used, recent executions (last 5), and existing annotations

**Given** Claude has analyzed a workflow
**When** Claude calls `flowaibuilder.save_annotations({ workflow_id, annotations, health_score })`
**Then** each annotation is stored in the DB with id, node_id, severity, title, description, and optional fix
**And** a `review_completed` event is broadcast via WebSocket to the canvas

**Given** annotations exist for a workflow
**When** Claude calls `flowaibuilder.get_annotations({ workflow_id, severity? })`
**Then** all matching annotations are returned, filterable by severity

**Given** an annotation exists
**When** Claude calls `flowaibuilder.dismiss_annotation({ workflow_id, annotation_id, reason? })`
**Then** the annotation status is set to "dismissed" with the optional reason
**And** an `annotation_dismissed` event is broadcast via WebSocket

### Story 2.2: Annotation Fix Engine & Health Score

As a workflow user,
I want one-click fixes that Claude defined in annotations and a health score for my workflow,
So that I can resolve issues instantly and understand overall workflow quality.

**Acceptance Criteria:**

**Given** an annotation has a `fix` field with `{ tool, params, description }`
**When** the user or Claude calls `flowaibuilder.apply_fix({ workflow_id, annotation_id })`
**Then** the fix's MCP tool is executed with the specified params
**And** the annotation status is set to "applied"
**And** an `annotation_applied` event is broadcast via WebSocket

**Given** Claude saves annotations with a health_score
**When** the score is saved
**Then** the workflow's review.health_score is updated in the DB
**And** the score is broken down into 4 categories: security (0-25), reliability (0-25), data_integrity (0-25), best_practices (0-25)

**Given** a workflow_review record is created
**When** stored
**Then** it captures review_type, health_score, scores breakdown, summary, annotation_count, and timestamp

### Story 2.3: Canvas Annotation UI & On-Demand Review

As a workflow user,
I want to see AI review annotations on the canvas and trigger reviews with a button,
So that I can visually identify issues and get Claude's analysis on demand.

**Acceptance Criteria:**

**Given** annotations exist for the current workflow
**When** the canvas loads or a `review_completed` WebSocket event arrives
**Then** annotation cards appear attached to their respective nodes via connector lines
**And** cards are color-coded: red (error), amber (warning), blue (suggestion)

**Given** I click on an annotation card
**When** it expands
**Then** I see the full description, related nodes, and (if available) an "Apply Fix" button with the fix description

**Given** I click "Apply Fix" on an annotation
**When** the fix is applied
**Then** the annotation card transitions to "applied" state (muted/strikethrough) and the node updates

**Given** I click "Dismiss" on an annotation
**When** I optionally provide a reason
**Then** the annotation disappears from the canvas

**Given** the canvas header area
**When** annotations exist
**Then** I see a health score badge (0-100, color-coded: green 90+, amber 70-89, orange 50-69, red <50) and an annotation counter

**Given** I click the "AI Review" button in the toolbar
**When** the review is triggered
**Then** a `get_review_context` call is prepared for Claude (the UI signals review intent; Claude performs the actual analysis on the user's subscription)

### Story 2.4: Advanced Review Modes

As a workflow user,
I want automatic and context-triggered reviews,
So that my workflow quality is continuously monitored without manual intervention.

**Acceptance Criteria:**

**Given** auto-review is enabled in workflow settings
**When** the workflow is saved (by human or via MCP)
**Then** a review is automatically triggered (review context is refreshed and made available for Claude)

**Given** continuous review mode is enabled
**When** I edit nodes on the canvas
**Then** changes are debounced (2-second delay after last edit) and a review context refresh is triggered

**Given** a workflow execution fails
**When** the execution completes with error status
**Then** an execution review context is generated that includes the full execution trace, node errors, and bottleneck analysis
**And** the review context is flagged as "post-execution" type

**Given** a user clicks "Activate" to set a workflow to production
**When** the pre-deploy review is triggered
**Then** a comprehensive review context is generated including security checks (exposed secrets, missing auth), reliability checks (error handling, dead ends), and data integrity checks
**And** if the health score is below 50, the user is warned before activation proceeds

---

## Epic 3: Protected Zones

Users can pin working workflow sections so AI and other users cannot modify them.

### Story 3.1: Zone CRUD & Server-Side Enforcement

As a workflow user,
I want to create protected zones around groups of nodes with server-side enforcement,
So that AI agents and other users cannot accidentally break working sections.

**Acceptance Criteria:**

**Given** a workflow with nodes
**When** Claude or the user calls `flowaibuilder.create_zone({ workflow_id, name, node_ids, color? })`
**Then** a protected zone is created in the DB with the specified nodes, pinned_by, pinned_at, and default color (#378ADD)
**And** a `zone_created` event is broadcast via WebSocket

**Given** a protected zone exists
**When** Claude calls `flowaibuilder.update_node({ workflow_id, node_id, changes })` on a pinned node
**Then** the ZoneEnforcer middleware blocks the operation with a descriptive error: "PROTECTED ZONE: Cannot update node X — it belongs to zone Y. You CAN: read config, trace data flow, connect new nodes to outputs. You CANNOT: modify, remove, or disconnect."

**Given** a protected zone exists
**When** Claude calls `flowaibuilder.remove_node()` or `flowaibuilder.disconnect_nodes()` targeting a pinned node
**Then** the operation is blocked with the same descriptive zone error

**Given** a protected zone exists
**When** any tool calls `get_workflow`, `get_review_context`, or reads node configs
**Then** read access is unrestricted — pinned node data is returned normally

**Given** a protected zone exists
**When** `flowaibuilder.delete_zone({ workflow_id, zone_id })` is called
**Then** the zone is removed, nodes are unpinned, and a `zone_deleted` event is broadcast

**Given** a protected zone exists
**When** `flowaibuilder.add_to_zone({ workflow_id, zone_id, node_ids })` or `remove_from_zone` is called
**Then** the zone's node_ids are updated accordingly

**Given** `flowaibuilder.get_zones({ workflow_id })` is called
**When** zones exist
**Then** all zones are returned with name, node_ids, color, pinned_by, pinned_at, and reason

### Story 3.2: Zone Canvas UI & Interactions

As a workflow user,
I want to see protected zones visually on the canvas and manage them via context menu,
So that I can clearly identify what's pinned and control zone boundaries.

**Acceptance Criteria:**

**Given** a workflow has protected zones
**When** the canvas renders
**Then** each zone displays as a blue dashed boundary rectangle around its member nodes
**And** a zone label shows the zone name, who pinned it, and when

**Given** a node is inside a protected zone
**When** the canvas renders
**Then** the node displays a lock icon overlay
**And** the node appears slightly dimmed compared to editable nodes

**Given** I select nodes on the canvas and right-click
**When** the context menu appears
**Then** I see "Create Protected Zone" option that prompts for a zone name

**Given** I right-click on a zone boundary
**When** the context menu appears
**Then** I see options: "Unpin Zone" (removes zone), "Rename Zone"

**Given** I try to drag a node that is inside a protected zone
**When** I attempt the drag
**Then** the node does not move (position is locked within the zone)

---

## Epic 4: Export, Import & Deploy

Users can export workflows, import from n8n, and deploy the full stack with Docker.

### Story 4.1: Workflow Export Compilers

As a workflow user,
I want to export my workflow in multiple formats,
So that I can use workflows as documentation, share them as code, or visualize them as diagrams.

**Acceptance Criteria:**

**Given** a workflow exists
**When** I call `flowaibuilder.export({ workflow_id, format: "prompt" })`
**Then** the workflow is exported as a structured natural language prompt describing each node, its config, connections, and data flow

**Given** a workflow exists
**When** I call `flowaibuilder.export({ workflow_id, format: "typescript" })`
**Then** the workflow is exported as executable TypeScript code using the flowAIbuilder SDK

**Given** a workflow exists
**When** I call `flowaibuilder.export({ workflow_id, format: "python" })`
**Then** the workflow is exported as executable Python code

**Given** a workflow exists
**When** I call `flowaibuilder.export({ workflow_id, format: "mermaid" })`
**Then** the workflow is exported as a Mermaid diagram definition showing nodes and connections

**Given** a workflow exists
**When** I call `flowaibuilder.export({ workflow_id, format: "json" })`
**Then** the raw workflow JSON is returned

**Given** the export dialog UI shell exists from Story 1.8
**When** the compilers are available
**Then** the export dialog preview area renders the compiled output for the selected format
**And** "Copy to Clipboard" and "Download" buttons work with the compiled content

### Story 4.2: n8n Import & Workflow Validation

As an n8n user migrating to flowAIbuilder,
I want to import my existing n8n workflow JSON,
So that I can migrate without rebuilding workflows from scratch.

**Acceptance Criteria:**

**Given** a valid n8n workflow JSON export
**When** I call `flowaibuilder.import_n8n({ n8n_workflow_json })`
**Then** the n8n nodes are mapped to flowAIbuilder equivalents (webhook, code, http-request, if, switch, merge, set)
**And** connections are translated to flowAIbuilder connection format
**And** a new workflow is created with the imported structure

**Given** the n8n workflow uses node types that flowAIbuilder doesn't support
**When** import runs
**Then** unsupported nodes are converted to placeholder Code nodes with a comment explaining the original node type and config
**And** a warning is included in the import result listing unsupported nodes

**Given** a workflow (imported or not)
**When** I call `flowaibuilder.validate({ workflow_id })`
**Then** the validator checks: orphan nodes (not connected), circular dependencies, missing required config fields, expression syntax errors, dead-end branches
**And** returns a list of validation issues with severity and affected node IDs

### Story 4.3: Docker One-Command Deploy

As an operator,
I want to deploy flowAIbuilder with a single docker compose command,
So that I can run the full stack (server, UI, PostgreSQL, Redis) without manual setup.

**Acceptance Criteria:**

**Given** the repository is cloned
**When** I run `docker compose up -d`
**Then** four containers start: postgres (16-alpine), redis (7-alpine), flowaibuilder-server, flowaibuilder-ui

**Given** the containers are running
**When** I open `http://localhost:5173`
**Then** the flowAIbuilder UI loads and can communicate with the API at `http://localhost:3000`

**Given** the containers are running
**When** I configure Claude Code with MCP pointing to `http://localhost:3000`
**Then** Claude can call flowAIbuilder MCP tools via HTTP/SSE transport

**Given** the postgres container starts fresh
**When** the server container starts
**Then** database migrations run automatically and the schema is ready

**Given** environment variables are set in docker-compose.yml
**When** the server reads them
**Then** DATABASE_URL, REDIS_URL, JWT_SECRET, and ENCRYPTION_KEY are configurable
**And** default values work for local development

---

## Epic 5: Enterprise Features (All Free)

Users get enterprise-grade capabilities at no cost.

### Story 5.1: Audit Logging & Execution Traces

As an operator,
I want every API and MCP action logged with full context,
So that I have a complete audit trail for compliance and debugging.

**Acceptance Criteria:**

**Given** any REST API or MCP tool call is made
**When** the request is processed
**Then** an audit entry is written to the audit_log table with: timestamp, actor (user email or "mcp:claude-code"), action (e.g., "workflow.created", "node.updated"), resource_type, resource_id, changes (before/after), and metadata (IP, user_agent, mcp_tool)

**Given** the audit log has entries
**When** I call `flowaibuilder.get_audit_log({ workflow_id?, user?, since?, limit? })`
**Then** matching entries are returned, filtered by the provided parameters

**Given** an execution has completed
**When** I call `flowaibuilder.get_execution_log({ execution_id, detail_level })`
**Then** "summary" returns status, duration, and node count; "full" includes per-node input/output; "debug" includes internal engine state

### Story 5.2: Authentication & RBAC

As an admin,
I want user authentication with SSO support and role-based access control,
So that I can manage who can access and modify workflows.

**Acceptance Criteria:**

**Given** the auth system is configured
**When** a user registers with email and password
**Then** the account is created via Lucia Auth with password hashed
**And** a session token is returned

**Given** SSO is configured (SAML or LDAP)
**When** a user authenticates via SSO
**Then** the user is created or matched in the users table with sso_provider and sso_id
**And** a session token is returned

**Given** a user has a role (admin, editor, viewer)
**When** they attempt an action
**Then** the RBAC middleware checks permissions: viewers can only read; editors can read and modify workflows; admins can manage users, settings, and all resources

**Given** an unauthenticated request
**When** it hits a protected endpoint
**Then** it receives a 401 response

### Story 5.3: Workflow Versioning & Git Sync

As a workflow developer,
I want workflow versions saved automatically and synced to a git repository,
So that I can track changes over time and use git-based deployment workflows.

**Acceptance Criteria:**

**Given** a workflow is saved (via UI or MCP)
**When** the save completes
**Then** the workflow's version number is incremented
**And** a snapshot of the full workflow state is stored in the workflow_versions table

**Given** git sync is configured with a repository
**When** I call `flowaibuilder.git_push({ workflow_id, message })`
**Then** the workflow is serialized to a JSON file in the repo, committed with the message, and pushed
**And** the git_sha is stored on the workflow_versions record

**Given** workflow versions exist
**When** I call `flowaibuilder.git_history({ workflow_id })`
**Then** a list of versions is returned with version number, git_sha, message, created_by, and timestamp

**Given** two workflow versions
**When** I view them in the UI
**Then** a visual diff shows added/removed/changed nodes and config differences

### Story 5.4: Environments & Secrets Management

As a workflow developer,
I want to promote workflows through dev/staging/prod environments and manage encrypted secrets,
So that I can safely develop and deploy workflows with sensitive credentials.

**Acceptance Criteria:**

**Given** a workflow exists
**When** I call `flowaibuilder.set_environment({ workflow_id, env: "staging" })`
**Then** the workflow's environment field is updated
**And** environment-specific settings are applied

**Given** environments are configured
**When** a workflow is promoted from dev to staging to prod
**Then** the version at promotion time is recorded and the workflow is marked with the new environment

**Given** the secrets manager
**When** I call `flowaibuilder.manage_secrets({ action: "set", key: "API_KEY", value: "sk-..." })`
**Then** the value is encrypted with AES-256-GCM and stored in the credentials table

**Given** secrets exist
**When** a Code node or HTTP Request node references `$secrets.API_KEY` at runtime
**Then** the value is decrypted in memory and injected into the node context
**And** the plaintext value is never stored in logs, audit trail, or execution traces

**Given** the secrets manager
**When** I call `manage_secrets({ action: "list" })`
**Then** secret names and types are returned but values are never exposed

### Story 5.5: Queue Mode & Log Streaming

As an operator scaling flowAIbuilder,
I want BullMQ-based parallel execution and configurable log streaming,
So that I can handle high workflow volume and centralize operational logs.

**Acceptance Criteria:**

**Given** queue mode is enabled (QUEUE_MODE=true)
**When** a workflow execution is triggered
**Then** it is enqueued as a BullMQ job in Redis rather than executed inline
**And** a worker process picks up and executes the job

**Given** multiple workflows are triggered simultaneously
**When** queue mode is active
**Then** workflows execute in parallel across available workers up to the configured concurrency limit

**Given** a BullMQ job fails
**When** retry is configured
**Then** the job is retried according to the workflow's retry settings (attempts, backoff)

**Given** log streaming is configured with a destination (stdout, webhook URL, or S3 bucket)
**When** execution logs are generated
**Then** they are streamed to the configured destination in near-real-time

**Given** multiple log destinations are configured
**When** logs are generated
**Then** they are sent to all configured destinations

---

## Epic 6: Agent Teams Dashboard

Users can visualize and control Claude Code Agent Teams from the flowAIbuilder canvas.

### Story 6.1: Agent Teams File Watcher & Read MCP Tools

As a Claude Code user running Agent Teams,
I want flowAIbuilder to watch my team's files and expose team state via MCP,
So that the visual dashboard can show what my agents are doing.

**Acceptance Criteria:**

**Given** a Claude Code Agent Team is running at `~/.claude/teams/<teamName>/`
**When** I call `flowaibuilder.watch_team({ team_name })`
**Then** the server starts fs.watch() on the team's `inboxes/` directory and `tasks.json` file
**And** returns the current team state as initial snapshot

**Given** the watcher is active
**When** an agent's inbox file changes (new message)
**Then** the server parses the updated inbox and broadcasts an `agent_messages_updated` event via WebSocket

**Given** the watcher is active
**When** tasks.json changes (task status update)
**Then** the server parses the updated tasks and broadcasts a `team_tasks_updated` event with tasks and progress percentage

**Given** a team is being watched
**When** I call `flowaibuilder.get_team_state({ team_name })`
**Then** I receive: agents (name, status inferred from tasks, current task, completed count, recent messages), tasks (all with status/assignee), and progress percentage

**Given** a team is being watched
**When** I call `flowaibuilder.get_agent_messages({ team_name, agent_name, limit? })`
**Then** I receive the last N messages from that agent's inbox

### Story 6.2: Team Intervention MCP Tools

As a human overseeing Agent Teams,
I want to send messages to agents, reassign tasks, and link tasks to workflow nodes,
So that I can steer the team and connect their work to the visual canvas.

**Acceptance Criteria:**

**Given** a team is being watched
**When** I call `flowaibuilder.send_team_message({ team_name, to_agent, message })`
**Then** the message is appended to the agent's inbox JSON file at `~/.claude/teams/<teamName>/inboxes/<agent>.json`
**And** the message has from: "human", timestamp, and read: false

**Given** a team has tasks
**When** I call `flowaibuilder.update_task({ team_name, task_id, changes })`
**Then** the task in tasks.json is updated with the specified changes (status, assignee, blockers)

**Given** a team exists
**When** I call `flowaibuilder.add_task({ team_name, task })`
**Then** a new task with generated ID and status "unassigned" is appended to tasks.json

**Given** a task and a workflow node
**When** I call `flowaibuilder.link_task_to_node({ team_name, task_id, workflow_id, node_id })`
**Then** the mapping is stored in the DB
**And** a `task_linked_to_node` event is broadcast via WebSocket

### Story 6.3: Team Dashboard UI

As a human overseeing Agent Teams,
I want a visual dashboard showing agent status, tasks, and messages,
So that I can understand team progress at a glance instead of reading terminal output.

**Acceptance Criteria:**

**Given** a team is being watched
**When** I navigate to the team dashboard view
**Then** I see agent cards showing: name, inferred status (working/idle/blocked), current task, completed task count

**Given** the dashboard is open
**When** I view the task board section
**Then** tasks are displayed in columns by status (unassigned, in-progress, blocked, done) with assignee labels

**Given** the dashboard is open
**When** I view the message feed
**Then** inter-agent messages appear in chronological order with sender, recipient, and timestamp

**Given** the dashboard is open
**When** a WebSocket event updates team state (new message, task change)
**Then** the dashboard updates in real-time without page refresh

**Given** the dashboard header
**When** displayed
**Then** it shows team name, agent count, and overall progress bar (% tasks done)

### Story 6.4: Canvas Agent Integration & Team Templates

As a workflow user with Agent Teams,
I want to see which agent is building each node on the canvas and launch teams from templates,
So that I can track multi-agent workflow construction in real-time.

**Acceptance Criteria:**

**Given** tasks are linked to workflow nodes (via link_task_to_node)
**When** the canvas renders
**Then** each linked node displays an agent name badge (small pill below the node) color-coded by agent

**Given** an agent's linked task has status "in_progress"
**When** the canvas renders
**Then** the node shows a building indicator (pulsing border or spinner)

**Given** team templates exist (Webhook Pipeline 3-agent, AI Workflow 4-agent, Full-Stack 5-agent)
**When** I open the "Launch Team" dialog
**Then** I see available templates with agent roles and task descriptions

**Given** I select a template and click "Launch"
**When** the team is created
**Then** flowAIbuilder writes the team config to `~/.claude/teams/<teamName>/` with tasks.json populated from the template
**And** the dashboard begins watching the new team

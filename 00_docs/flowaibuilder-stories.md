# flowAIbuilder - User Stories (BMAD Format)

## Sprint 0: Day One MVP

Priority order. Each story is a single Claude Code task.

---

### Story 1: Project Scaffold
**Priority:** P0 - do first
**Estimate:** 30 min

**As** a developer,
**I want** a working monorepo with server, UI, and shared packages,
**So that** I can start building features immediately.

**Acceptance criteria:**
- [ ] Monorepo with `packages/server`, `packages/ui`, `packages/shared`
- [ ] `packages/server`: Fastify + TypeScript + tsup + drizzle-orm
- [ ] `packages/ui`: React + Vite + Tailwind + @xyflow/react + zustand + lucide-react
- [ ] `packages/shared`: shared types (Workflow, Node, Connection, Execution, Annotation, ProtectedZone)
- [ ] `docker-compose.yml` with postgres:16 + redis:7
- [ ] Server starts on port 3000, UI on 5173
- [ ] `CLAUDE.md` in project root
- [ ] `00_docs/` with PRD and Architecture docs

---

### Story 2: Database Schema
**Priority:** P0
**Estimate:** 20 min

**As** the server,
**I want** all database tables created,
**So that** all features have storage from day one.

**Acceptance criteria:**
- [ ] Drizzle schema in `packages/server/src/db/schema.ts`
- [ ] Tables: workflows, executions, audit_log, workflow_versions, users, credentials, annotations, workflow_reviews, protected_zones
- [ ] `npm run db:push` creates all tables in PostgreSQL
- [ ] All types from `packages/shared` match DB schema

---

### Story 3: Workflow Engine - Core Executor
**Priority:** P0
**Estimate:** 1.5 hours

**As** the engine,
**I want** to execute a workflow graph node by node,
**So that** workflows actually run.

**Acceptance criteria:**
- [ ] `WorkflowExecutor.execute(workflow, triggerData?)` runs the graph
- [ ] Topological sort of nodes respecting connections
- [ ] Sequential execution: each node receives previous node's output
- [ ] Per-node execution tracking: status, duration, input/output data, errors
- [ ] Full execution stored in `executions` table with all node traces
- [ ] IF node branches correctly (true/false paths)
- [ ] Error in one node stops execution (unless retry configured)

---

### Story 4: Core Node Implementations
**Priority:** P0
**Estimate:** 1 hour

**As** the engine,
**I want** 6 node types working,
**So that** basic workflows can run.

**Acceptance criteria:**
- [ ] `WebhookTrigger`: registers Fastify route, extracts body/headers/query
- [ ] `CodeJS`: executes JavaScript in isolated-vm sandbox with $input, $json, $helpers, $env, $secrets context
- [ ] `HttpRequest`: HTTP client (fetch/axios) with method, url, headers, body, auth
- [ ] `If`: evaluates condition (field, operator, value), routes to true/false output
- [ ] `Set`: sets/modifies fields on the data object  
- [ ] `RespondWebhook`: returns HTTP response to webhook caller
- [ ] All nodes follow BaseNode interface: `execute(input, context) -> output`

---

### Story 5: MCP Server - Core Tools
**Priority:** P0
**Estimate:** 1 hour

**As** Claude Code (via MCP),
**I want** to create and manage workflows,
**So that** I can build automations from the terminal.

**Acceptance criteria:**
- [ ] MCP server registered as Fastify plugin
- [ ] stdio transport works (for Claude Code local)
- [ ] SSE transport works (for remote/VPS access)
- [ ] Tools implemented:
  - `flowaibuilder.create_workflow` -> creates workflow in DB, returns ID + canvas URL
  - `flowaibuilder.add_node` -> adds node with auto-position, optional connect_after
  - `flowaibuilder.update_node` -> updates node config
  - `flowaibuilder.remove_node` -> removes node + edges
  - `flowaibuilder.connect_nodes` -> creates edge
  - `flowaibuilder.get_workflow` -> returns full workflow JSON
  - `flowaibuilder.list_workflows` -> lists all workflows
  - `flowaibuilder.execute_workflow` -> runs workflow, returns execution result
- [ ] Test: Claude Code can create a 3-node workflow (webhook -> code -> respond) and execute it

---

### Story 6: WebSocket Broadcaster
**Priority:** P0
**Estimate:** 30 min

**As** the UI,
**I want** real-time updates from the server,
**So that** the canvas shows changes as they happen.

**Acceptance criteria:**
- [ ] WebSocket server on port 5174
- [ ] Broadcasts: workflow_created, node_added, node_updated, node_removed, connection_added, node_executed, execution_completed
- [ ] UI connects on page load, auto-reconnects on disconnect
- [ ] When Claude adds a node via MCP, it appears on canvas within 500ms

---

### Story 7: Visual Canvas
**Priority:** P0
**Estimate:** 1.5 hours

**As** a human user,
**I want** to see and edit workflows visually,
**So that** I can understand and modify what Claude builds.

**Acceptance criteria:**
- [ ] React Flow canvas fills 80% of screen width
- [ ] Custom node components for each type:
  - TriggerNode (purple, zap icon)
  - CodeNode (teal, code icon, shows first line of code)
  - HttpNode (coral, globe icon, shows method + URL)
  - LogicNode (amber, branch icon, shows condition)
  - OutputNode (gray)
- [ ] Nodes are draggable, positions persist
- [ ] Click node -> sidebar opens with config form
- [ ] Add node: toolbar dropdown with all node types
- [ ] Delete node: select + Delete key or right-click
- [ ] Connect nodes: drag from handle to handle
- [ ] Auto-layout button (simple top-to-bottom)
- [ ] WebSocket: nodes appear in real-time when Claude adds them via MCP

---

### Story 8: Node Config Sidebar
**Priority:** P0
**Estimate:** 45 min

**As** a human user,
**I want** to edit node configuration in a sidebar,
**So that** I can fine-tune what Claude built.

**Acceptance criteria:**
- [ ] Sidebar opens when node is clicked (20% of screen width)
- [ ] Shows node type icon + name (editable)
- [ ] Dynamic form based on node type:
  - Webhook: method dropdown, path input
  - Code: language toggle (JS/Python), code textarea with monospace font
  - HTTP Request: URL input, method dropdown, headers key-value, body textarea
  - IF: field input, operator dropdown, value input
  - Set: field-value pairs (add/remove rows)
- [ ] Changes save on blur/enter -> calls update_node API
- [ ] Delete button at bottom
- [ ] Close button (X) or click canvas to close

---

### Story 9: Export Engine
**Priority:** P1
**Estimate:** 45 min

**As** a user,
**I want** to export the workflow as a structured prompt, TypeScript code, or mermaid diagram,
**So that** I can use it outside flowAIbuilder.

**Acceptance criteria:**
- [ ] Export panel (modal or tab) with 3 formats
- [ ] **Prompt export**: Numbered markdown steps, each with action/inputs/outputs/errors
- [ ] **TypeScript export**: Async functions per node, proper imports, typed interfaces
- [ ] **Mermaid export**: graph TD with node labels and edge labels
- [ ] Copy button for each format
- [ ] MCP tool: `flowaibuilder.export({ workflow_id, format })`

---

### Story 10: AI Review - Get Context + Save Annotations
**Priority:** P1
**Estimate:** 45 min

**As** Claude Code (via MCP),
**I want** to read the full workflow context and write review annotations,
**So that** I can analyze workflows and show findings on canvas.

**Acceptance criteria:**
- [ ] `flowaibuilder.get_review_context({ workflow_id })` returns:
  - Full node list with configs
  - Connections
  - Per-node incoming/outgoing data fields (server-computed)
  - Detected pattern (rule-based)
  - Recent execution results (if any)
  - Current annotations
  - Protected zones
- [ ] `flowaibuilder.save_annotations({ workflow_id, annotations[], health_score })`:
  - Stores annotations in DB
  - Broadcasts to canvas via WebSocket
  - Updates workflow health score
- [ ] `flowaibuilder.apply_fix({ workflow_id, annotation_id })`:
  - Reads fix from annotation
  - Executes the MCP tool call defined in fix.tool + fix.params
  - Marks annotation as applied
- [ ] Canvas shows:
  - Annotation cards attached to nodes (color-coded by severity)
  - Health score badge in header
  - "Applied" state on fixed annotations
- [ ] Test: Claude Code calls get_review_context, analyzes, saves 2 annotations, applies 1 fix

---

### Story 11: Protected Zones
**Priority:** P1
**Estimate:** 45 min

**As** a human user,
**I want** to pin groups of nodes that AI cannot modify,
**So that** working parts of my workflow stay safe.

**Acceptance criteria:**
- [ ] `flowaibuilder.create_zone({ workflow_id, name, node_ids })` creates zone in DB
- [ ] `flowaibuilder.get_zones({ workflow_id })` returns all zones
- [ ] `flowaibuilder.delete_zone({ workflow_id, zone_id })` removes zone
- [ ] **Server enforcement**: update_node, remove_node, disconnect_nodes return error if node is in a zone
- [ ] Error message tells Claude exactly what it CAN and CANNOT do
- [ ] Canvas shows: blue dashed boundary around zone, lock icons on pinned nodes, zone label
- [ ] UI: select nodes -> right-click -> "Create protected zone" -> name input
- [ ] UI: click zone boundary -> "Unpin zone" button
- [ ] get_review_context includes zones (so Claude knows what's pinned)
- [ ] Test: pin 2 nodes, Claude tries to update_node on pinned node, gets error, adapts

---

### Story 12: Enterprise Foundations
**Priority:** P1
**Estimate:** 1 hour

**As** an admin,
**I want** audit logs, versioning, and basic auth,
**So that** the system is production-ready from day one.

**Acceptance criteria:**
- [ ] **Audit log**: every API/MCP call logged with actor, action, resource, timestamp
- [ ] `flowaibuilder.get_audit_log({ workflow_id })` MCP tool works
- [ ] Audit log page in UI (table with filters)
- [ ] **Versioning**: workflow version increments on every save, snapshots stored
- [ ] `workflow_versions` table populated on every update
- [ ] **Auth**: email/password registration + login via Lucia
- [ ] JWT tokens for API access
- [ ] Protected API routes (except health check)

---

### Story 13: Docker Deploy
**Priority:** P0
**Estimate:** 30 min

**As** a user,
**I want** to run flowAIbuilder with one command,
**So that** I can deploy on my local machine or VPS.

**Acceptance criteria:**
- [ ] `docker-compose.yml` runs: postgres + redis + server + ui
- [ ] `Dockerfile` for server (multi-stage: build + runtime)
- [ ] `Dockerfile` for UI (nginx serving built files)
- [ ] `docker compose up -d` -> everything starts
- [ ] UI accessible at http://localhost:5173
- [ ] API accessible at http://localhost:3000
- [ ] MCP config example in README for Claude Desktop / Claude Code
- [ ] Health check endpoint at /api/health

---

## Sprint 1: Week 2

### Story 14: Agent Teams Dashboard
Watch ~/.claude/teams/ files, visualize agents/tasks/messages.

### Story 15: SSO (SAML/LDAP)
Via Lucia adapters, configurable in settings.

### Story 16: Git Sync
Push/pull workflows to git repo via isomorphic-git.

### Story 17: Environments
Dev/staging/prod with workflow promotion between envs.

### Story 18: Queue Mode
BullMQ workers for parallel workflow execution.

### Story 19: n8n Import
Convert n8n workflow JSON to flowAIbuilder format.

### Story 20: Additional Nodes
Schedule trigger, Switch, Merge, Loop, AI Agent nodes.

---

## Sprint 2: Week 3-4

### Story 21: RBAC
Admin/editor/viewer roles with permission checks.

### Story 22: Secrets Manager
Encrypted credential storage, $secrets context in nodes.

### Story 23: Log Streaming
Stream execution logs to stdout/webhook/S3.

### Story 24: Custom Review Rules
User-defined review rules (e.g. "always require error handling after HTTP nodes").

### Story 25: Plugin System
npm-based custom nodes, community registry.

### Story 26: Template Marketplace
Pre-built workflow templates, share/import.

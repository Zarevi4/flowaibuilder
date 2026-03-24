---
description: "Check which BMAD stories are complete, in progress, or not started. Scans codebase for implementation evidence."
---

# Story Progress Check

Scan the codebase and verify implementation status of each story from `00_docs/flowaibuilder-stories.md`.

## Check each story by looking for actual code, not placeholders:

### Story 1: Project Scaffold
- [ ] `packages/server/package.json` exists with Fastify, Drizzle deps
- [ ] `packages/ui/package.json` exists with React, @xyflow/react deps
- [ ] `packages/shared/src/types/` has workflow.ts, execution.ts, annotation.ts, zone.ts, audit.ts, mcp.ts
- [ ] `docker-compose.yml` has postgres + redis services
- [ ] Root `package.json` has workspaces config

### Story 2: Database Schema
- [ ] `packages/server/src/db/schema.ts` has ALL 10 tables (count them)
- [ ] `packages/server/src/db/index.ts` connects Drizzle to PostgreSQL
- [ ] Tables: workflows, executions, auditLog, workflowVersions, users, credentials, annotations, workflowReviews, protectedZones
- [ ] Actually run `npm run db:push` to verify tables create in PostgreSQL

### Story 3: Workflow Engine
- [ ] `packages/server/src/engine/executor.ts` has WorkflowExecutor class
- [ ] `topologicalSort()` method exists and handles cycles
- [ ] `execute()` creates execution record, runs nodes, stores results
- [ ] IF branching skips untaken branches
- [ ] Retry logic present

### Story 4: Node Implementations
- [ ] `nodes/triggers/webhook.ts` - registers Fastify route
- [ ] `nodes/logic/code-js.ts` - executes JS with sandbox
- [ ] `nodes/integration/http-request.ts` - HTTP client
- [ ] `nodes/logic/if.ts` - condition evaluation
- [ ] `nodes/logic/set.ts` - field modification
- [ ] `nodes/output/respond-webhook.ts` - HTTP response
- [ ] `nodes/index.ts` registers ALL handlers

### Story 5: MCP Server
- [ ] `packages/server/src/mcp/index.ts` creates McpServer
- [ ] `mcp/tools/workflow-tools.ts` has create, get, list, delete
- [ ] `mcp/tools/node-tools.ts` has add, update, remove, connect
- [ ] `mcp/tools/execution-tools.ts` has execute, get, list
- [ ] MCP registered in Fastify server (index.ts imports it)
- [ ] stdio AND SSE transports configured

### Story 6: WebSocket
- [ ] `packages/server/src/api/ws/broadcaster.ts` exists
- [ ] WebSocket server starts on port 5174 (or configured port)
- [ ] Broadcasts: node_added, node_updated, node_removed, execution events
- [ ] `packages/ui/src/store/` has WebSocket connection hook

### Story 7: Visual Canvas
- [ ] Custom node components for each type in `ui/src/components/canvas/nodes/`
- [ ] Nodes are color-coded by type
- [ ] Click node opens sidebar
- [ ] Add node toolbar/dropdown
- [ ] WebSocket listener updates canvas in real-time

### Story 8: Node Config Sidebar
- [ ] Sidebar component exists
- [ ] Dynamic form based on node type
- [ ] Changes call update API
- [ ] Code node has monospace textarea

### Story 9: Export Engine
- [ ] Prompt compiler (workflow -> markdown)
- [ ] TypeScript compiler (workflow -> TS code)
- [ ] Mermaid compiler (workflow -> diagram)

### Story 10: AI Review
- [ ] `get_review_context` MCP tool returns full graph
- [ ] `save_annotations` MCP tool stores annotations
- [ ] `apply_fix` MCP tool executes fix
- [ ] Canvas shows annotation overlays

### Story 11: Protected Zones
- [ ] `create_zone` MCP tool
- [ ] ZoneEnforcer middleware checks all write ops
- [ ] Canvas shows zone boundaries

### Story 12: Enterprise
- [ ] Audit log middleware logs every request
- [ ] Workflow versioning on save
- [ ] Basic auth (email/password)

### Story 13: Docker Deploy
- [ ] Dockerfile for server
- [ ] Dockerfile for UI
- [ ] `docker compose up -d` starts everything

## Output
Print a summary table:
| Story | Status | Evidence |
|-------|--------|----------|
| 1 | ✅/⚠️/❌ | What exists / what's missing |
| ... | ... | ... |

And the overall progress: X/13 stories complete.

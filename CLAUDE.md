# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Project Overview

**flowAIbuilder** is the visual control center for Claude Code (MIT license). Watch AI agents build workflows in real-time. Review what they built. Pin what works. Let them iterate on the rest.

**Positioning**: NOT an "n8n alternative". We are the visual layer for Claude Code power users who want to SEE what their agents are doing.

Key features (in priority order):
1. **Visual Canvas**: React Flow workflow editor — the substrate where agents build
2. **Agent Teams Dashboard**: Visual control center for Claude Code Agent Teams. Watches ~/.claude/teams/ files, shows agents/tasks/messages on canvas. THIS IS THE KILLER FEATURE — nobody else has it.
3. **AI Review**: Claude (user's subscription) analyzes workflows via MCP, annotates canvas with errors/warnings/suggestions. Zero cost — we serve data, Claude thinks.
4. **Protected Zones**: Pin working nodes so AI can't modify them. Server-side enforcement via MCP.
5. **MCP-native**: Built-in MCP server — Claude Code creates, edits, executes workflows directly.

**Epic execution order**: Epic 1 (Canvas) → Epic 6 (Agent Teams) → Epic 2 (AI Review) → Epic 3 (Zones) → Epic 4 (Export/Deploy) → Epic 5 (Enterprise). See `Claude Instructions/sprint-execution-order.md`.

## Architecture

```
packages/
  server/        # Fastify + Drizzle + BullMQ + MCP server
  ui/            # React + @xyflow/react + Tailwind + Zustand
  shared/        # Shared TypeScript types
docker-compose.yml
```

- **Server**: Fastify API + built-in MCP server (stdio + HTTP/SSE transport) + WebSocket broadcaster
- **Engine**: Node executor with VM sandbox for Code nodes
- **UI**: React Flow canvas with custom nodes, config sidebar, export panel, annotation overlays, zone boundaries, agent team dashboard
- **DB**: PostgreSQL via Drizzle ORM (both dev and prod — we rely on Postgres-native JSON operators like `metadata->>'key'`, so SQLite is not supported)
- **Queue**: BullMQ + Redis for parallel execution
- **Auth**: Lucia (local + SSO/SAML/LDAP)

## Key Principles

### Zero-cost AI model
flowAIbuilder does NOT call Claude API. Ever. The user's own Claude (Pro/Max) does all thinking.
- `get_review_context` returns data -> Claude analyzes (user's tokens) -> `save_annotations` writes back
- We are purely tools + data storage + visualization
- No `@anthropic-ai/sdk` dependency on the server

### MCP-first
Every feature is an MCP tool first, REST API second, UI button third.
Claude Code should be able to do everything without the UI.

### Protected Zones enforcement
Every node write operation (update, remove, disconnect) MUST check zones first via ZoneEnforcer.
If a node is pinned, the MCP tool returns a descriptive error guiding Claude to work around it.

### File-based Agent Teams integration  
We read/write the same `~/.claude/teams/` files that Claude Code Agent Teams uses.
No custom protocol. fs.watch() + JSON parsing.

## Node Types (MVP)

Triggers: webhook, schedule, manual
Logic: code-js, code-python, if, switch, merge, loop, set
Integration: http-request, ai-agent
Output: respond-webhook

Claude primarily uses Code (JS) + HTTP Request for 80% of workflows.

## Tech Stack

- TypeScript throughout
- Fastify (server framework)
- Drizzle (ORM)
- @xyflow/react (canvas)
- Zustand (UI state)
- BullMQ + Redis (queue)
- Lucia (auth)
- @modelcontextprotocol/sdk (MCP)
- ws (WebSocket)
- isolated-vm (Code node sandboxing)
- isomorphic-git (git sync)
- Vite (UI build)
- tsup (server build)
- Docker + docker-compose (deploy)

## File Conventions

- Server source: `packages/server/src/`
- UI source: `packages/ui/src/`
- Shared types: `packages/shared/src/`
- DB migrations: `packages/server/src/db/migrations/`
- MCP tools: `packages/server/src/mcp/tools/` (one file per tool group)
- Node implementations: `packages/server/src/nodes/` (one file per node type)
- UI components: `packages/ui/src/components/` (grouped by feature)

## Commands

```bash
# Development
npm run dev              # Start server + UI in dev mode
npm run dev:server       # Server only
npm run dev:ui           # UI only

# Build
npm run build            # Build everything
npm run build:server     # Server only
npm run build:ui         # UI only

# Database
npm run db:push          # Push schema changes
npm run db:migrate       # Run migrations
npm run db:studio        # Open Drizzle Studio

# Docker
docker compose up -d     # Start full stack
docker compose down      # Stop
docker compose logs -f   # Follow logs

# MCP testing
npm run mcp:test         # Test MCP tools locally
```

## Documentation

Full project documentation is in `00_docs/`:
- `flowaibuilder-prd.md` - Product requirements (features, user stories, data models)
- `flowaibuilder-architecture.md` - Technical architecture (project structure, DB schema, implementations)

Always read these before making architectural decisions.

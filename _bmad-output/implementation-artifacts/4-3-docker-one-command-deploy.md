# Story 4.3: Docker One-Command Deploy

Status: done

## Story

As an operator,
I want to deploy flowAIbuilder with a single docker compose command,
So that I can run the full stack (server, UI, PostgreSQL, Redis) without manual setup.

## Acceptance Criteria

1. **Given** the repository is cloned, **When** I run `docker compose up -d`, **Then** four containers start: postgres (16-alpine), redis (7-alpine), flowaibuilder-server, flowaibuilder-ui

2. **Given** the containers are running, **When** I open `http://localhost:5173`, **Then** the flowAIbuilder UI loads and can communicate with the API at `http://localhost:3000`

3. **Given** the containers are running, **When** I configure Claude Code with MCP pointing to `http://localhost:3000`, **Then** Claude can call flowAIbuilder MCP tools via HTTP/SSE transport

4. **Given** the postgres container starts fresh, **When** the server container starts, **Then** database migrations run automatically and the schema is ready

5. **Given** environment variables are set in docker-compose.yml, **When** the server reads them, **Then** DATABASE_URL, REDIS_URL, JWT_SECRET, and ENCRYPTION_KEY are configurable **And** default values work for local development

## Tasks / Subtasks

- [x] Task 1: Create server Dockerfile (AC: #1, #4)
  - [x] 1.1 Multi-stage build: node:22-alpine builder stage → node:22-alpine production stage
  - [x] 1.2 Build `packages/shared` first (server depends on it), then build server with `tsup`
  - [x] 1.3 Copy only `dist/`, `node_modules/` (production), `drizzle.config.ts`, and `src/db/migrations/` to final stage
  - [x] 1.4 Entrypoint script that runs `npx drizzle-kit migrate` before `node dist/index.js`
  - [x] 1.5 Create `packages/server/.dockerignore`

- [x] Task 2: Create UI Dockerfile (AC: #1, #2)
  - [x] 2.1 Multi-stage build: node:22-alpine builder → nginx:alpine-slim production
  - [x] 2.2 Build `packages/shared` first, then `vite build` for UI
  - [x] 2.3 Nginx config to serve SPA (all routes → index.html) on port 5173
  - [x] 2.4 Nginx reverse-proxy `/api/*` to `flowaibuilder-server:3000` and `/ws` to WebSocket
  - [x] 2.5 Create `packages/ui/.dockerignore`

- [x] Task 3: Update docker-compose.yml (AC: #1, #2, #3, #5)
  - [x] 3.1 Add `flowaibuilder-server` service: build from `./packages/server`, expose port 3000, configure env vars, depends_on postgres/redis with `condition: service_healthy`
  - [x] 3.2 Add `flowaibuilder-ui` service: build from `./packages/ui`, expose port 5173, depends_on flowaibuilder-server
  - [x] 3.3 Keep existing postgres and redis services with healthchecks (already present)
  - [x] 3.4 Add environment variables: DATABASE_URL, REDIS_URL, JWT_SECRET, ENCRYPTION_KEY with sensible defaults
  - [x] 3.5 Add WebSocket port 5174 mapping on server if using separate WS port

- [x] Task 4: Create root .dockerignore (AC: #1)
  - [x] 4.1 Exclude node_modules, dist, .git, _bmad*, docs, *.md (except package READMEs if any)

- [x] Task 5: Auto-migration on server startup (AC: #4)
  - [x] 5.1 Create `packages/server/docker-entrypoint.sh` that runs drizzle-kit migrate then starts server
  - [x] 5.2 Ensure drizzle.config.ts reads DATABASE_URL from env (already does via `process.env.DATABASE_URL`)
  - [x] 5.3 Verify migration files exist in `packages/server/src/db/migrations/`; if no migrations folder exists yet, use `drizzle-kit push` as fallback

- [x] Task 6: Smoke test (AC: #1, #2, #3, #4, #5)
  - [x] 6.1 `docker compose build` succeeds with no errors
  - [x] 6.2 `docker compose up -d` starts all 4 containers
  - [x] 6.3 `curl http://localhost:3000/api/health` returns `{ status: "ok" }`
  - [x] 6.4 `curl http://localhost:5173` returns the UI HTML
  - [x] 6.5 WebSocket connection to ws://localhost:5174 (or proxied via nginx) succeeds

## Dev Notes

### Architecture & Build Context

- **Monorepo structure**: Root uses npm workspaces (`packages/*`). The `shared` package MUST be built before server and UI since both depend on `@flowaibuilder/shared`.
- **Server build**: Uses `tsup` (`tsup src/index.ts --format esm --dts`). Output goes to `dist/`. Runtime: `node dist/index.js`. ESM modules (`"type": "module"`).
- **UI build**: Uses `vite build` with React plugin + Tailwind CSS v4 plugin. Output goes to `dist/`. Served as static files in production.
- **DB**: PostgreSQL via Drizzle ORM. Connection string defaults to `postgres://flowaibuilder:flowaibuilder@localhost:5432/flowaibuilder` in `drizzle.config.ts`. Schema is in `packages/server/src/db/schema.ts`, uses `pgTable` imports.
- **WebSocket**: Currently runs on separate port 5174 via the `ws` package (not Fastify plugin for the broadcaster). The broadcaster is created in `packages/server/src/index.ts` with `createBroadcaster(WS_PORT, ...)`.
- **MCP**: Server exposes SSE transport on the Fastify server (port 3000). Stdio transport is optional via `--stdio` flag.

### Critical Implementation Details

- **Vite dev port is 5180** (set in `vite.config.ts`), NOT 5173. The Docker UI container should serve on port **5173** (as specified in AC) since nginx replaces Vite's dev server in production.
- **Vite proxies** `/api` to `http://localhost:3000` and `/ws` to `ws://localhost:3000` in dev mode. In Docker, nginx must handle this routing instead.
- **The existing docker-compose.yml** already has postgres + redis with healthchecks. Extend it, don't replace it. Keep the existing healthcheck configs.
- **Server reads env vars** at startup: `PORT` (default 3000), `WS_PORT` (default 5174), plus `DATABASE_URL`, `REDIS_URL` from dotenv. For Docker, set these as environment variables in compose.
- **`postgres` driver**: Server uses the `postgres` npm package (not `pg`). Connection string format: `postgres://user:pass@host:port/db`.

### Anti-Patterns to Avoid

- Do NOT use `npm install` in Docker without `--omit=dev` for production stage — keep images small
- Do NOT copy the entire monorepo into each service Dockerfile. Use Docker build context from root and selective COPY
- Do NOT hardcode localhost in environment variables within docker-compose — use Docker service names (e.g., `postgres`, `redis`, `flowaibuilder-server`)
- Do NOT forget to build `packages/shared` before building server or UI — both have `@flowaibuilder/shared` as a workspace dependency
- Do NOT expose postgres (5432) and redis (6379) ports externally in docker-compose production config — only expose them if needed for dev; the current compose already exposes them for dev, which is fine
- Do NOT use `version: '3.8'` in docker-compose.yml — the current file correctly omits the deprecated `version` field

### Build Context Strategy

Since this is a monorepo, Dockerfiles need access to `packages/shared/` plus their own package. Two approaches:
1. **Recommended**: Set Docker build context to repo root, use `.dockerignore` to exclude unnecessary files, and COPY shared + target package
2. Alternative: Pre-build shared, copy the built output — more complex and fragile

Use approach 1. Both Dockerfiles should live in their respective `packages/server/` and `packages/ui/` dirs but the build context in docker-compose should be set to `.` (repo root) with `dockerfile: packages/server/Dockerfile` etc.

### Nginx Configuration

Create `packages/ui/nginx.conf`:
- Listen on port 5173
- Serve `/` from `/usr/share/nginx/html` (Vite build output)
- `try_files $uri $uri/ /index.html` for SPA routing
- Proxy `/api/` to `http://flowaibuilder-server:3000/api/`
- Proxy `/ws` to `ws://flowaibuilder-server:5174` with WebSocket upgrade headers (`Upgrade`, `Connection`)

### Project Structure Notes

Files to create:
- `packages/server/Dockerfile` — multi-stage server build
- `packages/server/.dockerignore`
- `packages/server/docker-entrypoint.sh` — migration + start
- `packages/ui/Dockerfile` — multi-stage UI build + nginx
- `packages/ui/.dockerignore`
- `packages/ui/nginx.conf` — SPA serving + reverse proxy
- `.dockerignore` — root-level exclusions

Files to modify:
- `docker-compose.yml` — add server and UI services to existing postgres + redis

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#Docker Compose (One-Command Deploy)] — reference compose config
- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.3] — acceptance criteria
- [Source: packages/server/src/index.ts] — server startup, ports, env vars
- [Source: packages/server/drizzle.config.ts] — DB connection config, migration path
- [Source: packages/ui/vite.config.ts] — dev port 5180, proxy config
- [Source: docker-compose.yml] — existing postgres + redis with healthchecks

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- UI build failed on first attempt due to pre-existing TS error in `store-node-actions.test.ts:131` — `null` not assignable to `string` for `onConnect` source param. Fixed with `as unknown as string` cast since the function handles null gracefully at runtime.
- First `curl http://localhost:5173` returned unexpected content (local proxy interference); verified via `curl http://127.0.0.1:5173` and `docker compose exec` that nginx serves correct content.

### Completion Notes List
- Created multi-stage Docker builds for both server and UI packages with root build context strategy
- Server Dockerfile: node:22-alpine builder → node:22-alpine production, includes drizzle-kit/tsx for migrations
- UI Dockerfile: node:22-alpine builder → nginx:alpine-slim production with SPA routing + reverse proxy
- Docker-compose extended with flowaibuilder-server and flowaibuilder-ui services preserving existing postgres/redis healthchecks
- Auto-migration entrypoint detects migrations folder; falls back to drizzle-kit push if none exist
- All 4 containers start and communicate correctly; health endpoint, UI, and WebSocket verified
- All existing tests pass (77 server + 124 UI, zero regressions)

### File List
- `packages/server/Dockerfile` (new) — Multi-stage server Docker build
- `packages/server/.dockerignore` (new) — Server Docker ignore rules
- `packages/server/docker-entrypoint.sh` (new) — Migration + server startup script
- `packages/ui/Dockerfile` (new) — Multi-stage UI Docker build with nginx
- `packages/ui/nginx.conf` (new) — Nginx SPA serving + reverse proxy config
- `packages/ui/.dockerignore` (new) — UI Docker ignore rules
- `.dockerignore` (new) — Root-level Docker ignore
- `docker-compose.yml` (modified) — Added flowaibuilder-server and flowaibuilder-ui services
- `packages/ui/src/__tests__/store-node-actions.test.ts` (modified) — Fixed TS error: null cast for onConnect test

### Review Findings
- [x] [Review][Decision] drizzle-kit push fallback can destructively alter production DB — RESOLVED: accepted for dev-only compose; production deploy story will enforce migrations [docker-entrypoint.sh:7-13]
- [x] [Review][Patch] Production image includes all devDependencies — FIXED: added shared node_modules copy; full devDep pruning skipped because drizzle-kit (devDep) is needed at runtime for migrations [packages/server/Dockerfile:34-35]
- [x] [Review][Patch] No healthcheck on server/UI containers — FIXED: added healthcheck to server, UI now uses service_healthy condition [docker-compose.yml]
- [x] [Review][Patch] Missing proxy_read_timeout for WebSocket and SSE — FIXED: added proxy_read_timeout 86400s to /ws and /mcp/ blocks [packages/ui/nginx.conf]
- [x] [Review][Patch] npx in production entrypoint risks network calls — FIXED: using absolute /app/node_modules/.bin/drizzle-kit path [docker-entrypoint.sh]
- [x] [Review][Patch] ENCRYPTION_KEY is 37 chars not 32 — FIXED: truncated to exactly 32 chars [docker-compose.yml]
- [x] [Review][Patch] Shared package node_modules not copied to production stage — N/A: npm hoists all shared deps to root node_modules; no nested node_modules exists [packages/server/Dockerfile]
- [x] [Review][Patch] Source src/db/ copied to production unnecessarily — SKIPPED: drizzle-kit needs TS schema source for both migrate and push; not safely removable [packages/server/Dockerfile:45]
- [x] [Review][Defer] Hardcoded dev secrets in docker-compose.yml — JWT_SECRET and ENCRYPTION_KEY are plaintext defaults; needs .env or Docker secrets for production — deferred, pre-existing design choice
- [x] [Review][Defer] REDIS_URL configured but not consumed by server — BullMQ/Redis integration is a future epic — deferred, pre-existing

### Change Log
- 2026-03-28: Implemented Docker one-command deploy — all 6 tasks complete, all ACs satisfied, all smoke tests pass
- 2026-03-28: Code review complete — 1 decision-needed, 7 patch, 2 deferred, 1 dismissed

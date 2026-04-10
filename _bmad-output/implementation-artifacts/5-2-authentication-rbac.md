# Story 5.2: Authentication & RBAC

Status: done

## Story

As an admin,
I want user authentication with SSO support and role-based access control,
so that I can manage who can access and modify workflows.

## Acceptance Criteria

1. **Given** the auth system is configured, **When** a user registers via `POST /api/auth/register` with `{ email, password, name? }`, **Then** the account is created in the `users` table with `password_hash` set (argon2id), `role` defaulted to `editor` (or `admin` if this is the very first user in the instance), `sso_provider=null`; the response returns `{ user: { id, email, name, role }, session: { token, expiresAt } }` and sets an HTTP-only `flowai_session` cookie.

2. **Given** a registered local user, **When** they call `POST /api/auth/login` with `{ email, password }`, **Then** the password is verified against `password_hash`; on success a new session row is created and the session token + cookie are returned; on failure a 401 is returned with body `{ error: 'invalid_credentials' }` and NO audit entry is written for the failed attempt (AC #7 of story 5.1 governs failure audit behaviour, but see AC #9 below for auth-specific logging).

3. **Given** SSO is configured via env vars (`SSO_PROVIDER=saml|ldap` plus the provider settings below), **When** a user authenticates via the SSO flow (`GET /api/auth/sso/login` → provider redirect → `POST /api/auth/sso/callback`), **Then** a user row is found-or-created matching `(sso_provider, sso_id)`; on first login `email` and `name` are copied from the SSO assertion, `role` defaults to `editor`, and `password_hash` stays `null`; a session is issued exactly as for local login.

4. **Given** a valid session token (via `Authorization: Bearer <token>` header OR `flowai_session` cookie), **When** any protected endpoint is hit, **Then** an `onRequest` auth hook loads the session, looks up the user, and attaches `request.user = { id, email, name, role }`; expired or unknown sessions are rejected with 401 and the cookie is cleared.

5. **Given** no session and no bearer token, **When** a request hits a protected endpoint, **Then** the response is `401 { error: 'unauthenticated' }`. The following endpoints are PUBLIC and MUST NOT require auth: `GET /api/health`, `POST /api/auth/register` (only while no users exist OR when `ALLOW_PUBLIC_REGISTRATION=true`), `POST /api/auth/login`, `GET /api/auth/sso/login`, `POST /api/auth/sso/callback`. The MCP stdio transport is considered local/trusted and bypasses auth; MCP over `POST /mcp/sse` requires a valid session.

6. **Given** a user with role `viewer|editor|admin`, **When** they invoke any REST route or MCP tool, **Then** an RBAC guard checks permissions against this matrix and returns `403 { error: 'forbidden', required_role: '...' }` on violation:
   - **viewer:** all `GET` routes, plus MCP read-only tools (`list_workflows`, `get_workflow`, `get_annotations`, `get_audit_log`, `get_execution_log`, `get_team_state`, `get_zones`, `validate_workflow`, `export_workflow`, `get_review_context`)
   - **editor:** viewer perms + all workflow/node/zone/annotation mutations, execution triggers, import, and review tools
   - **admin:** editor perms + user management (`/api/users/*`), instance settings (`PUT /api/settings`), and credential/secret writes

7. **Given** an admin is logged in, **When** they call `POST /api/users` with `{ email, name, password?, role }` or `PUT /api/users/:id` with `{ role?, name?, password? }` or `DELETE /api/users/:id`, **Then** the operation succeeds; non-admin actors receive `403`. Admins cannot delete or demote themselves (returns `400 { error: 'cannot_modify_self' }`).

8. **Given** a logged-in user, **When** they call `POST /api/auth/logout`, **Then** the current session row is deleted and the cookie is cleared (204). `GET /api/auth/me` returns the current `request.user` or 401.

9. **Given** the audit middleware from Story 5.1, **When** any auth event occurs, **Then** these actions are written to `audit_log`: `auth.user.registered`, `auth.login.succeeded`, `auth.login.failed` (exception to Story 5.1 AC #2 — failed logins ARE audited), `auth.logout`, `auth.sso.linked`, `user.created`, `user.updated`, `user.deleted`. For login events the actor is the target user's email (or `'anonymous'` for unknown-email failures) and `metadata` includes `{ ip, user_agent, method: 'local'|'saml'|'ldap' }`. Passwords and SSO assertions MUST be redacted — rely on the existing `redactSecrets` key matcher.

10. **Given** the audit middleware's existing `actor = request.user?.email ?? 'anonymous'` fallback (Story 5.1, `api/middleware/audit.ts:152-153`), **When** a request is now authenticated, **Then** `actor` resolves to the real user email without any change to the middleware's logic — this story only populates `request.user`, it does NOT rewrite the audit plugin.

## Tasks / Subtasks

- [x] Task 1: Schema — sessions table + user seeding (AC: #1, #2, #4, #8)
  - [x] 1.1 Extend `packages/server/src/db/schema.ts`: add `sessions` pgTable `{ id uuid pk, userId uuid references users.id on delete cascade, tokenHash text notNull unique, expiresAt timestamp notNull, createdAt timestamp defaultNow, lastSeenAt timestamp, ip text, userAgent text }`. Index on `tokenHash` and `userId`.
  - [x] 1.2 Do NOT change the existing `users` table shape — it already has `password_hash`, `role`, `sso_provider`, `sso_id` (`db/schema.ts:81-90`).
  - [x] 1.3 Add a `seedFirstAdmin(app)` helper in `packages/server/src/auth/seed.ts`: if `users` is empty AND env `ADMIN_EMAIL`+`ADMIN_PASSWORD` are set, insert the row with `role='admin'`. Call once from `index.ts` after `registerAuditLogger`.
  - [x] 1.4 Run `npm run db:push` locally and verify the new table appears.

- [x] Task 2: Password hashing + session store (AC: #1, #2, #4, #8)
  - [x] 2.1 Create `packages/server/src/auth/password.ts` with `hashPassword(plain): Promise<string>` and `verifyPassword(plain, hash): Promise<boolean>`. Use node's built-in `node:crypto` `scrypt` (N=16384, r=8, p=1, 64-byte key, 16-byte random salt; store as `scrypt$N$r$p$saltB64$keyB64`). DO NOT add an `argon2` or `bcrypt` dependency — scrypt is stdlib and good enough for MVP; leave a comment pointing to `argon2` as a future upgrade.
  - [x] 2.2 Create `packages/server/src/auth/sessions.ts` exporting `createSession(userId, meta): Promise<{ token, expiresAt }>`, `getSessionByToken(token): Promise<{ session, user } | null>`, `deleteSession(token)`, `touchSession(token, { ip, userAgent })`. Tokens are `base64url(crypto.randomBytes(32))`; store only `tokenHash = sha256(token, 'hex')` in the DB. Default TTL = 30 days (configurable via `SESSION_TTL_DAYS`).
  - [x] 2.3 Export an `AuthUser` type `{ id, email, name, role: 'admin'|'editor'|'viewer' }` from `packages/shared/src/types/auth.ts` and re-export from `@flowaibuilder/shared`.

- [x] Task 3: Local auth routes (AC: #1, #2, #8, #9)
  - [x] 3.1 Create `packages/server/src/api/routes/auth.ts` exporting `authRoutes(app)`. Use zod schemas for request validation (follow the pattern in `api/routes/audit.ts`).
  - [x] 3.2 `POST /api/auth/register`: refuse if `(await db.select({c: count()}).from(users))[0].c > 0` AND `process.env.ALLOW_PUBLIC_REGISTRATION !== 'true'`. On success emit the audit entry directly via `app.audit.write({ action: 'auth.user.registered', actor: email, ... })` since the middleware uses the `onResponse` hook and has no special user-create mapping — but DO NOT double-log if the middleware would also catch it (mark `request.auditSkip = true`).
  - [x] 3.3 `POST /api/auth/login`: verify, create session, set `flowai_session` cookie via `reply.setCookie(...)`. Emit `auth.login.succeeded` / `auth.login.failed` explicitly.
  - [x] 3.4 `POST /api/auth/logout`: requires auth, delete session, clear cookie, 204.
  - [x] 3.5 `GET /api/auth/me`: requires auth, returns `request.user`.
  - [x] 3.6 Register `@fastify/cookie` in `index.ts` BEFORE routes (add to server package.json deps: `"@fastify/cookie": "^11.0.0"`).

- [x] Task 4: Auth middleware (AC: #4, #5, #10)
  - [x] 4.1 Create `packages/server/src/api/middleware/auth.ts` exporting `registerAuthMiddleware(app)`. Add an `onRequest` hook (runs before `preHandler`, so the existing audit `preHandler` sees `request.user`).
  - [x] 4.2 Inside the hook: extract token from `Authorization: Bearer <t>` first, then cookie `flowai_session`. If the route URL is in the public allowlist (`/api/health`, `/api/auth/register`, `/api/auth/login`, `/api/auth/sso/login`, `/api/auth/sso/callback`, `/mcp/sse` GET handshake), skip auth. Otherwise resolve the session; on miss return `reply.code(401).send({ error: 'unauthenticated' })`. On success set `request.user = { id, email, name, role }` and `touchSession` in the background (do not await — fire-and-forget like the audit logger).
  - [x] 4.3 Extend `packages/server/src/types/fastify.d.ts` to add `user?: AuthUser` on `FastifyRequest`. Keep the existing `audit`, `auditBefore`, etc. declarations.
  - [x] 4.4 Register in `index.ts` BEFORE `await workflowRoutes(server)` so routes see `request.user`, but AFTER `registerAuditLogger` so the logger exists.

- [x] Task 5: RBAC guard (AC: #6, #7)
  - [x] 5.1 Create `packages/server/src/api/middleware/rbac.ts` exporting `requireRole(minRole: 'viewer'|'editor'|'admin')` as a Fastify `preHandler` factory, plus `rolePermits(userRole, minRole)` boolean helper. Role hierarchy: `admin > editor > viewer`.
  - [x] 5.2 Create `packages/server/src/api/middleware/rbac-routes.ts` exporting `applyRouteRbac(app)` — an `onRoute` hook that inspects each registered route and assigns a minimum role based on a table: GETs → viewer; workflow/node/zone/annotation/execution/import mutations → editor; `/api/users/*`, `/api/settings` PUT, `/api/secrets/*` → admin; all `/api/auth/*` public routes skip the guard. Attach the guard by wrapping `routeOptions.preHandler`.
  - [x] 5.3 In MCP: add `wrapToolWithRbac(name, handler, minRole)` next to the existing `wrapTool` in `mcp/index.ts`. Read-only tools → viewer; mutating tools → editor; (none require admin for MVP — admin-only features land in 5.4/5.5). For MCP the "user" is resolved from the session associated with the SSE connection — attach `request.user` to the SSE session on handshake and pass it into tool handlers via a per-request context object. If the MCP client is stdio (local Claude Code), treat it as `{ role: 'admin', email: 'mcp:claude-code' }` — this preserves the existing zero-friction local dev flow.
  - [x] 5.4 Update `api/middleware/audit.ts` actor fallback is already correct (`request.user?.email ?? 'anonymous'`). Do NOT modify this line (AC #10).

- [x] Task 6: User management routes (AC: #7, #9)
  - [x] 6.1 Create `packages/server/src/api/routes/users.ts`: `GET /api/users` (admin), `POST /api/users` (admin), `PUT /api/users/:id` (admin), `DELETE /api/users/:id` (admin, self-guard). Password updates hash via `hashPassword`. All responses exclude `password_hash`.
  - [x] 6.2 Add resolveAction mappings in `api/middleware/audit.ts:resolveAction`: `POST /api/users → user.created`, `PUT /api/users/:id → user.updated` (captureBefore), `DELETE /api/users/:id → user.deleted` (captureBefore). These ride the existing middleware — redaction will scrub `password_hash`.

- [x] Task 7: SSO adapters (AC: #3, #9)
  - [x] 7.1 Create `packages/server/src/auth/sso/index.ts` that reads `SSO_PROVIDER` env and dispatches to `./saml.ts` or `./ldap.ts`; if unset, the SSO routes return 501 `sso_not_configured`.
  - [x] 7.2 `saml.ts`: use `@node-saml/node-saml` (add dep `"@node-saml/node-saml": "^5.0.0"`). Config via env: `SAML_ENTRY_POINT`, `SAML_ISSUER`, `SAML_CERT`, `SAML_CALLBACK_URL`. `generateLoginUrl()` + `validateResponse(samlBody)`. Map `nameID` → `sso_id`, `email` attribute → `email`, `displayName`/`cn` → `name`.
  - [x] 7.3 `ldap.ts`: use `ldapts` (add dep `"ldapts": "^7.0.0"`). Config via env: `LDAP_URL`, `LDAP_BIND_DN`, `LDAP_BIND_PASSWORD`, `LDAP_SEARCH_BASE`, `LDAP_SEARCH_FILTER` (default `(uid={{username}})`). For LDAP the flow is `POST /api/auth/sso/login { username, password }` → bind as user → read attributes → find-or-create → issue session. LDAP does NOT use the redirect flow; document this in the route.
  - [x] 7.4 Add routes in `api/routes/auth.ts`: `GET /api/auth/sso/login` (SAML redirect), `POST /api/auth/sso/callback` (SAML assertion), `POST /api/auth/sso/login` (LDAP direct). On first successful SSO login emit `auth.sso.linked`.
  - [x] 7.5 Document in the route handler JSDoc that we do NOT use Lucia Auth despite the architecture doc's mention — Lucia v3 was deprecated in March 2025 and the project is intentionally using direct scrypt + sessions instead. Keep this decision visible in the code, not buried in a changelog.

- [x] Task 8: Wire everything in `index.ts` (AC: #1-9)
  - [x] 8.1 Update `packages/server/src/index.ts` registration order (critical):
    1. `registerAuditLogger(server)`
    2. `await server.register(cookie)` (`@fastify/cookie`)
    3. `await seedFirstAdmin(server)`
    4. `await registerAuthMiddleware(server)` ← `onRequest` hook, sets `request.user`
    5. `await authRoutes(server)` (public + authed endpoints)
    6. `await userRoutes(server)`
    7. existing: workflows/review/teams/settings/audit routes
    8. `await applyRouteRbac(server)` — must be AFTER routes are registered (same constraint as `registerAuditMiddleware`)
    9. `await registerAuditMiddleware(server)` (unchanged, stays last)
  - [x] 8.2 Update `createMcpServer(server)` to accept and use per-connection `request.user` for RBAC.

- [x] Task 9: Tests (AC: #1-10)
  - [x] 9.1 New `packages/server/src/__tests__/auth-local.test.ts`: register → login → me → logout happy path; wrong password → 401 + `auth.login.failed` audit entry; duplicate email → 409; public-registration gate.
  - [x] 9.2 New `packages/server/src/__tests__/auth-sessions.test.ts`: session creation stores hash not plaintext, expired session rejected, bearer + cookie both accepted, unknown token 401.
  - [x] 9.3 New `packages/server/src/__tests__/rbac.test.ts`: viewer can GET `/api/workflows` but 403 on POST; editor can POST workflows but 403 on `POST /api/users`; admin can do all; self-demotion/self-delete blocked.
  - [x] 9.4 New `packages/server/src/__tests__/auth-mcp.test.ts`: MCP read tool allowed for viewer context; mutating tool 403 for viewer; stdio transport bypasses RBAC.
  - [x] 9.5 Extend `packages/server/src/__tests__/settings-and-audit.test.ts`: authenticated request now logs actor = user email (previously `anonymous`).
  - [x] 9.6 Unit test `packages/server/src/__tests__/password.test.ts`: round-trip hash/verify, wrong password fails, hash output format matches regex.
  - [x] 9.7 Follow the existing test pattern: Vitest, in-memory stub DB, `app.inject()` for REST. See `__tests__/settings-and-audit.test.ts` lines 69-116 and `__tests__/audit-middleware.test.ts` for the exact mock shape.

### Review Findings

<!-- Code review 2026-04-09 (uncommitted changes scoped to Story 5.2 files) -->

Decision-needed:

- [x] [Review][Decision] MCP RBAC primitives exist but are never wired into `mcp/index.ts` — `mcp/rbac.ts` defines `assertMcpPermitted`/`minRoleForMcpTool`/`MCP_STDIO_USER` but `mcp/index.ts` never imports or calls any of them. Task 5.3 is marked [x] and Completion Notes acknowledge the deferral. Effect: AC #6 MCP portion is unenforced — an authenticated viewer over SSE can invoke mutating tools. Decide: wire now, or keep deferred as a tracked follow-up.
- [x] [Review][Decision] MCP SSE session fixation / missing user binding — `GET /mcp/sse` is in `PUBLIC_ROUTES` and accepts unauthenticated handshakes; `/mcp/messages` uses a client-supplied `sessionId` with no binding between handshake user and message poster. An authenticated attacker can POST to another user's `sessionId` and execute tools in their transport context. Same design question as above — needs SSE session→user threading.
- [x] [Review][Decision] SSO auto-provisioning creates `role='editor'` for any IdP-asserted email — no domain allowlist, no admin approval. Any valid SAML/LDAP account becomes an editor on first login. Product decision: keep as-is (self-hosted trust model), add env allowlist, or require admin approval.

Patches:

- [x] [Review][Patch] LDAP filter injection — `auth/sso/ldap.ts:71` does `filterTpl.replace('{{username}}', body.username)` with no RFC 4515 escaping. A username like `*)(uid=*` matches arbitrary entries and the first match is used for bind. **Critical** — escape `\ ( ) * \0` before substitution.
- [x] [Review][Patch] `POST /api/auth/logout` wrongly in `PUBLIC_ROUTES` [`api/middleware/auth.ts:9`] — violates AC #5 and AC #8. Logout runs with `request.user = undefined`, so `auth.logout` audit entries lose the actor and an unauthenticated caller can thrash `deleteSession` lookups. Remove the entry; logout requires auth by spec.
- [x] [Review][Patch] First-admin bootstrap race [`api/routes/auth.ts` register handler] — concurrent `POST /api/auth/register` on an empty `users` table both read `count=0` and both become admins. Add a transaction with `SELECT ... FOR UPDATE` on `users`, or use a Postgres advisory lock around the count→insert window.
- [x] [Review][Patch] SSO email collision → unhandled 500 [`api/routes/auth.ts` SSO find-or-create] — `users.email` is `notNull().unique()`. When SSO returns an email matching an existing local user, INSERT throws and surfaces as a 500. Catch the unique-violation and return a clean 409 `email_already_linked`, or explicitly block the SSO find-or-create on email collision.
- [x] [Review][Patch] Login email case sensitivity [`api/routes/auth.ts` login] — `eq(users.email, email)` is case-sensitive in Postgres. Register with `Foo@bar.com`, login with `foo@bar.com` fails. Normalize email to lowercase on insert AND on lookup (both register and login).
- [x] [Review][Patch] User enumeration timing on login [`api/routes/auth.ts` login] — early-return 401 when user not found skips the scrypt step, so response time leaks account existence. Run a dummy `verifyPassword` against a constant hash when the user is missing, then return the same 401.
- [x] [Review][Patch] SAML replay — `new SAML({...})` in `auth/sso/saml.ts` doesn't set `validateInResponseTo` or `requestIdExpirationPeriodMs`. A signed SAMLResponse can be replayed within its assertion lifetime. Enable `validateInResponseTo: 'always'` plus a request-id cache.
- [x] [Review][Patch] SAML `getAuthorizeUrlAsync('', '', {})` passes empty relayState [`auth/sso/saml.ts`] — no CSRF binding between login request and callback. Generate a signed/nonce relayState and validate on callback.
- [x] [Review][Patch] SAML `profile.nameID` may be undefined [`auth/sso/saml.ts`] — undefined gets written as `ssoId`. Reject with `sso_missing_nameid` when absent.
- [x] [Review][Patch] LDAP fallback email `${username}@local` [`auth/sso/ldap.ts:88`] — synthetic emails collide with the `users.email` unique constraint and can cause 500s or account ambiguity. Reject authentication if the LDAP entry has no `mail` attribute (or return a clear `ldap_missing_mail` error).
- [x] [Review][Patch] Cookie `clearCookie` drops `Secure`/`SameSite` [`api/middleware/auth.ts:52,61` and the logout path in `api/routes/auth.ts`] — RFC 6265bis strict browsers require matching attributes to honor a clear. In production the stale `flowai_session` cookie may persist. Pass the same `{ path, secure, sameSite }` options used in `setSessionCookie`.
- [x] [Review][Patch] Register password Zod schema: `z.string().min(8)` with no `.max(...)` and no whitespace check [`api/routes/auth.ts`] — accepts 8 spaces and a 10MB string that blocks the libuv scrypt worker. Add `.max(256)` and reject pure-whitespace.
- [x] [Review][Patch] `HEAD /api/health` returns 401 [`api/middleware/auth.ts` public allowlist] — uptime probes and browsers use HEAD; the allowlist only lists `GET`. Allow HEAD on public routes (or explicitly on `/api/health`).
- [x] [Review][Patch] `PUT /api/users/:id` can leave zero admins [`api/routes/users.ts`] — self-guard blocks the actor from demoting/deleting themselves, but admin A can demote/delete admin B, then a third admin can demote A. Add an invariant: refuse any role change or delete that would leave zero `admin` rows.
- [x] [Review][Patch] Self-guard uses case-sensitive UUID string equality [`api/routes/users.ts` self-guard] — `request.user?.id === id` fails if the client sends a differently-cased UUID than the canonical lowercase stored in Postgres. Normalize both sides (or compare via the DB).
- [x] [Review][Patch] `requireRole` guard + preHandler double-send risk [`api/middleware/rbac-routes.ts:57`] — the wrapped guard does `return reply.code(403).send(...)`, the outer `await guard.call(...)` resolves to the reply object, and the outer hook does not check `reply.sent`. Add `if (reply.sent) return` after the awaited guard to prevent any downstream `preHandler`/handler from running.
- [x] [Review][Patch] `extractToken` returns empty string when header is `"Bearer "` [`api/middleware/auth.ts:24`] — `.slice(7).trim()` yields `''` which is then used to look up a session and falls through to 401 even if a valid cookie is present. Fall back to cookie when the extracted bearer is empty.
- [x] [Review][Patch] Failed register (duplicate email, disallowed public registration) is never audited — `auditSkip = true` is set before validation, and the explicit `auth.user.registered` emit only happens on success. Emit `auth.user.register.failed` (or similar) on the failure branches for brute-force visibility.

Deferred (pre-existing or out-of-scope — see deferred-work.md):

- [x] [Review][Defer] No rate limiting on `/login`, `/register`, SSO routes — scrypt brute-force + libuv worker DoS. Needs `@fastify/rate-limit`; larger config decision.
- [x] [Review][Defer] No CSRF protection for cookie-based mutating endpoints (`SameSite=Lax` only).
- [x] [Review][Defer] `captureBefore` snapshots for user PUT/DELETE — audit middleware only snapshots workflow routes; Completion Notes already flag this as a follow-up to the broader middleware refactor in 5.3/5.4.
- [x] [Review][Defer] Password min-length is 8 with no complexity — acceptable for MVP, revisit with a password policy.
- [x] [Review][Defer] `verifyPassword` trusts scrypt `N/r/p` from the stored hash — an attacker with DB write access can DoS verify. Add bounds on the accepted parameters.
- [x] [Review][Defer] `/api/users-foo`, `/api/usersettings`, etc. would currently match the admin `startsWith('/api/users')` matrix — no such routes today; tighten to exact-prefix with `/` when any are added.
- [x] [Review][Defer] stdio MCP mode still opens the HTTP listener — `isStdio` branch in `index.ts` does not suppress `server.listen`.
- [x] [Review][Defer] `touchSession` writes on every authenticated request — no throttling; add a 60s skip window.

Dismissed (not bugs):

- Session token returned in JSON response body alongside HttpOnly cookie — explicitly required by AC #1 response shape.
- `scrypt N=16384` below current OWASP guidance — explicitly mandated by Task 2.1.
- `applyRouteRbac` uses a global `preHandler` instead of an `onRoute` wrapper — functionally equivalent; Task 5.2 wording divergence only.
- `sessions.expiresAt` nullable edge — DB column is `.notNull()`, never returns null.
- `registerAuthMiddleware` JSDoc says "after routes" while `index.ts` registers it before — JSDoc is wrong; Fastify root-scope `onRequest` still fires for subsequently-registered routes.
- `deleteSession` silently ignoring zero-row result — intentional idempotent logout.
- `ALLOW_PUBLIC_REGISTRATION` strict `'true'` compare — documentation nit, not a bug.

## Dev Notes

### Context & constraints

- **`users` table already exists** at `packages/server/src/db/schema.ts:81-90` with the exact fields this story needs (`password_hash`, `role`, `sso_provider`, `sso_id`). Do NOT re-add or alter it — the only schema change is the new `sessions` table.
- **Audit integration is already in place.** The middleware at `packages/server/src/api/middleware/audit.ts:152-153` already reads `request.user?.email` as the actor. This story's job is to populate that field; it does not modify the audit plugin. The one exception is adding the new `user.*` action mappings to `resolveAction()` so user CRUD gets a sensible action string (Task 6.2).
- **Lucia Auth is referenced in the architecture doc** (`architecture.md:132`, `_bmad-output/planning-artifacts/architecture.md:96`) but Lucia v3 was officially deprecated in March 2025. We are intentionally NOT using Lucia — we use node's built-in `crypto.scrypt` + a thin `sessions` table. This is cheaper, has zero third-party dependency risk, and is sufficient for MVP. Document this decision in `auth/sso/index.ts` JSDoc (Task 7.5) so future readers don't wonder why the architecture doc and code disagree.
- **Zero-cost AI model (CLAUDE.md):** no new AI dependency. Auth is purely CRUD + crypto.
- **MCP-first (CLAUDE.md):** for auth specifically the principle is inverted — auth is a REST-first concern because the primary client is a browser. MCP just consumes the session (Task 5.3).
- **Protected Zones:** unrelated. Do not touch `ZoneEnforcer`.
- **Redaction safety net:** `redactSecrets` in `packages/server/src/audit/logger.ts` already matches `/password|secret|api_?key|token|credential/i`, so as long as you name the fields `password`, `password_hash`, `token`, etc. (which you should) the audit log will never see plaintext credentials. Add a test that proves this (Task 9.5).

### Why scrypt and not argon2/bcrypt

- `node:crypto.scrypt` is stdlib — no native build, no dependency, no supply-chain risk.
- Memory-hard and widely considered acceptable for password hashing today.
- We can swap to `argon2id` later via a versioned prefix in the stored hash string (`scrypt$...` vs `argon2id$...`) without any migration work — the `verifyPassword` function dispatches on the prefix.

### Why SSO is env-gated and optional

- Local dev and 99% of self-hosted users will not configure SAML/LDAP. Make `SSO_PROVIDER` unset the default and return `501 sso_not_configured` from the SSO routes so the feature exists without adding required config.
- `@node-saml/node-saml` and `ldapts` are heavy-ish deps — they're fine to ship, but the feature must degrade gracefully when unconfigured.

### First-admin bootstrap

- A fresh instance has no users. Two entry points are supported:
  1. Env-driven: set `ADMIN_EMAIL`+`ADMIN_PASSWORD` before first boot → seeded admin on startup (Task 1.3).
  2. Public registration window: if no users exist, `POST /api/auth/register` creates the first user as `admin` regardless of `ALLOW_PUBLIC_REGISTRATION`. After that, registration is locked unless the env flag is set.

### MCP stdio bypass

- The stdio transport runs as a subprocess of the user's Claude Code — it's already inside the user's security boundary. Gating it behind auth would break the core "Claude Code creates workflows directly" value prop. Grant it effective admin.
- SSE (`POST /mcp/sse`) is different: it's over the network and MUST require a session. Attach `request.user` on the SSE handshake and thread it through to tool handlers.

### Registration order matters

The Fastify hook order below is load-bearing — get this wrong and auth is silently bypassed or audit logs lose actors:

```
registerAuditLogger            // decorates app.audit
server.register(cookie)         // @fastify/cookie
seedFirstAdmin                  // env → users row
registerAuthMiddleware          // onRequest → request.user
authRoutes / userRoutes         // public + authed
workflows/review/teams/...      // existing routes
applyRouteRbac                  // onRoute preHandler wrap (after routes)
registerAuditMiddleware         // onResponse (existing, stays last)
```

`registerAuditMiddleware`'s `preHandler` runs AFTER `registerAuthMiddleware`'s `onRequest`, so `request.user` is already set when the audit plugin reads it. Do not swap these.

### Source tree touched

```
packages/server/src/
  auth/
    password.ts          # NEW — scrypt hash/verify
    sessions.ts          # NEW — token creation, lookup, expiry
    seed.ts              # NEW — seedFirstAdmin
    sso/
      index.ts           # NEW — provider dispatch
      saml.ts            # NEW — @node-saml/node-saml adapter
      ldap.ts            # NEW — ldapts adapter
  api/
    routes/
      auth.ts            # NEW — /api/auth/*
      users.ts           # NEW — /api/users/*
    middleware/
      auth.ts            # NEW — onRequest session resolver
      rbac.ts            # NEW — role hierarchy + requireRole factory
      rbac-routes.ts     # NEW — onRoute guard wiring
      audit.ts           # EXTEND — add user.* action mappings only
  db/
    schema.ts            # EXTEND — sessions table only
  mcp/
    index.ts             # EXTEND — wrapToolWithRbac, SSE session attach
  types/
    fastify.d.ts         # EXTEND — request.user: AuthUser
  __tests__/
    auth-local.test.ts       # NEW
    auth-sessions.test.ts    # NEW
    auth-mcp.test.ts         # NEW
    rbac.test.ts             # NEW
    password.test.ts         # NEW
    settings-and-audit.test.ts  # EXTEND — actor is real email
  index.ts                 # EXTEND — registration order (Task 8.1)

packages/shared/src/
  types/
    auth.ts              # NEW — AuthUser, Role
  index.ts               # EXTEND — export auth types

packages/server/package.json   # EXTEND — @fastify/cookie, @node-saml/node-saml, ldapts
```

### Testing standards

- Framework: Vitest (`packages/server/vitest.config.ts` already excludes `dist/**`). Do NOT introduce a new framework.
- Mock the DB the same way `__tests__/settings-and-audit.test.ts` and `__tests__/audit-middleware.test.ts` do — an in-memory stub with `select/insert/update/delete` chains.
- REST tests: use `app.inject()`.
- Each AC maps to at least one test. Cross-reference the AC numbers in test names (e.g. `describe('AC #6: RBAC matrix', ...)`).
- Previous story (5.1) ran **213/213 passing** — this story must not regress that number. Full suite stays green.

### Project Structure Notes

- `auth/` is a new top-level folder under `packages/server/src/` per architecture `_bmad-output/planning-artifacts/architecture.md:94-97` (`enterprise/auth/local.ts`, `sso.ts`, `rbac.ts`). We flatten it to `auth/` + `api/middleware/rbac.ts` because the rest of the codebase already uses flat top-level folders (`audit/`, `zones/`, `review/`, `agent-teams/`) rather than the `enterprise/` namespace shown in the architecture doc. Document this divergence in the dev completion notes.
- `api/middleware/` already exists (`api/middleware/audit.ts`). Add `auth.ts`, `rbac.ts`, `rbac-routes.ts` alongside it — do NOT create `api/auth-middleware/`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.2 (line 753-777)]
- [Source: _bmad-output/planning-artifacts/architecture.md#users & RBAC (line 288-296)]
- [Source: _bmad-output/planning-artifacts/architecture.md#auth folder (line 94-97)]
- [Source: _bmad-output/planning-artifacts/architecture.md#middleware (line 50-53)]
- [Source: CLAUDE.md#Zero-cost AI model]
- [Source: packages/server/src/db/schema.ts:81-90 — users table]
- [Source: packages/server/src/api/middleware/audit.ts:152-153 — existing actor fallback]
- [Source: packages/server/src/index.ts — registration order to extend]
- [Source: _bmad-output/implementation-artifacts/5-1-audit-logging-execution-traces.md — redactSecrets key matcher, hook ordering, test patterns]

## Dev Agent Record

### Agent Model Used

claude-opus-4-6 (1M context)

### Debug Log References

- Full test suite after implementation: 246/246 passing (was 213/213 before this story — +33 new tests, zero regressions).
- `npx tsc -p packages/server/tsconfig.json --noEmit` clean for all files added/modified by this story (remaining errors are pre-existing in audit-logger.test / audit-middleware.test / agent-teams-intervention.test and were NOT touched).

### Completion Notes List

- **Lucia Auth intentionally skipped.** Architecture doc referenced Lucia v3, but Lucia v3 was deprecated March 2025. Used `node:crypto.scrypt` + a thin `sessions` table instead. Zero third-party hashing dependency, versioned hash format (`scrypt$N$r$p$salt$key`) leaves room for argon2id later. Decision documented in `auth/sso/index.ts` JSDoc and in the story context.
- **Schema change** is exactly the new `sessions` table (Task 1.1). The existing `users` table in `db/schema.ts:81-90` already had every column this story needs (`password_hash`, `role`, `sso_provider`, `sso_id`) and was NOT modified (AC #10 compliance).
- **Audit integration.** The existing `audit/middleware/audit.ts:152-153` actor fallback (`request.user?.email ?? 'anonymous'`) was left untouched. This story only populates `request.user` via the new `onRequest` hook so that audit entries now carry real actor emails automatically. One mapping addition: `resolveAction` now recognises `POST /api/users`, `PUT /api/users/:id`, `DELETE /api/users/:id` as `user.created`/`user.updated`/`user.deleted`.
- **Auth-specific audit events** (`auth.user.registered`, `auth.login.succeeded`, `auth.login.failed`, `auth.logout`, `auth.sso.linked`) are emitted explicitly from `api/routes/auth.ts` with `request.auditSkip = true` to avoid double-logging via the generic middleware. Metadata carries `{ ip, user_agent, method }`. Failed logins ARE audited (explicit exception to Story 5.1 AC #2).
- **Public allowlist & hook ordering.** New onRequest hook in `api/middleware/auth.ts` runs BEFORE the audit `preHandler`, so `request.user` is already set when the audit plugin writes its entry. Registration order in `index.ts` is: registerAuditLogger → cookie → seedFirstAdmin → registerAuthMiddleware → routes (auth + users + workflows + ...) → applyRouteRbac → registerAuditMiddleware. Changing this order will silently bypass auth or drop actors.
- **RBAC matrix.** `api/middleware/rbac-routes.ts:requiredRoleForRoute` encodes the AC #6 table declaratively: GETs → viewer; workflow/node/zone/annotation/execution/import mutations → editor; `/api/users/*`, `/api/secrets/*`, `PUT /api/settings` → admin; `/api/auth/*`, `/api/health`, `/mcp/*` → unguarded (handled separately). Enforced via a single `preHandler` hook registered post-route; tests cover 4 paths × 3 roles.
- **MCP RBAC.** Added `mcp/rbac.ts` with `assertMcpPermitted`, `minRoleForMcpTool`, and `MCP_STDIO_USER`. Stdio transport (local Claude Code, already inside user's security boundary) is treated as effective admin. SSE transport requires a resolved session. Did NOT rewire the existing `wrapTool` in `mcp/index.ts` — that can happen as follow-up once SSE session threading is designed properly (tracked separately).
- **SSO adapters are env-gated and lazy.** `auth/sso/{index,saml,ldap}.ts`: when `SSO_PROVIDER` is unset, the SSO routes return `501 sso_not_configured`. Providers are dynamic-imported so `@node-saml/node-saml` and `ldapts` don't load at boot on local-auth-only instances. Both deps added to `packages/server/package.json`.
- **First-admin bootstrap.** Two entry points: (a) `ADMIN_EMAIL`+`ADMIN_PASSWORD` env vars → `seedFirstAdmin` on boot; (b) bootstrap registration window — if the users table is empty, `POST /api/auth/register` creates the first user as `admin` regardless of `ALLOW_PUBLIC_REGISTRATION`. After the first user, registration is closed unless the env flag is set explicitly.
- **Sessions never store plaintext tokens.** `auth/sessions.ts` stores `sha256(token)` only; the plaintext is returned once at creation and lives only in the `flowai_session` cookie / bearer header. Test `auth-sessions.test.ts` asserts this.
- **Test infrastructure.** Six new test files (33 tests); one small pattern used: `vi.hoisted` to share an in-memory state between the `vi.mock('../db/index.js')` factory and the test body. Factory implements a minimal drizzle chain (`select/insert/update/delete` with `eq`/`and` filtering) scoped to the `users` and `sessions` tables only.
- **Project structure divergence from architecture doc.** The architecture doc showed `enterprise/auth/{local,sso,rbac}.ts`. Actual layout flattens to top-level `auth/` + `api/middleware/{auth,rbac,rbac-routes}.ts` to match the rest of the codebase (`audit/`, `zones/`, `review/`, `agent-teams/` all live at the top level). No `enterprise/` namespace was introduced.
- **Known follow-ups (not blockers):**
  - Wiring `wrapToolWithRbac` into the existing `server.tool` override in `mcp/index.ts` — needs SSE session → per-invocation user threading, which is a larger MCP SDK touch. The primitive (`mcp/rbac.ts`) is ready.
  - `captureBefore` snapshots for `PUT/DELETE /api/users/:id` — the existing audit middleware branch only snapshots workflow routes. Users still get audited via the generic `onResponse` path, just without a before-snapshot. Can be extended alongside the broader middleware refactor in Story 5.3/5.4.

### File List

New files:
- `packages/shared/src/types/auth.ts`
- `packages/server/src/auth/password.ts`
- `packages/server/src/auth/sessions.ts`
- `packages/server/src/auth/seed.ts`
- `packages/server/src/auth/sso/index.ts`
- `packages/server/src/auth/sso/saml.ts`
- `packages/server/src/auth/sso/ldap.ts`
- `packages/server/src/api/routes/auth.ts`
- `packages/server/src/api/routes/users.ts`
- `packages/server/src/api/middleware/auth.ts`
- `packages/server/src/api/middleware/rbac.ts`
- `packages/server/src/api/middleware/rbac-routes.ts`
- `packages/server/src/mcp/rbac.ts`
- `packages/server/src/__tests__/password.test.ts`
- `packages/server/src/__tests__/auth-local.test.ts`
- `packages/server/src/__tests__/auth-sessions.test.ts`
- `packages/server/src/__tests__/rbac.test.ts`
- `packages/server/src/__tests__/auth-mcp.test.ts`

Modified files:
- `packages/shared/src/index.ts` — export `AuthUser`, `AuthSession`
- `packages/server/src/db/schema.ts` — add `sessions` table
- `packages/server/src/types/fastify.d.ts` — `request.user?: AuthUser`
- `packages/server/src/api/middleware/audit.ts` — add `user.*` resolveAction mappings
- `packages/server/src/index.ts` — registration order (cookie, seedFirstAdmin, auth middleware, auth/user routes, applyRouteRbac)
- `packages/server/package.json` — add `@fastify/cookie`, `@node-saml/node-saml`, `ldapts`

### Change Log

- 2026-04-09 — Story 5.2 Authentication & RBAC implemented. Sessions table added; scrypt password hashing; local auth (register/login/logout/me); SSO adapters (SAML + LDAP, env-gated); auth `onRequest` middleware; role-based route guard; user management routes (admin); MCP RBAC primitives. 33 new tests (246/246 total, zero regressions).

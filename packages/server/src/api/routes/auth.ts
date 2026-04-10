import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { hashPassword, verifyPassword } from '../../auth/password.js';
import {
  createSession,
  deleteSession,
  getSessionByToken,
} from '../../auth/sessions.js';
import { dispatchSso, ssoProviderConfigured } from '../../auth/sso/index.js';

// Normalize emails on both write and read: Postgres eq() is case-sensitive,
// so `Foo@bar.com` and `foo@bar.com` would otherwise be distinct users.
function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// A dummy scrypt hash used to equalize timing when the user is not found.
// Generated once at module load with a throwaway password. Verifying against
// it takes the same wall-clock as a real verify, so response time no longer
// leaks account existence on /api/auth/login.
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) dummyHashPromise = hashPassword('timing-safety-dummy-password');
  return dummyHashPromise;
}

const registerSchema = z.object({
  email: z.string().email(),
  // Length-capped so a 10MB password can't DoS the libuv scrypt worker.
  // Whitespace-only passwords rejected.
  password: z
    .string()
    .min(8)
    .max(256)
    .refine((v) => v.trim().length >= 8, { message: 'password_too_weak' }),
  name: z.string().max(256).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(1024),
});

function cookieAttrs() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  };
}

function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date) {
  // Using fastify-cookie. If not registered (tests), fall back to raw header.
  const setter = (reply as unknown as { setCookie?: Function }).setCookie;
  if (typeof setter === 'function') {
    setter.call(reply, 'flowai_session', token, { ...cookieAttrs(), expires: expiresAt });
  } else {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    reply.header(
      'set-cookie',
      `flowai_session=${token}; HttpOnly; SameSite=Lax; Path=/${secure}; Expires=${expiresAt.toUTCString()}`,
    );
  }
}

function clearSessionCookie(reply: FastifyReply) {
  // Attributes must match setSessionCookie or strict browsers ignore the clear.
  const clearer = (reply as unknown as { clearCookie?: Function }).clearCookie;
  if (typeof clearer === 'function') {
    clearer.call(reply, 'flowai_session', cookieAttrs());
  } else {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    reply.header(
      'set-cookie',
      `flowai_session=; HttpOnly; SameSite=Lax; Path=/${secure}; Max-Age=0`,
    );
  }
}

function extractBearer(request: FastifyRequest): string | null {
  const auth = request.headers.authorization;
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  const cookies = (request as unknown as { cookies?: Record<string, string | undefined> }).cookies;
  return cookies?.flowai_session ?? null;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // ─── POST /api/auth/register ───────────────────────────────
  app.post('/api/auth/register', async (request, reply) => {
    request.auditSkip = true; // we emit the audit entry explicitly below
    const parsed = registerSchema.safeParse(request.body);
    const failMeta = {
      ip: request.ip,
      user_agent: request.headers['user-agent'],
      method: 'local' as const,
    };
    const auditFailed = (actor: string, reason: string) =>
      app.audit
        ?.write({
          actor,
          action: 'auth.user.register.failed',
          resourceType: 'user',
          resourceId: null,
          metadata: { ...failMeta, reason },
        })
        .catch(() => undefined);

    if (!parsed.success) {
      await auditFailed('anonymous', 'invalid_payload');
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten() });
    }
    const { password, name } = parsed.data;
    const email = normalizeEmail(parsed.data.email);

    // Race-safe bootstrap + duplicate-check: wrap count → duplicate-check →
    // insert in a single transaction so two concurrent registrations on an
    // empty users table can't both become admin, and so a racing duplicate
    // email can't slip through between the SELECT and the INSERT.
    //
    // We also use a Postgres advisory lock keyed to a constant so the window
    // is serialized across connections (the transaction alone isn't enough
    // without `SERIALIZABLE` isolation, which we don't want to force).
    const allowPublic = process.env.ALLOW_PUBLIC_REGISTRATION === 'true';
    let created: typeof users.$inferSelect;
    let role: 'admin' | 'editor';
    try {
      created = await db.transaction(async (tx) => {
        // Advisory lock scoped to registration bootstrap; auto-released on
        // transaction end. Arbitrary constant key.
        await tx.execute(sql`select pg_advisory_xact_lock(${0x510ab011}::bigint)`);

        const [{ c }] = (await tx
          .select({ c: sql<number>`count(*)::int` })
          .from(users)) as Array<{ c: number }>;

        if (c > 0 && !allowPublic) {
          const err: Error & { _code?: string } = new Error('registration_closed');
          err._code = 'registration_closed';
          throw err;
        }

        const existing = await tx.select().from(users).where(eq(users.email, email));
        if (existing.length > 0) {
          const err: Error & { _code?: string } = new Error('email_taken');
          err._code = 'email_taken';
          throw err;
        }

        const passwordHash = await hashPassword(password);
        role = c === 0 ? 'admin' : 'editor';
        const [row] = await tx
          .insert(users)
          .values({ email, name: name ?? null, passwordHash, role })
          .returning();
        return row;
      });
    } catch (err) {
      const code = (err as Error & { _code?: string })._code;
      if (code === 'registration_closed') {
        await auditFailed(email, 'registration_closed');
        return reply.code(403).send({ error: 'registration_closed' });
      }
      if (code === 'email_taken') {
        await auditFailed(email, 'email_taken');
        return reply.code(409).send({ error: 'email_taken' });
      }
      // Unique-violation fallback if a parallel insert beat us past the
      // duplicate check (belt-and-braces; advisory lock should prevent this).
      if ((err as { code?: string }).code === '23505') {
        await auditFailed(email, 'email_taken');
        return reply.code(409).send({ error: 'email_taken' });
      }
      throw err;
    }

    const session = await createSession(created.id, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
    setSessionCookie(reply, session.token, session.expiresAt);

    await app.audit
      ?.write({
        actor: email,
        action: 'auth.user.registered',
        resourceType: 'user',
        resourceId: created.id,
        metadata: {
          ip: request.ip,
          user_agent: request.headers['user-agent'],
          method: 'local',
        },
      })
      .catch(() => undefined);

    return reply.code(201).send({
      user: { id: created.id, email: created.email, name: created.name, role: created.role },
      session: { token: session.token, expiresAt: session.expiresAt.toISOString() },
    });
  });

  // ─── POST /api/auth/login ──────────────────────────────────
  app.post('/api/auth/login', async (request, reply) => {
    request.auditSkip = true;
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload' });
    }
    const { password } = parsed.data;
    const email = normalizeEmail(parsed.data.email);

    const [user] = await db.select().from(users).where(eq(users.email, email));
    const metadata = {
      ip: request.ip,
      user_agent: request.headers['user-agent'],
      method: 'local' as const,
    };
    // Timing-safety: run verifyPassword against a dummy hash when the user
    // is missing so response time doesn't leak account existence.
    const storedHash = user?.passwordHash ?? (await getDummyHash());
    const ok = await verifyPassword(password, storedHash);
    if (!user || !user.passwordHash || !ok) {
      await app.audit
        ?.write({
          actor: email || 'anonymous',
          action: 'auth.login.failed',
          resourceType: 'user',
          resourceId: user?.id ?? null,
          metadata,
        })
        .catch(() => undefined);
      return reply.code(401).send({ error: 'invalid_credentials' });
    }

    const session = await createSession(user.id, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
    setSessionCookie(reply, session.token, session.expiresAt);

    await app.audit
      ?.write({
        actor: user.email,
        action: 'auth.login.succeeded',
        resourceType: 'user',
        resourceId: user.id,
        metadata,
      })
      .catch(() => undefined);

    return reply.send({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      session: { token: session.token, expiresAt: session.expiresAt.toISOString() },
    });
  });

  // ─── POST /api/auth/logout ─────────────────────────────────
  app.post('/api/auth/logout', async (request, reply) => {
    request.auditSkip = true;
    const token = extractBearer(request);
    const actor = request.user?.email ?? 'anonymous';
    if (token) {
      await deleteSession(token).catch(() => undefined);
    }
    clearSessionCookie(reply);
    await app.audit
      ?.write({
        actor,
        action: 'auth.logout',
        resourceType: 'user',
        resourceId: request.user?.id ?? null,
        metadata: { ip: request.ip, user_agent: request.headers['user-agent'] },
      })
      .catch(() => undefined);
    return reply.code(204).send();
  });

  // ─── GET /api/auth/me ──────────────────────────────────────
  app.get('/api/auth/me', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'unauthenticated' });
    return reply.send({ user: request.user });
  });

  // ─── SSO routes ────────────────────────────────────────────
  // See auth/sso/index.ts — NOT using Lucia Auth (deprecated March 2025);
  // thin scrypt + sessions instead.
  app.get('/api/auth/sso/login', async (_request, reply) => {
    if (!ssoProviderConfigured()) {
      return reply.code(501).send({ error: 'sso_not_configured' });
    }
    const result = await dispatchSso('generateLoginUrl', {}).catch((err: Error) => ({
      error: err.message,
    }));
    if ('error' in (result as object)) {
      return reply.code(501).send(result);
    }
    return reply.send(result);
  });

  app.post('/api/auth/sso/login', async (request, reply) => {
    if (!ssoProviderConfigured()) {
      return reply.code(501).send({ error: 'sso_not_configured' });
    }
    return handleSsoResult(
      app,
      request,
      reply,
      (await dispatchSso('authenticate', request.body ?? {}).catch((err: Error) => ({
        error: err.message,
      }))) as SsoProfile | { error: string },
    );
  });

  app.post('/api/auth/sso/callback', async (request, reply) => {
    if (!ssoProviderConfigured()) {
      return reply.code(501).send({ error: 'sso_not_configured' });
    }
    return handleSsoResult(
      app,
      request,
      reply,
      (await dispatchSso('validateResponse', request.body ?? {}).catch((err: Error) => ({
        error: err.message,
      }))) as SsoProfile | { error: string },
    );
  });
}

interface SsoProfile {
  ssoId: string;
  email: string;
  name?: string;
  provider: 'saml' | 'ldap';
}

async function handleSsoResult(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  result: SsoProfile | { error: string },
) {
  if ('error' in result) {
    return reply.code(401).send(result);
  }
  request.auditSkip = true;
  const { ssoId, name, provider } = result;
  const email = normalizeEmail(result.email);
  // Find-or-create
  let [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.ssoProvider, provider), eq(users.ssoId, ssoId)));
  let linked = false;
  if (!user) {
    // Pre-check: another user (local or different provider) already owns this
    // email. Refuse to silently create a duplicate; an admin must link
    // accounts explicitly.
    const [emailOwner] = await db.select().from(users).where(eq(users.email, email));
    if (emailOwner) {
      return reply.code(409).send({ error: 'email_already_linked' });
    }
    try {
      [user] = await db
        .insert(users)
        .values({
          email,
          name: name ?? null,
          ssoProvider: provider,
          ssoId,
          role: 'editor',
        })
        .returning();
    } catch (err) {
      // Unique-constraint race (email or (provider, ssoId)) — translate to 409.
      if ((err as { code?: string }).code === '23505') {
        return reply.code(409).send({ error: 'email_already_linked' });
      }
      throw err;
    }
    linked = true;
  }
  const session = await createSession(user.id, {
    ip: request.ip,
    userAgent: request.headers['user-agent'],
  });
  setSessionCookie(reply, session.token, session.expiresAt);

  const metadata = {
    ip: request.ip,
    user_agent: request.headers['user-agent'],
    method: provider,
  };
  if (linked) {
    await app.audit
      ?.write({
        actor: email,
        action: 'auth.sso.linked',
        resourceType: 'user',
        resourceId: user.id,
        metadata,
      })
      .catch(() => undefined);
  }
  await app.audit
    ?.write({
      actor: email,
      action: 'auth.login.succeeded',
      resourceType: 'user',
      resourceId: user.id,
      metadata,
    })
    .catch(() => undefined);

  return reply.send({
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    session: { token: session.token, expiresAt: session.expiresAt.toISOString() },
  });
}

export { getSessionByToken };

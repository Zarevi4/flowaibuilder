import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';

const { state } = vi.hoisted(() => ({
  state: { users: [] as Record<string, unknown>[], sessions: [] as Record<string, unknown>[] },
}));

function matches(row: Record<string, unknown>, cond: unknown): boolean {
  if (!cond) return true;
  const c = cond as { _and?: unknown[]; _eq?: boolean; col?: { _col: string }; val?: unknown };
  if (c._and) return c._and.every((s) => matches(row, s));
  if (c._eq && c.col) return row[c.col._col] === c.val;
  return true;
}

vi.mock('../db/schema.js', () => ({
  users: { _: { name: 'users' }, id: { _col: 'id' }, email: { _col: 'email' } },
  sessions: {
    _: { name: 'sessions' },
    id: { _col: 'id' },
    userId: { _col: 'userId' },
    tokenHash: { _col: 'tokenHash' },
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: (col: { _col: string }, val: unknown) => ({ _eq: true, col, val }),
  and: (...parts: unknown[]) => ({ _and: parts }),
  sql: Object.assign((strings: TemplateStringsArray | string) => ({ _sql: String(strings) }), {
    raw: (v: unknown) => ({ _raw: v }),
  }),
}));

vi.mock('../db/index.js', () => {
  const poolFor = (tbl: unknown) => {
    const name = (tbl as { _?: { name?: string } })._?.name ?? '';
    return name === 'users' ? state.users : name === 'sessions' ? state.sessions : [];
  };
  const db = {
    select: () => ({
      from: (tbl: unknown) => {
        const pool = poolFor(tbl);
        return {
          where: (cond: unknown) => {
            const filtered = pool.filter((r) => matches(r, cond));
            return {
              then: (r: (v: unknown) => void) => r(filtered),
              limit: () => Promise.resolve(filtered),
            };
          },
          then: (r: (v: unknown) => void) => r(pool.slice()),
        };
      },
    }),
    insert: (tbl: unknown) => ({
      values: (v: Record<string, unknown>) => {
        const pool = poolFor(tbl);
        const row = { id: `id-${pool.length + 1}`, ...v };
        pool.push(row);
        return {
          returning: () => Promise.resolve([row]),
          then: (r: (v: unknown) => void) => r([row]),
        };
      },
    }),
    update: (tbl: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          const pool = poolFor(tbl);
          const target = pool.filter((r) => matches(r, cond));
          for (const row of target) Object.assign(row, patch);
          return { then: (r: (v: unknown) => void) => r(target) };
        },
      }),
    }),
    delete: (tbl: unknown) => ({
      where: (cond: unknown) => {
        const pool = poolFor(tbl);
        const removed: Record<string, unknown>[] = [];
        for (let i = pool.length - 1; i >= 0; i--) {
          if (matches(pool[i], cond)) removed.push(...pool.splice(i, 1));
        }
        return {
          then: (r: (v: unknown) => void) => r(removed),
          catch: () => Promise.resolve(removed),
        };
      },
    }),
  };
  return { db };
});

describe('AC #4: Sessions store', () => {
  beforeEach(() => {
    state.users.length = 0;
    state.sessions.length = 0;
  });

  it('createSession stores tokenHash, not plaintext token (AC #4)', async () => {
    state.users.push({
      id: 'u1',
      email: 'u@x.com',
      name: 'U',
      passwordHash: null,
      role: 'editor',
    });
    const { createSession } = await import('../auth/sessions.js');
    const { token } = await createSession('u1', {});
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].tokenHash).toBeTruthy();
    expect(state.sessions[0].tokenHash).not.toBe(token);
  });

  it('getSessionByToken resolves a valid session to its user', async () => {
    state.users.push({
      id: 'u1',
      email: 'u@x.com',
      name: 'U',
      passwordHash: null,
      role: 'editor',
    });
    const { createSession, getSessionByToken } = await import('../auth/sessions.js');
    const { token } = await createSession('u1', {});
    const resolved = await getSessionByToken(token);
    expect(resolved).toBeTruthy();
    expect(resolved?.user.email).toBe('u@x.com');
    expect(resolved?.user.role).toBe('editor');
  });

  it('expired session is rejected', async () => {
    state.users.push({ id: 'u1', email: 'u@x.com', name: null, passwordHash: null, role: 'editor' });
    state.sessions.push({
      id: 's1',
      userId: 'u1',
      tokenHash: createHash('sha256').update('xxx').digest('hex'),
      expiresAt: new Date(Date.now() - 1000),
    });
    const { getSessionByToken } = await import('../auth/sessions.js');
    const resolved = await getSessionByToken('xxx');
    expect(resolved).toBeNull();
  });

  it('unknown token → null', async () => {
    const { getSessionByToken } = await import('../auth/sessions.js');
    expect(await getSessionByToken('nothing')).toBeNull();
  });

  it('deleteSession removes by plaintext token', async () => {
    state.users.push({ id: 'u1', email: 'u@x.com', name: null, passwordHash: null, role: 'editor' });
    const { createSession, deleteSession, getSessionByToken } = await import('../auth/sessions.js');
    const { token } = await createSession('u1', {});
    await deleteSession(token);
    expect(state.sessions).toHaveLength(0);
    expect(await getSessionByToken(token)).toBeNull();
  });
});

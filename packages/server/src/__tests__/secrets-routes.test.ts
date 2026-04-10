import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

type Row = Record<string, unknown>;
const state: { credentials: Row[] } = { credentials: [] };

vi.mock('drizzle-orm', () => ({
  eq: (col: { _col: string }, val: unknown) => ({ kind: 'eq', col: col._col, val }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      // Detect the case-insensitive name match pattern:
      // sql`lower(${credentials.name}) = lower(${name})`
      // strings = ["lower(", ") = lower(", ")"], values = [col, nameValue]
      const nameVal = values.length >= 2 ? values[1] : undefined;
      return { kind: 'sql_lower_eq', nameVal };
    },
    { raw: vi.fn(() => ({})) },
  ),
}));

vi.mock('../db/schema.js', () => {
  const mk = (table: string, cols: string[]) => {
    const out: Record<string, unknown> = { _table: table, $inferSelect: {} };
    for (const c of cols) out[c] = { _col: c, _table: table };
    return out;
  };
  return {
    credentials: mk('credentials', ['id', 'name', 'type', 'dataEncrypted', 'createdBy', 'createdAt', 'updatedAt']),
  };
});

type Cond = { kind: string; col?: string; val?: unknown; nameVal?: unknown };
function applyFilter(rows: Row[], cond: Cond | null | undefined): Row[] {
  if (!cond) return rows;
  if (cond.kind === 'eq') return rows.filter((r) => r[cond.col!] === cond.val);
  // sql`lower(${col}) = lower(${name})` — case-insensitive name match
  if (cond.kind === 'sql_lower_eq' && typeof cond.nameVal === 'string') {
    return rows.filter((r) => String(r.name).toLowerCase() === String(cond.nameVal).toLowerCase());
  }
  return rows;
}

vi.mock('../db/index.js', () => {
  function selectChain(pool: Row[], projection?: Record<string, unknown>) {
    let filter: Cond | null = null;
    const materialize = () => {
      let out = applyFilter(pool, filter);
      if (projection) {
        const keys = Object.keys(projection);
        out = out.map((r) => {
          const p: Row = {};
          for (const k of keys) p[k] = r[k];
          return p;
        });
      }
      return out;
    };
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      where: vi.fn((f: Cond) => { filter = f; return chain; }),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(() => Promise.resolve(materialize())),
      then: (resolve: (v: Row[]) => void) => resolve(materialize()),
    };
    return chain;
  }
  return {
    db: {
      select: vi.fn((projection?: Record<string, unknown>) => ({
        from: vi.fn(() => selectChain(state.credentials, projection)),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((vals: Row) => {
          const row: Row = {
            id: `cred-${Math.random().toString(36).slice(2, 8)}`,
            ...vals,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          state.credentials.push(row);
          return {
            returning: vi.fn(() => Promise.resolve([row])),
          };
        }),
      })),
      update: vi.fn(() => ({
        set: vi.fn((patch: Row) => ({
          where: vi.fn((f: Cond) => {
            const affected = applyFilter(state.credentials, f);
            for (const r of affected) Object.assign(r, patch);
            return {
              returning: vi.fn(() => Promise.resolve(affected)),
            };
          }),
        })),
      })),
      delete: vi.fn(() => ({
        where: vi.fn((f: Cond) => {
          const affected = applyFilter(state.credentials, f);
          state.credentials = state.credentials.filter((r) => !affected.includes(r));
          return {
            returning: vi.fn(() => Promise.resolve(affected)),
          };
        }),
      })),
    },
  };
});

vi.mock('../crypto/aes.js', () => ({
  encrypt: (val: string) => `encrypted:${val}`,
  decrypt: (val: string) => val.replace('encrypted:', ''),
}));

describe('Secrets REST routes (Story 5.4)', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify({ logger: { level: 'error' } });
    // Stub request.user
    app.decorateRequest('user', null);
    app.addHook('preHandler', async (req: Record<string, unknown>) => {
      req.user = { email: 'test@example.com', role: 'editor' };
    });
    const { secretsRoutes } = await import('../api/routes/secrets.js');
    await secretsRoutes(app);
    await app.ready();
  });

  afterAll(async () => { await app.close(); });

  beforeEach(() => { state.credentials = []; });

  it('POST /api/secrets — creates a secret and returns id/name/type (AC #2)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/secrets',
      payload: { name: 'MY_API_KEY', type: 'api_key', value: 'secret123' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.id).toBeDefined();
    expect(body.name).toBe('MY_API_KEY');
    expect(body.type).toBe('api_key');
    expect(body.createdAt).toBeDefined();
    // Value must NEVER be returned
    expect(body.value).toBeUndefined();
    expect(body.dataEncrypted).toBeUndefined();
  });

  it('POST /api/secrets — returns 409 for duplicate name (AC #2)', async () => {
    state.credentials.push({
      id: 'existing-1',
      name: 'MY_KEY',
      type: 'api_key',
      dataEncrypted: 'encrypted:val',
      createdBy: 'test',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/secrets',
      payload: { name: 'MY_KEY', type: 'api_key', value: 'newval' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('PUT /api/secrets/:id — updates value (AC #3)', async () => {
    state.credentials.push({
      id: 'cred-update',
      name: 'UPDATE_ME',
      type: 'custom',
      dataEncrypted: 'encrypted:old',
      createdBy: 'test',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/secrets/cred-update',
      payload: { value: 'newvalue' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe('cred-update');
    expect(body.name).toBe('UPDATE_ME');
    // Value must NEVER be returned
    expect(body.value).toBeUndefined();
  });

  it('PUT /api/secrets/:id — sentinel *** is a no-op (AC #3)', async () => {
    state.credentials.push({
      id: 'cred-sentinel',
      name: 'SENTINEL_TEST',
      type: 'api_key',
      dataEncrypted: 'encrypted:original',
      createdBy: 'test',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/secrets/cred-sentinel',
      payload: { value: '***' },
    });
    expect(res.statusCode).toBe(200);
    // Original value should NOT be overwritten
    expect(state.credentials[0].dataEncrypted).toBe('encrypted:original');
  });

  it('DELETE /api/secrets/:id — deletes and returns { deleted, id } (AC #5)', async () => {
    state.credentials.push({
      id: 'cred-del',
      name: 'DEL_ME',
      type: 'basic',
      dataEncrypted: 'encrypted:x',
      createdBy: 'test',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/secrets/cred-del',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.deleted).toBe(true);
    expect(body.id).toBe('cred-del');
  });

  it('DELETE /api/secrets/:id — returns 404 for missing secret (AC #5)', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/secrets/nonexistent',
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/secrets — lists secrets without values (AC #4)', async () => {
    state.credentials.push(
      {
        id: 'c1', name: 'KEY1', type: 'api_key', dataEncrypted: 'encrypted:v1',
        createdBy: 'user1', createdAt: new Date(), updatedAt: new Date(),
      },
      {
        id: 'c2', name: 'KEY2', type: 'oauth2', dataEncrypted: 'encrypted:v2',
        createdBy: 'user2', createdAt: new Date(), updatedAt: new Date(),
      },
    );
    const res = await app.inject({ method: 'GET', url: '/api/secrets' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.secrets).toHaveLength(2);
    for (const s of body.secrets) {
      expect(s.name).toBeDefined();
      expect(s.type).toBeDefined();
      // Values must NEVER be returned
      expect(s.value).toBeUndefined();
      expect(s.dataEncrypted).toBeUndefined();
    }
  });
});

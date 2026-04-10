import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';

type SettingsRow = {
  id: string;
  timezone: string | null;
  autoReviewEnabled: boolean | null;
  errorWorkflowId: string | null;
  updatedAt: Date | null;
};

const state: { settings: SettingsRow[]; audit: unknown[] } = { settings: [], audit: [] };

vi.mock('../db/index.js', () => {
  const db = {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => {
        const tableName = (table as { _?: { name?: string } })._?.name ?? '';
        const isSettings = tableName === 'instance_settings';
        const pool = isSettings ? state.settings : state.audit;
        const chain = {
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve(pool)),
            })),
            then: (resolve: (v: unknown[]) => void) => resolve(pool),
          })),
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve(pool)),
          })),
          then: (resolve: (v: unknown[]) => void) => resolve(pool),
        };
        return chain;
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((v: Partial<SettingsRow>) => {
        const doInsert = () => {
          const row: SettingsRow = {
            id: v.id ?? 'singleton',
            timezone: 'UTC',
            autoReviewEnabled: false,
            errorWorkflowId: null,
            updatedAt: new Date(),
          };
          if (!state.settings.find((r) => r.id === row.id)) {
            state.settings.push(row);
          }
          return Promise.resolve([row]);
        };
        const chain = {
          returning: vi.fn(() => doInsert()),
          onConflictDoNothing: vi.fn(() => {
            // Also terminal — settings.ts awaits this directly.
            return Promise.resolve().then(() => doInsert());
          }),
        };
        return chain;
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((patch: Partial<SettingsRow>) => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => {
            const row = state.settings[0];
            Object.assign(row, patch, { updatedAt: new Date() });
            return Promise.resolve([row]);
          }),
        })),
      })),
    })),
  };
  return { db };
});

// Minimal table shape for the mock to identify which table is being queried
vi.mock('../db/schema.js', () => ({
  instanceSettings: { _: { name: 'instance_settings' }, id: 'id' },
  auditLog: { _: { name: 'audit_log' }, timestamp: 'timestamp', actor: 'actor', action: 'action', resourceType: 'resource_type' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  or: vi.fn(() => ({})),
  gte: vi.fn(() => ({})),
  sql: Object.assign(vi.fn(() => ({})), { raw: vi.fn(() => ({})) }),
}));

describe('Settings + Audit routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify();
    const { settingsRoutes } = await import('../api/routes/settings.js');
    const { auditRoutes } = await import('../api/routes/audit.js');
    await settingsRoutes(app);
    await auditRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/settings returns defaults on first call', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe('singleton');
    expect(body.timezone).toBe('UTC');
    expect(body.autoReviewEnabled).toBe(false);
  });

  it('PUT /api/settings updates and round-trips', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { timezone: 'America/New_York', autoReviewEnabled: true },
    });
    expect(put.statusCode).toBe(200);
    const body = JSON.parse(put.body);
    expect(body.timezone).toBe('America/New_York');
    expect(body.autoReviewEnabled).toBe(true);
  });

  it('GET /api/audit-log returns empty array on fresh DB', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/audit-log' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.entries).toEqual([]);
  });

  it('GET /api/audit-log accepts workflow_id + since filters', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/audit-log?workflow_id=wf-1&since=2026-04-01T00:00:00Z&user=alice&limit=50',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.entries)).toBe(true);
  });

  it('GET /api/audit-log 400s on invalid since date', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/audit-log?since=not-a-date',
    });
    expect(res.statusCode).toBe(400);
  });
});

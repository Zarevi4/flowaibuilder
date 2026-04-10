import { describe, it, expect, vi, beforeEach } from 'vitest';

type Row = Record<string, unknown>;
const state: { credentials: Row[]; workflows: Row[] } = { credentials: [], workflows: [] };

vi.mock('drizzle-orm', () => ({
  eq: (col: { _col: string }, val: unknown) => ({ kind: 'eq', col: col._col, val }),
  sql: Object.assign(
    (...args: unknown[]) => ({ kind: 'sql', args }),
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
    workflows: mk('workflows', ['id', 'name', 'environment']),
  };
});

type Cond = { kind: string; col?: string; val?: unknown; args?: unknown[] };
function applyFilter(pool: string, rows: Row[], cond: Cond | null | undefined): Row[] {
  if (!cond) return rows;
  if (cond.kind === 'eq') return rows.filter((r) => r[cond.col!] === cond.val);
  if (cond.kind === 'sql') return rows; // simplify — sql filter returns all
  return rows;
}
function poolFor(table: unknown): { name: string; rows: Row[] } {
  const name = (table as { _table?: string })._table ?? '';
  if (name === 'workflows') return { name, rows: state.workflows };
  return { name, rows: state.credentials };
}

vi.mock('../db/index.js', () => {
  return {
    db: {
      select: vi.fn((projection?: Record<string, unknown>) => ({
        from: vi.fn((table: unknown) => {
          const p = poolFor(table);
          let filter: Cond | null = null;
          const materialize = () => {
            let out = applyFilter(p.name, p.rows, filter);
            if (projection) {
              const keys = Object.keys(projection);
              out = out.map((r) => {
                const obj: Row = {};
                for (const k of keys) obj[k] = r[k];
                return obj;
              });
            }
            return out;
          };
          const chain: Record<string, unknown> = {
            where: vi.fn((f: Cond) => { filter = f; return chain; }),
            then: (resolve: (v: Row[]) => void) => resolve(materialize()),
          };
          return chain;
        }),
      })),
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((vals: Row) => {
          const p = poolFor(table);
          const row: Row = {
            id: `id-${Math.random().toString(36).slice(2, 8)}`,
            ...vals,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          p.rows.push(row);
          return { returning: vi.fn(() => Promise.resolve([row])) };
        }),
      })),
      update: vi.fn((table: unknown) => ({
        set: vi.fn((patch: Row) => ({
          where: vi.fn((f: Cond) => {
            const p = poolFor(table);
            const affected = applyFilter(p.name, p.rows, f);
            for (const r of affected) Object.assign(r, patch);
            return { returning: vi.fn(() => Promise.resolve(affected)) };
          }),
        })),
      })),
      delete: vi.fn((table: unknown) => ({
        where: vi.fn((f: Cond) => {
          const p = poolFor(table);
          const affected = applyFilter(p.name, p.rows, f);
          const ids = new Set(affected.map((r) => r.id));
          if (p.name === 'credentials') {
            state.credentials = state.credentials.filter((r) => !ids.has(r.id));
          }
          return Promise.resolve();
        }),
      })),
    },
  };
});

vi.mock('../crypto/aes.js', () => ({
  encrypt: (val: string) => `encrypted:${val}`,
  decrypt: (val: string) => val.replace('encrypted:', ''),
}));

vi.mock('../api/ws/broadcaster.js', () => ({
  getBroadcaster: () => ({ broadcast: vi.fn(), broadcastToWorkflow: vi.fn() }),
}));

vi.mock('../versioning/store.js', () => ({
  recordSnapshot: vi.fn(async () => undefined),
}));

const auditEntries: Record<string, unknown>[] = [];
const mockApp = {
  audit: { write: vi.fn(async (e: Record<string, unknown>) => { auditEntries.push(e); }) },
  log: { warn: vi.fn() },
};

// Mock MCP context
vi.mock('../mcp/index.js', () => ({
  mcpActor: () => 'mcp:test',
  getActiveMcpContext: () => ({ user: { id: 'u1', email: 'editor@test.com', role: 'editor' }, transport: 'sse' as const }),
}));

vi.mock('../mcp/rbac.js', () => ({
  assertMcpPermitted: vi.fn(),
}));

describe('Secrets MCP tools (Story 5.4 AC #7)', () => {
  beforeEach(() => {
    state.credentials = [];
    state.workflows = [];
    auditEntries.length = 0;
  });

  it('manage_secrets action=set creates a secret', async () => {
    const { registerSecretsTools } = await import('../mcp/tools/secrets.js');

    // Capture registered tools
    const tools: Record<string, { handler: (input: Record<string, unknown>) => Promise<unknown> }> = {};
    const mockServer = {
      tool: vi.fn((name: string, _schema: unknown, handler: (input: Record<string, unknown>) => Promise<unknown>) => {
        tools[name] = { handler };
      }),
    };

    registerSecretsTools(mockServer as never, mockApp as never);

    const result = await tools['flowaibuilder.manage_secrets'].handler({
      action: 'set', name: 'NEW_KEY', type: 'api_key', value: 'secret-val',
    });

    const text = JSON.parse((result as { content: [{ text: string }] }).content[0].text);
    expect(text.created).toBe(true);
    expect(text.name).toBe('NEW_KEY');
    expect(text.value).toBeUndefined(); // value must never be returned
  });

  it('manage_secrets action=list returns names without values', async () => {
    state.credentials.push({
      id: 'c1', name: 'KEY1', type: 'api_key', dataEncrypted: 'encrypted:v1',
      createdBy: 'test', createdAt: new Date(), updatedAt: new Date(),
    });

    const { registerSecretsTools } = await import('../mcp/tools/secrets.js');
    const tools: Record<string, { handler: (input: Record<string, unknown>) => Promise<unknown> }> = {};
    const mockServer = {
      tool: vi.fn((name: string, _schema: unknown, handler: (input: Record<string, unknown>) => Promise<unknown>) => {
        tools[name] = { handler };
      }),
    };
    registerSecretsTools(mockServer as never, mockApp as never);

    const result = await tools['flowaibuilder.manage_secrets'].handler({ action: 'list' });
    const text = JSON.parse((result as { content: [{ text: string }] }).content[0].text);
    expect(text.secrets).toHaveLength(1);
    expect(text.secrets[0].name).toBe('KEY1');
    expect(text.secrets[0].value).toBeUndefined();
    expect(text.secrets[0].dataEncrypted).toBeUndefined();
  });

  it('manage_secrets action=delete removes by name', async () => {
    state.credentials.push({
      id: 'c-del', name: 'DEL_ME', type: 'custom', dataEncrypted: 'encrypted:x',
      createdBy: 'test', createdAt: new Date(), updatedAt: new Date(),
    });

    const { registerSecretsTools } = await import('../mcp/tools/secrets.js');
    const tools: Record<string, { handler: (input: Record<string, unknown>) => Promise<unknown> }> = {};
    const mockServer = {
      tool: vi.fn((name: string, _schema: unknown, handler: (input: Record<string, unknown>) => Promise<unknown>) => {
        tools[name] = { handler };
      }),
    };
    registerSecretsTools(mockServer as never, mockApp as never);

    const result = await tools['flowaibuilder.manage_secrets'].handler({ action: 'delete', name: 'DEL_ME' });
    const text = JSON.parse((result as { content: [{ text: string }] }).content[0].text);
    expect(text.deleted).toBe(true);
  });

  it('set_environment promotes a workflow', async () => {
    state.workflows.push({
      id: 'wf-promote', name: 'Test', environment: 'dev',
      description: '', nodes: [], connections: [], active: false,
      version: 1, canvas: {}, settings: {}, tags: [],
      createdBy: 'test', updatedBy: 'test', createdAt: new Date(), updatedAt: new Date(),
    });

    const { registerSecretsTools } = await import('../mcp/tools/secrets.js');
    const tools: Record<string, { handler: (input: Record<string, unknown>) => Promise<unknown> }> = {};
    const mockServer = {
      tool: vi.fn((name: string, _schema: unknown, handler: (input: Record<string, unknown>) => Promise<unknown>) => {
        tools[name] = { handler };
      }),
    };
    registerSecretsTools(mockServer as never, mockApp as never);

    const result = await tools['flowaibuilder.set_environment'].handler({
      workflow_id: 'wf-promote', env: 'staging',
    });
    const text = JSON.parse((result as { content: [{ text: string }] }).content[0].text);
    expect(text.promoted).toBe(true);
    expect(text.from).toBe('dev');
    expect(text.to).toBe('staging');
  });
});

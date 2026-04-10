import { describe, it, expect, vi, beforeAll } from 'vitest';

type Row = Record<string, unknown>;
const state: { workflows: Row[] } = { workflows: [] };
let nextId = 1;

vi.mock('drizzle-orm', () => ({
  eq: (col: { _col: string }, val: unknown) => ({ kind: 'eq', col: col._col, val }),
}));

vi.mock('../db/schema.js', () => {
  const mk = (table: string, cols: string[]) => {
    const out: Record<string, unknown> = { _table: table, $inferSelect: {} };
    for (const c of cols) out[c] = { _col: c, _table: table };
    return out;
  };
  return { workflows: mk('workflows', ['id']) };
});

vi.mock('../db/index.js', () => {
  function selectChain() {
    let filter: { col: string; val: unknown } | null = null;
    const chain: Record<string, unknown> = {
      where: vi.fn((f: { col: string; val: unknown }) => {
        filter = f;
        return chain;
      }),
      then: (resolve: (v: Row[]) => void) =>
        resolve(state.workflows.filter((r) => !filter || r[filter.col] === filter.val)),
    };
    return chain;
  }
  return {
    db: {
      select: vi.fn(() => ({ from: vi.fn(() => selectChain()) })),
      insert: vi.fn(() => ({
        values: vi.fn((vals: Record<string, unknown>) => ({
          returning: vi.fn(() => {
            const row: Row = {
              id: `wf-new-${nextId++}`,
              name: vals.name ?? '',
              description: vals.description ?? '',
              nodes: vals.nodes ?? [],
              connections: vals.connections ?? [],
              active: false,
              version: 1,
              environment: 'dev',
              canvas: {},
              settings: {},
              tags: [],
              createdBy: vals.createdBy ?? 'test',
              updatedBy: vals.updatedBy ?? 'test',
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            state.workflows.push(row);
            return Promise.resolve([row]);
          }),
        })),
      })),
    },
  };
});

vi.mock('../api/ws/broadcaster.js', () => ({ getBroadcaster: () => null }));

interface CapturedTool {
  name: string;
  handler: (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
}

describe('import + validate MCP tools', () => {
  const tools: CapturedTool[] = [];

  beforeAll(async () => {
    state.workflows.push({
      id: 'wf-valid',
      name: 'OK',
      description: '',
      nodes: [
        { id: 't', type: 'webhook', name: 'T', position: { x: 0, y: 0 }, data: { label: 'T', config: { path: 'p' } }, createdAt: 't', updatedAt: 't' },
        { id: 'r', type: 'respond-webhook', name: 'R', position: { x: 0, y: 0 }, data: { label: 'R', config: {} }, createdAt: 't', updatedAt: 't' },
      ],
      connections: [{ id: 'c', sourceNodeId: 't', targetNodeId: 'r' }],
      active: false,
      version: 1,
      environment: 'dev',
      createdBy: 't',
      updatedBy: 't',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const fakeServer = {
      tool: (name: string, _schema: unknown, handler: CapturedTool['handler']) => {
        tools.push({ name, handler });
      },
    };
    const { registerImportTools } = await import('../mcp/tools/import.js');
    const { registerValidateTools } = await import('../mcp/tools/validate.js');
    registerImportTools(fakeServer as never);
    registerValidateTools(fakeServer as never);
  });

  it('registers both tools', () => {
    expect(tools.find((t) => t.name === 'flowaibuilder.import_n8n')).toBeDefined();
    expect(tools.find((t) => t.name === 'flowaibuilder.validate')).toBeDefined();
  });

  it('import_n8n: valid payload returns workflow + warnings', async () => {
    const tool = tools.find((t) => t.name === 'flowaibuilder.import_n8n')!;
    const res = await tool.handler({
      n8n_workflow_json: {
        nodes: [{ id: 'a', name: 'A', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: { path: 'p' } }],
        connections: {},
      },
    });
    expect(res.isError).toBeFalsy();
    const body = JSON.parse(res.content[0].text);
    expect(body.workflow.nodes).toHaveLength(1);
    expect(body.warnings).toEqual([]);
  });

  it('import_n8n: invalid input returns error', async () => {
    const tool = tools.find((t) => t.name === 'flowaibuilder.import_n8n')!;
    const res = await tool.handler({ n8n_workflow_json: null });
    expect(res.isError).toBe(true);
  });

  it('validate: known workflow returns result', async () => {
    const tool = tools.find((t) => t.name === 'flowaibuilder.validate')!;
    const res = await tool.handler({ workflow_id: 'wf-valid' });
    expect(res.isError).toBeFalsy();
    const body = JSON.parse(res.content[0].text);
    expect(body).toHaveProperty('valid');
    expect(body).toHaveProperty('issues');
  });

  it('validate: unknown workflow returns error', async () => {
    const tool = tools.find((t) => t.name === 'flowaibuilder.validate')!;
    const res = await tool.handler({ workflow_id: 'missing' });
    expect(res.isError).toBe(true);
    const body = JSON.parse(res.content[0].text);
    expect(body.error).toContain('Workflow not found');
  });
});

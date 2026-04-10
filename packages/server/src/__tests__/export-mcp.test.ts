import { describe, it, expect, vi, beforeAll } from 'vitest';

type Row = Record<string, unknown>;
const state: { workflows: Row[] } = { workflows: [] };

vi.mock('drizzle-orm', () => ({
  eq: (col: { _col: string }, val: unknown) => ({ kind: 'eq', col: col._col, val }),
  and: (...conds: unknown[]) => ({ kind: 'and', conds }),
  desc: (col: { _col: string }) => ({ kind: 'desc', col: col._col }),
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
  return { db: { select: vi.fn(() => ({ from: vi.fn(() => selectChain()) })) } };
});

interface CapturedTool {
  name: string;
  handler: (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
}

describe('export MCP tool', () => {
  const tools: CapturedTool[] = [];

  beforeAll(async () => {
    state.workflows.push({
      id: 'wf-1',
      name: 'Demo',
      description: 'demo',
      nodes: [
        { id: 'n1', type: 'webhook', name: 'In', position: { x: 0, y: 0 }, data: { label: 'In', config: {} }, createdAt: 't', updatedAt: 't' },
        { id: 'n2', type: 'respond-webhook', name: 'Out', position: { x: 100, y: 0 }, data: { label: 'Out', config: {} }, createdAt: 't', updatedAt: 't' },
      ],
      connections: [{ id: 'c1', sourceNodeId: 'n1', targetNodeId: 'n2' }],
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
    const { registerExportTools } = await import('../mcp/tools/export.js');
    registerExportTools(fakeServer as never);
  });

  it('registers flowaibuilder.export', () => {
    expect(tools.find((t) => t.name === 'flowaibuilder.export')).toBeDefined();
  });

  for (const fmt of ['prompt', 'typescript', 'python', 'mermaid', 'json'] as const) {
    it(`returns content for format=${fmt}`, async () => {
      const tool = tools.find((t) => t.name === 'flowaibuilder.export')!;
      const res = await tool.handler({ workflow_id: 'wf-1', format: fmt });
      expect(res.isError).toBeFalsy();
      expect(typeof res.content[0].text).toBe('string');
      expect(res.content[0].text.length).toBeGreaterThan(0);
    });
  }

  it('unknown id returns error', async () => {
    const tool = tools.find((t) => t.name === 'flowaibuilder.export')!;
    const res = await tool.handler({ workflow_id: 'missing', format: 'json' });
    expect(res.isError).toBe(true);
  });
});

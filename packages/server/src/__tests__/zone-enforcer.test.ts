import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── In-memory DB mock (mirrors fix-engine.test.ts) ──────────
type Row = Record<string, unknown>;
const state: {
  workflows: Row[];
  protectedZones: Row[];
} = {
  workflows: [],
  protectedZones: [],
};

function resetState() {
  state.workflows = [];
  state.protectedZones = [];
}

vi.mock('drizzle-orm', () => {
  return {
    eq: (col: { _col: string; _table: string }, val: unknown) => ({
      kind: 'eq',
      col: col._col,
      table: col._table,
      val,
    }),
    and: (...conds: unknown[]) => ({ kind: 'and', conds }),
    desc: (col: { _col: string }) => ({ kind: 'desc', col: col._col }),
  };
});

vi.mock('../db/schema.js', () => {
  const mk = (table: string, cols: string[]) => {
    const out: Record<string, unknown> = { _table: table, $inferSelect: {} };
    for (const c of cols) out[c] = { _col: c, _table: table };
    return out;
  };
  return {
    workflows: mk('workflows', ['id']),
    protectedZones: mk('protectedZones', ['id', 'workflowId']),
    // tables referenced incidentally by other imports
    executions: mk('executions', ['id', 'workflowId']),
    annotations: mk('annotations', ['id', 'workflowId']),
    workflowReviews: mk('workflowReviews', ['id', 'workflowId']),
    taskNodeLinks: mk('taskNodeLinks', ['id']),
    instanceSettings: mk('instanceSettings', ['id']),
  };
});

function tableNameFromArg(arg: unknown): string {
  return (arg as { _table?: string })?._table ?? '';
}

function matchesFilter(row: Row, filter: unknown): boolean {
  if (!filter) return true;
  const f = filter as { kind: string; conds?: unknown[]; col?: string; val?: unknown };
  if (f.kind === 'and') return (f.conds ?? []).every(c => matchesFilter(row, c));
  if (f.kind === 'eq') return row[f.col as string] === f.val;
  return true;
}

let nextId = 1;
function genId(prefix: string) {
  return `${prefix}-${nextId++}`;
}

vi.mock('../db/index.js', () => {
  function selectChain(pool: () => Row[]) {
    let filter: unknown;
    const chain: Record<string, unknown> = {
      where: vi.fn((f: unknown) => {
        filter = f;
        return chain;
      }),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(async (n: number) =>
        pool().filter(r => matchesFilter(r, filter)).slice(0, n),
      ),
      then: (resolve: (v: Row[]) => void) =>
        resolve(pool().filter(r => matchesFilter(r, filter))),
    };
    return chain;
  }

  const db = {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => {
        const name = tableNameFromArg(table);
        const pool = () => (state[name as keyof typeof state] as Row[]) ?? [];
        return selectChain(pool);
      }),
    })),
    insert: vi.fn((table: unknown) => {
      const name = tableNameFromArg(table);
      return {
        values: vi.fn((vals: Row | Row[]) => ({
          returning: vi.fn(async () => {
            const list = Array.isArray(vals) ? vals : [vals];
            const stamped = list.map(v => ({
              id: v.id ?? genId(name),
              pinnedAt: new Date(),
              ...v,
            }));
            (state[name as keyof typeof state] as Row[]).push(...stamped);
            return stamped;
          }),
        })),
      };
    }),
    update: vi.fn((table: unknown) => {
      const name = tableNameFromArg(table);
      return {
        set: vi.fn((patch: Row) => ({
          where: vi.fn((filter: unknown) => {
            const apply = () => {
              const rows = (state[name as keyof typeof state] as Row[]).filter(r =>
                matchesFilter(r, filter),
              );
              for (const r of rows) Object.assign(r, patch);
              return rows;
            };
            return {
              returning: vi.fn(async () => apply()),
              then: (resolve: (v: Row[]) => void) => resolve(apply()),
            };
          }),
        })),
      };
    }),
    delete: vi.fn((table: unknown) => {
      const name = tableNameFromArg(table);
      return {
        where: vi.fn((filter: unknown) => {
          const apply = () => {
            const list = state[name as keyof typeof state] as Row[];
            const removed: Row[] = [];
            for (let i = list.length - 1; i >= 0; i--) {
              if (matchesFilter(list[i], filter)) {
                removed.push(list[i]);
                list.splice(i, 1);
              }
            }
            return removed;
          };
          return {
            returning: vi.fn(async () => apply()),
          };
        }),
      };
    }),
  };
  return { db };
});

const broadcastToWorkflowSpy = vi.fn();
vi.mock('../api/ws/broadcaster.js', () => ({
  getBroadcaster: () => ({
    broadcast: vi.fn(),
    broadcastToWorkflow: broadcastToWorkflowSpy,
  }),
}));

// Stub auto-review trigger so we don't fan into other modules
vi.mock('../review/triggers.js', () => ({
  maybeEmitAutoReview: vi.fn(async () => undefined),
}));

// Imports after mocks
import {
  handleUpdateNode,
  handleRemoveNode,
  handleDisconnectNodes,
} from '../mcp/index.js';
import { registerZoneTools } from '../mcp/tools/zones.js';

type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}>;

function makeFakeServer() {
  const tools = new Map<string, ToolHandler>();
  return {
    tool: (name: string, _schema: unknown, handler: ToolHandler) => {
      tools.set(name, handler);
    },
    call: (name: string, params: Record<string, unknown>) => {
      const h = tools.get(name);
      if (!h) throw new Error(`tool ${name} not registered`);
      return h(params);
    },
  };
}

const WF = 'wf-zone-1';

function seedWorkflow(nodes: Array<{ id: string; name?: string }>, connections: Array<{ id: string; sourceNodeId: string; targetNodeId: string }> = []) {
  state.workflows.push({
    id: WF,
    name: 'wf',
    nodes: nodes.map(n => ({
      id: n.id,
      type: 'set',
      name: n.name ?? n.id,
      position: { x: 0, y: 0 },
      data: { label: n.name ?? n.id, config: {} },
      createdAt: '',
      updatedAt: '',
    })),
    connections,
  });
}

function pin(zoneName: string, nodeIds: string[], zoneId = `zone-${zoneName}`) {
  state.protectedZones.push({
    id: zoneId,
    workflowId: WF,
    name: zoneName,
    nodeIds,
    color: '#378ADD',
    pinnedBy: 'mcp:claude',
    pinnedAt: new Date(),
  });
  return zoneId;
}

beforeEach(() => {
  resetState();
  broadcastToWorkflowSpy.mockClear();
  nextId = 1;
});

describe('Zone CRUD MCP tools', () => {
  it('create_zone happy path inserts row and broadcasts zone_created', async () => {
    seedWorkflow([{ id: 'n1' }, { id: 'n2' }]);
    const fake = makeFakeServer();
    registerZoneTools(fake as unknown as Parameters<typeof registerZoneTools>[0]);

    const res = await fake.call('flowaibuilder.create_zone', {
      workflow_id: WF,
      name: 'critical',
      node_ids: ['n1', 'n2'],
      reason: 'do not touch',
    });
    expect(res.isError).toBeFalsy();
    const body = JSON.parse(res.content[0].text);
    expect(body.zone.name).toBe('critical');
    expect(body.zone.nodeIds).toEqual(['n1', 'n2']);
    expect(body.zone.color).toBe('#378ADD');
    expect(body.zone.pinnedBy).toBe('mcp:claude');
    expect(state.protectedZones).toHaveLength(1);

    const call = broadcastToWorkflowSpy.mock.calls.find(c => c[1] === 'zone_created');
    expect(call).toBeDefined();
    expect(call![0]).toBe(WF);
  });

  it('create_zone rejects unknown node_ids', async () => {
    seedWorkflow([{ id: 'n1' }]);
    const fake = makeFakeServer();
    registerZoneTools(fake as unknown as Parameters<typeof registerZoneTools>[0]);

    const res = await fake.call('flowaibuilder.create_zone', {
      workflow_id: WF,
      name: 'bad',
      node_ids: ['n1', 'ghost'],
    });
    expect(res.isError).toBe(true);
    const body = JSON.parse(res.content[0].text);
    expect(body.error).toMatch(/ghost/);
    expect(state.protectedZones).toHaveLength(0);
  });
});

describe('ZoneEnforcer mutations', () => {
  it('update_node on pinned node throws zone error with exact message format', async () => {
    seedWorkflow([{ id: 'n1' }]);
    pin('critical', ['n1']);

    await expect(
      handleUpdateNode({ workflow_id: WF, node_id: 'n1', config: { x: 1 } }),
    ).rejects.toThrow(
      'PROTECTED ZONE: Cannot update node n1 — it belongs to zone "critical". You CAN: read config, trace data flow, connect new nodes to outputs. You CANNOT: modify, remove, or disconnect.',
    );
    // No broadcast emitted
    const call = broadcastToWorkflowSpy.mock.calls.find(c => c[1] === 'node_updated');
    expect(call).toBeUndefined();
  });

  it('update_node on non-pinned node still works', async () => {
    seedWorkflow([{ id: 'n1' }, { id: 'n2' }]);
    pin('critical', ['n1']);

    const res = await handleUpdateNode({
      workflow_id: WF,
      node_id: 'n2',
      config: { y: 9 },
    });
    const body = JSON.parse(res.content[0].text);
    expect(body.updated).toBe(true);
  });

  it('remove_node on pinned node throws zone error (verb=remove)', async () => {
    seedWorkflow([{ id: 'n1' }]);
    pin('critical', ['n1']);

    await expect(
      handleRemoveNode({ workflow_id: WF, node_id: 'n1' }),
    ).rejects.toThrow(/Cannot remove node n1/);
  });

  it('disconnect_nodes blocked when source endpoint pinned', async () => {
    seedWorkflow(
      [{ id: 'n1' }, { id: 'n2' }],
      [{ id: 'c1', sourceNodeId: 'n1', targetNodeId: 'n2' }],
    );
    pin('critical', ['n1']);

    await expect(
      handleDisconnectNodes({ workflow_id: WF, connection_id: 'c1' }),
    ).rejects.toThrow(/Cannot disconnect node n1/);
  });

  it('disconnect_nodes blocked when target endpoint pinned', async () => {
    seedWorkflow(
      [{ id: 'n1' }, { id: 'n2' }],
      [{ id: 'c1', sourceNodeId: 'n1', targetNodeId: 'n2' }],
    );
    pin('critical', ['n2']);

    await expect(
      handleDisconnectNodes({ workflow_id: WF, connection_id: 'c1' }),
    ).rejects.toThrow(/Cannot disconnect node n2/);
  });

  it('disconnect_nodes allowed when neither endpoint pinned', async () => {
    seedWorkflow(
      [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }],
      [
        { id: 'c1', sourceNodeId: 'n1', targetNodeId: 'n2' },
        { id: 'c2', sourceNodeId: 'n2', targetNodeId: 'n3' },
      ],
    );
    pin('critical', ['n3']);

    const res = await handleDisconnectNodes({ workflow_id: WF, connection_id: 'c1' });
    const body = JSON.parse(res.content[0].text);
    expect(body.disconnected).toBe(true);
  });
});

describe('Read paths unaffected by zones', () => {
  it('reading the workflow row directly returns pinned nodes unchanged', async () => {
    seedWorkflow([{ id: 'n1' }, { id: 'n2' }]);
    pin('critical', ['n1']);

    // Direct DB read (mirrors get_workflow tool)
    const rows = state.workflows;
    expect((rows[0].nodes as Array<{ id: string }>).map(n => n.id)).toEqual(['n1', 'n2']);
  });
});

describe('delete_zone & re-enables editing', () => {
  it('delete_zone removes row, allows subsequent update_node', async () => {
    seedWorkflow([{ id: 'n1' }]);
    const zoneId = pin('critical', ['n1']);

    const fake = makeFakeServer();
    registerZoneTools(fake as unknown as Parameters<typeof registerZoneTools>[0]);

    const res = await fake.call('flowaibuilder.delete_zone', {
      workflow_id: WF,
      zone_id: zoneId,
    });
    expect(res.isError).toBeFalsy();
    expect(state.protectedZones).toHaveLength(0);

    const call = broadcastToWorkflowSpy.mock.calls.find(c => c[1] === 'zone_deleted');
    expect(call).toBeDefined();

    const upd = await handleUpdateNode({
      workflow_id: WF,
      node_id: 'n1',
      config: { ok: true },
    });
    expect(JSON.parse(upd.content[0].text).updated).toBe(true);
  });
});

describe('add_to_zone & remove_from_zone', () => {
  it('add_to_zone dedupes existing entries', async () => {
    seedWorkflow([{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }]);
    const zoneId = pin('critical', ['n1']);

    const fake = makeFakeServer();
    registerZoneTools(fake as unknown as Parameters<typeof registerZoneTools>[0]);

    const res = await fake.call('flowaibuilder.add_to_zone', {
      workflow_id: WF,
      zone_id: zoneId,
      node_ids: ['n1', 'n2', 'n3'],
    });
    const body = JSON.parse(res.content[0].text);
    expect(body.zone.nodeIds).toEqual(['n1', 'n2', 'n3']);

    const call = broadcastToWorkflowSpy.mock.calls.find(c => c[1] === 'zone_updated');
    expect(call).toBeDefined();
  });

  it('remove_from_zone updates the array', async () => {
    seedWorkflow([{ id: 'n1' }, { id: 'n2' }]);
    const zoneId = pin('critical', ['n1', 'n2']);

    const fake = makeFakeServer();
    registerZoneTools(fake as unknown as Parameters<typeof registerZoneTools>[0]);

    const res = await fake.call('flowaibuilder.remove_from_zone', {
      workflow_id: WF,
      zone_id: zoneId,
      node_ids: ['n1'],
    });
    const body = JSON.parse(res.content[0].text);
    expect(body.zone.nodeIds).toEqual(['n2']);
    expect(state.protectedZones).toHaveLength(1);
  });

  it('remove_from_zone removing last node deletes the zone and broadcasts zone_deleted', async () => {
    seedWorkflow([{ id: 'n1' }]);
    const zoneId = pin('critical', ['n1']);

    const fake = makeFakeServer();
    registerZoneTools(fake as unknown as Parameters<typeof registerZoneTools>[0]);

    const res = await fake.call('flowaibuilder.remove_from_zone', {
      workflow_id: WF,
      zone_id: zoneId,
      node_ids: ['n1'],
    });
    const body = JSON.parse(res.content[0].text);
    expect(body.deleted).toBe(true);
    expect(state.protectedZones).toHaveLength(0);

    const call = broadcastToWorkflowSpy.mock.calls.find(c => c[1] === 'zone_deleted');
    expect(call).toBeDefined();
  });
});

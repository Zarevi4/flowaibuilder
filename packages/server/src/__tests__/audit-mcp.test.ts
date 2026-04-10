import { describe, it, expect, vi, beforeEach } from 'vitest';

const { state } = vi.hoisted(() => ({
  state: {
    audit: [] as Array<Record<string, unknown>>,
    executions: [] as Array<Record<string, unknown>>,
  },
}));

Object.assign(state, {
  audit: [
    {
      id: 'a1',
      timestamp: new Date('2026-04-01T00:00:00Z'),
      actor: 'alice@example.com',
      action: 'workflow.created',
      resourceType: 'workflow',
      resourceId: 'wf-1',
      changes: null,
      metadata: { workflow_id: 'wf-1' },
    },
    {
      id: 'a2',
      timestamp: new Date('2026-04-05T00:00:00Z'),
      actor: 'mcp:claude-code',
      action: 'node.created',
      resourceType: 'node',
      resourceId: 'n1',
      changes: null,
      metadata: { workflow_id: 'wf-1' },
    },
  ] as Array<Record<string, unknown>>,
  executions: [
    {
      id: 'exec-1',
      workflowId: 'wf-1',
      workflowVersion: 1,
      status: 'success',
      mode: 'manual',
      triggerData: { password: 'secret' },
      resultData: { ok: true },
      nodeExecutions: [
        { nodeId: 'n1', nodeName: 'Webhook', status: 'success', input: {}, output: { token: 'abc' }, durationMs: 10 },
      ],
      error: null,
      triggeredBy: 'test',
      startedAt: new Date('2026-04-01T00:00:00Z'),
      finishedAt: new Date('2026-04-01T00:00:01Z'),
      durationMs: 1000,
    },
  ] as Array<Record<string, unknown>>,
});

vi.mock('../db/index.js', () => {
  const selectChain = (pool: Array<Record<string, unknown>>) => ({
    from: vi.fn(() => ({
      where: vi.fn((_filter?: unknown) => ({
        orderBy: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(pool)),
        })),
        then: (resolve: (v: unknown[]) => void) => resolve(pool),
      })),
      orderBy: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve(pool)),
      })),
    })),
  });
  let currentPool: Array<Record<string, unknown>> = state.audit;
  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn((t: unknown) => {
          const name = (t as { _?: { name?: string } })?._?.name ?? '';
          currentPool = name === 'executions' ? state.executions : state.audit;
          return {
            where: vi.fn(() => ({
              orderBy: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve(currentPool)) })),
              then: (resolve: (v: unknown[]) => void) => resolve(currentPool),
            })),
            orderBy: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve(currentPool)) })),
          };
        }),
      })),
      insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) })),
    },
  };
});

vi.mock('../db/schema.js', () => ({
  auditLog: {
    _: { name: 'audit_log' },
    timestamp: 'timestamp',
    actor: 'actor',
    action: 'action',
    resourceType: 'resource_type',
    resourceId: 'resource_id',
    metadata: 'metadata',
  },
  executions: { _: { name: 'executions' }, id: 'id' },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  or: vi.fn(() => ({})),
  gte: vi.fn(() => ({})),
  sql: Object.assign(vi.fn(() => ({})), { raw: vi.fn(() => ({})) }),
}));

import { registerAuditTools } from '../mcp/tools/audit.js';

// Minimal fake McpServer that captures handlers
function makeFakeServer() {
  const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
  return {
    tool: vi.fn((name: string, _schema: unknown, handler: (a: Record<string, unknown>) => Promise<unknown>) => {
      handlers.set(name, handler);
    }),
    call: (name: string, args: Record<string, unknown>) => {
      const h = handlers.get(name);
      if (!h) throw new Error(`tool ${name} not registered`);
      return h(args);
    },
  };
}

describe('MCP audit tools', () => {
  let server: ReturnType<typeof makeFakeServer>;

  beforeEach(() => {
    server = makeFakeServer();
    registerAuditTools(server as never);
  });

  it('get_audit_log returns entries', async () => {
    const res = (await server.call('flowaibuilder.get_audit_log', {})) as {
      content: [{ text: string }];
    };
    const body = JSON.parse(res.content[0].text);
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0].action).toBeDefined();
  });

  it('get_execution_log summary returns correct shape', async () => {
    const res = (await server.call('flowaibuilder.get_execution_log', {
      execution_id: 'exec-1',
    })) as { content: [{ text: string }] };
    const body = JSON.parse(res.content[0].text);
    expect(body.id).toBe('exec-1');
    expect(body.status).toBe('success');
    expect(body.node_count).toBe(1);
    expect(body.trigger_data).toBeUndefined();
  });

  it('get_execution_log full returns node_executions', async () => {
    const res = (await server.call('flowaibuilder.get_execution_log', {
      execution_id: 'exec-1',
      detail_level: 'full',
    })) as { content: [{ text: string }] };
    const body = JSON.parse(res.content[0].text);
    expect(body.node_executions).toHaveLength(1);
    expect(body.node_executions[0].output.token).toBe('[REDACTED]');
  });

  it('get_execution_log debug includes trigger_data (redacted)', async () => {
    const res = (await server.call('flowaibuilder.get_execution_log', {
      execution_id: 'exec-1',
      detail_level: 'debug',
    })) as { content: [{ text: string }] };
    const body = JSON.parse(res.content[0].text);
    expect(body.trigger_data.password).toBe('[REDACTED]');
    expect(body.result_data.ok).toBe(true);
  });

  it('get_execution_log throws on missing execution', async () => {
    const originalExecs = state.executions;
    state.executions = [];
    await expect(
      server.call('flowaibuilder.get_execution_log', { execution_id: 'nope' }),
    ).rejects.toThrow(/not found/);
    state.executions = originalExecs;
  });
});

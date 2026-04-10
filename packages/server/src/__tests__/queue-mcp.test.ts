import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock queue manager
const mockIsQueueMode = vi.fn().mockReturnValue(false);
const mockGetQueueStatus = vi.fn();

vi.mock('../queue/manager.js', () => ({
  isQueueMode: () => mockIsQueueMode(),
  getQueueStatus: () => mockGetQueueStatus(),
}));

// Mock DB for configure_log_streaming
const mockDbSelect = vi.fn().mockResolvedValue([{ id: 'singleton' }]);
const mockDbUpdate = vi.fn().mockResolvedValue([{}]);
vi.mock('../db/index.js', () => ({
  db: {
    select: () => ({ from: () => ({ where: mockDbSelect }) }),
    insert: () => ({ values: () => ({ onConflictDoNothing: vi.fn() }) }),
    update: () => ({ set: () => ({ where: mockDbUpdate }) }),
  },
}));

vi.mock('../db/schema.js', () => ({
  instanceSettings: { id: { _col: 'id' } },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
}));

vi.mock('../mcp/index.js', () => ({
  mcpActor: () => 'test-user',
}));

vi.mock('../mcp/rbac.js', () => ({
  assertMcpPermitted: vi.fn(),
}));

describe('Queue MCP Tools', () => {
  let registerQueueTools: typeof import('../mcp/tools/queue.js').registerQueueTools;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../mcp/tools/queue.js');
    registerQueueTools = mod.registerQueueTools;
  });

  it('get_queue_status returns enabled: false when queue mode off', async () => {
    mockIsQueueMode.mockReturnValue(false);

    // Simulate MCP tool registration and invocation
    const tools = new Map<string, (params: Record<string, unknown>) => Promise<unknown>>();
    const mockServer = {
      tool: (name: string, _schema: unknown, handler: unknown) => {
        tools.set(name, handler as (params: Record<string, unknown>) => Promise<unknown>);
      },
    };

    registerQueueTools(mockServer as any);

    const handler = tools.get('flowaibuilder.get_queue_status');
    expect(handler).toBeTruthy();

    const result = await handler!({});
    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed.enabled).toBe(false);
  });

  it('get_queue_status returns full status when queue mode on', async () => {
    mockIsQueueMode.mockReturnValue(true);
    mockGetQueueStatus.mockResolvedValue({
      enabled: true,
      concurrency: 5,
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      workers: 1,
    });

    const tools = new Map<string, (params: Record<string, unknown>) => Promise<unknown>>();
    const mockServer = {
      tool: (name: string, _schema: unknown, handler: unknown) => {
        tools.set(name, handler as (params: Record<string, unknown>) => Promise<unknown>);
      },
    };

    registerQueueTools(mockServer as any);

    const handler = tools.get('flowaibuilder.get_queue_status');
    const result = await handler!({});
    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed.enabled).toBe(true);
    expect(parsed.concurrency).toBe(5);
  });

  it('configure_log_streaming validates webhook URL', async () => {
    const tools = new Map<string, (params: Record<string, unknown>) => Promise<unknown>>();
    const mockServer = {
      tool: (name: string, _schema: unknown, handler: unknown) => {
        tools.set(name, handler as (params: Record<string, unknown>) => Promise<unknown>);
      },
    };

    registerQueueTools(mockServer as any);

    const handler = tools.get('flowaibuilder.configure_log_streaming');
    expect(handler).toBeTruthy();

    await expect(
      handler!({
        destinations: [{ type: 'webhook', url: 'http://insecure.com', enabled: true }],
      }),
    ).rejects.toThrow('https://');
  });

  it('configure_log_streaming validates S3 bucket', async () => {
    const tools = new Map<string, (params: Record<string, unknown>) => Promise<unknown>>();
    const mockServer = {
      tool: (name: string, _schema: unknown, handler: unknown) => {
        tools.set(name, handler as (params: Record<string, unknown>) => Promise<unknown>);
      },
    };

    registerQueueTools(mockServer as any);

    const handler = tools.get('flowaibuilder.configure_log_streaming');

    await expect(
      handler!({
        destinations: [{ type: 's3', enabled: true }],
      }),
    ).rejects.toThrow('bucket');
  });

  it('configure_log_streaming succeeds with valid stdout destination', async () => {
    const tools = new Map<string, (params: Record<string, unknown>) => Promise<unknown>>();
    const mockServer = {
      tool: (name: string, _schema: unknown, handler: unknown) => {
        tools.set(name, handler as (params: Record<string, unknown>) => Promise<unknown>);
      },
    };

    registerQueueTools(mockServer as any);

    const handler = tools.get('flowaibuilder.configure_log_streaming');

    const result = await handler!({
      destinations: [{ type: 'stdout', enabled: true }],
    });

    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed.success).toBe(true);
  });
});

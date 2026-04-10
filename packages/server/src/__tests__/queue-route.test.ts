import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';

// Mock queue manager
const mockGetQueueStatus = vi.fn();
const mockIsQueueMode = vi.fn();

vi.mock('../queue/manager.js', () => ({
  isQueueMode: () => mockIsQueueMode(),
  getQueueStatus: () => mockGetQueueStatus(),
  enqueueExecution: vi.fn(),
}));

// Minimal mocks for the workflow routes dependencies
vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
  desc: vi.fn(),
  isNotNull: vi.fn(),
  sql: Object.assign(vi.fn(() => ({})), { raw: vi.fn(() => ({})) }),
}));

vi.mock('../db/schema.js', () => {
  const mk = (table: string, cols: string[]) => {
    const out: Record<string, unknown> = { _table: table, $inferSelect: {} };
    for (const c of cols) out[c] = { _col: c };
    return out;
  };
  return {
    workflows: mk('workflows', ['id', 'name', 'version']),
    executions: mk('executions', ['id', 'workflowId', 'startedAt']),
    taskNodeLinks: mk('task_node_links', ['id', 'workflowId']),
    workflowVersions: mk('workflow_versions', ['id', 'workflowId']),
    instanceSettings: mk('instance_settings', ['id']),
  };
});

vi.mock('../db/index.js', () => ({
  db: {
    select: () => ({ from: () => ({ where: vi.fn().mockResolvedValue([]) }) }),
    insert: () => ({ values: () => ({ returning: vi.fn().mockResolvedValue([]), onConflictDoNothing: vi.fn() }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: vi.fn().mockResolvedValue([]) }) }) }),
    delete: () => ({ where: () => ({ returning: vi.fn().mockResolvedValue([]) }) }),
  },
}));

vi.mock('../versioning/store.js', () => ({
  recordSnapshot: vi.fn(),
  listVersions: vi.fn().mockResolvedValue([]),
  getVersion: vi.fn(),
  revertToVersion: vi.fn(),
}));
vi.mock('../versioning/diff.js', () => ({
  diffSnapshots: vi.fn(),
  shouldVersion: vi.fn().mockReturnValue(false),
}));
vi.mock('../versioning/git.js', () => ({
  pushWorkflow: vi.fn(),
  defaultRepoPath: vi.fn(),
}));
vi.mock('../crypto/aes.js', () => ({
  decrypt: vi.fn(),
  encrypt: vi.fn(),
}));
vi.mock('../api/ws/broadcaster.js', () => ({
  getBroadcaster: () => ({ broadcastToWorkflow: vi.fn(), broadcast: vi.fn() }),
}));
vi.mock('../agent-teams/index.js', () => ({
  getTeamWatcher: () => null,
}));
vi.mock('../review/triggers.js', () => ({
  maybeEmitAutoReview: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../review/store.js', () => ({
  annotationStore: { getByWorkflow: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../zones/enforcer.js', () => ({
  assertNodeNotPinned: vi.fn(),
  assertConnectionEndpointsNotPinned: vi.fn(),
}));
vi.mock('../export/index.js', () => ({
  compileWorkflow: vi.fn(),
  ExportError: class extends Error {},
  EXPORT_FORMATS: ['json'],
}));
vi.mock('../import/index.js', () => ({
  importN8nWorkflow: vi.fn(),
  ImportError: class extends Error {},
}));
vi.mock('../validation/index.js', () => ({
  validateWorkflow: vi.fn(),
}));
vi.mock('nanoid', () => ({ nanoid: () => 'test-id' }));

describe('GET /api/queue/status', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify();
    const { workflowRoutes } = await import('../api/routes/workflows.js');
    await workflowRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns { enabled: false } when queue mode is off', async () => {
    mockIsQueueMode.mockReturnValue(false);

    const res = await app.inject({
      method: 'GET',
      url: '/api/queue/status',
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ enabled: false });
  });

  it('returns full status when queue mode is on', async () => {
    mockIsQueueMode.mockReturnValue(true);
    mockGetQueueStatus.mockResolvedValue({
      enabled: true,
      concurrency: 5,
      waiting: 2,
      active: 1,
      completed: 10,
      failed: 0,
      delayed: 0,
      workers: 3,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/queue/status',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.enabled).toBe(true);
    expect(body.concurrency).toBe(5);
    expect(body.waiting).toBe(2);
    expect(body.workers).toBe(3);
  });
});

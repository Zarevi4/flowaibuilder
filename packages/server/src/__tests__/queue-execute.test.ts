import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';

const mockEnqueue = vi.fn().mockResolvedValue({ id: 'job-1' });
const mockIsQueueMode = vi.fn();

vi.mock('../queue/manager.js', () => ({
  isQueueMode: () => mockIsQueueMode(),
  enqueueExecution: (...args: unknown[]) => mockEnqueue(...args),
  getQueueStatus: vi.fn(),
}));

const mockWorkflow = {
  id: 'wf-1',
  name: 'Test',
  description: '',
  active: false,
  version: 1,
  nodes: [],
  connections: [],
  canvas: {},
  settings: {},
  tags: [],
  createdBy: 'test',
  updatedBy: 'test',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockExecRecord = {
  id: 'exec-1',
  workflowId: 'wf-1',
  status: 'queued',
  mode: 'manual',
  triggeredBy: 'api',
  startedAt: new Date(),
};

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
    executions: mk('executions', ['id', 'workflowId', 'startedAt', 'status']),
    taskNodeLinks: mk('task_node_links', ['id', 'workflowId']),
    workflowVersions: mk('workflow_versions', ['id', 'workflowId']),
    instanceSettings: mk('instance_settings', ['id']),
  };
});

vi.mock('../db/index.js', () => ({
  db: {
    select: () => ({ from: () => ({ where: vi.fn().mockResolvedValue([mockWorkflow]) }) }),
    insert: () => ({
      values: () => ({
        returning: vi.fn().mockResolvedValue([mockExecRecord]),
        onConflictDoNothing: vi.fn(),
      }),
    }),
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

describe('POST /api/workflows/:id/execute with queue mode', () => {
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

  it('returns { status: "queued" } when QUEUE_MODE is true', async () => {
    mockIsQueueMode.mockReturnValue(true);

    const res = await app.inject({
      method: 'POST',
      url: '/api/workflows/wf-1/execute',
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe('queued');
    expect(body.workflowId).toBe('wf-1');
    expect(body.id).toBe('exec-1');
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'wf-1',
        executionId: 'exec-1',
        mode: 'manual',
      }),
    );
  });
});

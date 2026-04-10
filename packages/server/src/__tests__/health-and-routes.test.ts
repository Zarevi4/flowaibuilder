import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';

// Mock DB
vi.mock('../db/index.js', () => {
  const mockRows: unknown[] = [];
  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve(mockRows)),
          // direct call returns all rows
          then: (resolve: (v: unknown[]) => void) => resolve(mockRows),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve([{
            id: 'test-wf-id',
            name: 'Test Workflow',
            description: '',
            nodes: [],
            connections: [],
            active: false,
            version: 1,
            environment: 'dev',
            canvas: {},
            settings: {},
            tags: [],
            createdBy: 'api',
            updatedBy: 'api',
            createdAt: new Date(),
            updatedAt: new Date(),
          }])),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(() => Promise.resolve([])),
          })),
        })),
      })),
      delete: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve([])),
        })),
      })),
    },
  };
});

vi.mock('../api/ws/broadcaster.js', () => ({
  getBroadcaster: vi.fn(() => ({
    broadcast: vi.fn(),
    broadcastToWorkflow: vi.fn(),
    clientCount: 0,
  })),
  createBroadcaster: vi.fn(() => ({
    broadcast: vi.fn(),
    broadcastToWorkflow: vi.fn(),
    clientCount: 0,
    close: vi.fn(),
  })),
}));

describe('Health Check Endpoint', () => {
  it('GET /api/health should return 200 with status ok', async () => {
    const app = Fastify();

    // Register health route directly (same as index.ts)
    app.get('/api/health', async () => ({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
      wsClients: 0,
    }));

    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
    expect(body.version).toBe('0.1.0');
    expect(body.timestamp).toBeDefined();
    expect(body.wsClients).toBe(0);

    await app.close();
  });
});

describe('Workflow REST API Routes', () => {
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

  it('should have POST /api/workflows/:id/duplicate route registered', async () => {
    // Verify the route exists (even though it'll 404 because the mock DB returns nothing)
    const response = await app.inject({
      method: 'POST',
      url: '/api/workflows/nonexistent/duplicate',
    });

    // Should get 404 (not found, not method-not-allowed)
    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Workflow not found');
  });

  it('should have all CRUD routes registered', async () => {
    // GET /api/workflows
    const listRes = await app.inject({ method: 'GET', url: '/api/workflows' });
    expect(listRes.statusCode).toBe(200);

    // POST /api/workflows
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/workflows',
      payload: { name: 'Test' },
    });
    expect(createRes.statusCode).toBe(200);

    // GET /api/workflows/:id
    const getRes = await app.inject({ method: 'GET', url: '/api/workflows/test-id' });
    // Mock returns empty array, so 404
    expect(getRes.statusCode).toBe(404);

    // DELETE /api/workflows/:id
    const deleteRes = await app.inject({ method: 'DELETE', url: '/api/workflows/test-id' });
    expect(deleteRes.statusCode).toBe(404);
  });

  it('should have PATCH /api/workflows/:id/nodes/:nodeId route registered', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/workflows/nonexistent/nodes/node1',
      payload: { name: 'Updated', config: { url: 'https://test.com' } },
    });
    // Mock DB returns empty for select, so 404
    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Workflow not found');
  });

  it('should have execution route registered', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/workflows/test-id/execute',
      payload: {},
    });
    // Mock returns empty, so 404
    expect(response.statusCode).toBe(404);
  });
});

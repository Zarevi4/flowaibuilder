import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';

// Mock workflow data
const mockWorkflow = {
  id: 'wf1',
  name: 'Test',
  description: '',
  nodes: [
    { id: 'n1', type: 'webhook', name: 'Hook', position: { x: 0, y: 0 }, data: { label: 'Hook', config: {} }, createdAt: '', updatedAt: '' },
    { id: 'n2', type: 'code-js', name: 'Code', position: { x: 0, y: 150 }, data: { label: 'Code', config: {} }, createdAt: '', updatedAt: '' },
  ],
  connections: [
    { id: 'c1', sourceNodeId: 'n1', targetNodeId: 'n2' },
  ],
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
};

let capturedSet: Record<string, unknown> | null = null;

vi.mock('../db/index.js', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([{ ...mockWorkflow, nodes: [...mockWorkflow.nodes], connections: [...mockWorkflow.connections] }])),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([mockWorkflow])),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((data: Record<string, unknown>) => {
        capturedSet = data;
        return {
          where: vi.fn(() => ({
            returning: vi.fn(() => Promise.resolve([mockWorkflow])),
          })),
        };
      }),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([mockWorkflow])),
      })),
    })),
  },
}));

vi.mock('../api/ws/broadcaster.js', () => ({
  getBroadcaster: vi.fn(() => ({
    broadcast: vi.fn(),
    broadcastToWorkflow: vi.fn(),
  })),
}));

describe('Node & Connection REST Routes', () => {
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

  describe('DELETE /api/workflows/:id/nodes/:nodeId', () => {
    it('should remove a node and its connections', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/workflows/wf1/nodes/n2',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.removed).toBe(true);
      expect(body.node_id).toBe('n2');

      // Verify the set call filtered out node and connection
      expect(capturedSet).toBeTruthy();
      const nodes = capturedSet!.nodes as Array<{ id: string }>;
      const connections = capturedSet!.connections as Array<{ sourceNodeId: string }>;
      expect(nodes.find((n) => n.id === 'n2')).toBeUndefined();
      expect(connections).toHaveLength(0);
    });

    it('should return 404 for non-existent node', async () => {
      // Override mock to return workflow without the target node
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/workflows/wf1/nodes/nonexistent',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Node not found');
    });
  });

  describe('POST /api/workflows/:id/connections', () => {
    it('should create a new connection', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/workflows/wf1/connections',
        payload: {
          sourceNodeId: 'n1',
          targetNodeId: 'n2',
          sourceHandle: 'output-0',
          targetHandle: 'input-0',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.connection).toBeDefined();
      expect(body.connection.sourceNodeId).toBe('n1');
      expect(body.connection.targetNodeId).toBe('n2');
      expect(body.connection.id).toBeDefined();
    });
  });

  describe('DELETE /api/workflows/:id/connections/:connectionId', () => {
    it('should remove a connection by ID', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/workflows/wf1/connections/c1',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.removed).toBe(true);
      expect(body.connection_id).toBe('c1');
    });

    it('should return 404 for non-existent connection', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/workflows/wf1/connections/nonexistent',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Connection not found');
    });
  });
});

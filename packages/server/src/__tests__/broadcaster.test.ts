import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { Broadcaster, createBroadcaster, getBroadcaster } from '../api/ws/broadcaster.js';

describe('Broadcaster', () => {
  let broadcaster: Broadcaster;
  const TEST_PORT = 15174; // Use a high port to avoid conflicts

  beforeEach(() => {
    broadcaster = createBroadcaster(TEST_PORT);
  });

  afterEach(() => {
    broadcaster.close();
  });

  it('should create broadcaster and track instance', () => {
    expect(broadcaster).toBeDefined();
    expect(getBroadcaster()).toBe(broadcaster);
  });

  it('should report 0 clients initially', () => {
    expect(broadcaster.clientCount).toBe(0);
  });

  it('should send connection acknowledgment to new clients', async () => {
    const client = new WebSocket(`ws://localhost:${TEST_PORT}`);

    const message = await new Promise<string>((resolve, reject) => {
      client.on('message', (data) => resolve(data.toString()));
      client.on('error', reject);
      setTimeout(() => reject(new Error('Timeout')), 3000);
    });

    const parsed = JSON.parse(message);
    expect(parsed.type).toBe('connected');
    expect(parsed.data.clientCount).toBe(1);
    expect(parsed.timestamp).toBeDefined();

    client.close();
    // Wait for close to propagate
    await new Promise(r => setTimeout(r, 100));
  });

  it('should broadcast messages to connected clients', async () => {
    const client = new WebSocket(`ws://localhost:${TEST_PORT}`);

    // Wait for connection ack first
    await new Promise<void>((resolve) => {
      client.on('message', () => resolve());
    });

    // Now listen for broadcast
    const broadcastPromise = new Promise<string>((resolve, reject) => {
      client.on('message', (data) => resolve(data.toString()));
      setTimeout(() => reject(new Error('Timeout')), 3000);
    });

    broadcaster.broadcast('workflow_created', 'wf-123', { name: 'test' });

    const message = await broadcastPromise;
    const parsed = JSON.parse(message);
    expect(parsed.type).toBe('workflow_created');
    expect(parsed.workflowId).toBe('wf-123');
    expect(parsed.data).toEqual({ name: 'test' });

    client.close();
    await new Promise(r => setTimeout(r, 100));
  });

  it('should broadcast execution events to subscribed clients', async () => {
    const client = new WebSocket(`ws://localhost:${TEST_PORT}`);

    // Wait for connection ack
    await new Promise<void>((resolve) => {
      client.on('message', () => resolve());
    });

    // Subscribe to workflow wf-123
    client.send(JSON.stringify({ type: 'subscribe', workflowId: 'wf-123' }));
    // Small delay for subscribe to be processed
    await new Promise(r => setTimeout(r, 50));

    const broadcastPromise = new Promise<string>((resolve, reject) => {
      client.on('message', (data) => resolve(data.toString()));
      setTimeout(() => reject(new Error('Timeout')), 3000);
    });

    broadcaster.broadcastToWorkflow('wf-123', 'node_executed', {
      execution_id: 'exec-1',
      node_id: 'node-1',
      status: 'success',
      duration_ms: 42,
    });

    const message = await broadcastPromise;
    const parsed = JSON.parse(message);
    expect(parsed.type).toBe('node_executed');
    expect(parsed.data.execution_id).toBe('exec-1');

    client.close();
    await new Promise(r => setTimeout(r, 100));
  });
});

describe('Broadcaster with subscribe and full_sync', () => {
  let broadcaster: Broadcaster;
  const TEST_PORT = 15175;

  const mockWorkflow = {
    id: 'wf-1',
    name: 'Test Workflow',
    nodes: [],
    connections: [],
    active: false,
    version: 1,
    createdBy: 'test',
    updatedBy: 'test',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  afterEach(() => {
    broadcaster.close();
  });

  it('should handle subscribe message and respond with full_sync', async () => {
    const getWorkflowFn = vi.fn().mockResolvedValue(mockWorkflow);
    broadcaster = createBroadcaster(TEST_PORT, getWorkflowFn);

    const client = new WebSocket(`ws://localhost:${TEST_PORT}`);

    // Wait for connection ack
    await new Promise<void>((resolve) => {
      client.on('message', () => resolve());
    });

    // Listen for full_sync response
    const fullSyncPromise = new Promise<string>((resolve, reject) => {
      client.on('message', (data) => resolve(data.toString()));
      setTimeout(() => reject(new Error('Timeout')), 3000);
    });

    // Send subscribe
    client.send(JSON.stringify({ type: 'subscribe', workflowId: 'wf-1' }));

    const message = await fullSyncPromise;
    const parsed = JSON.parse(message);
    expect(parsed.type).toBe('full_sync');
    expect(parsed.workflowId).toBe('wf-1');
    expect(parsed.data.name).toBe('Test Workflow');
    expect(getWorkflowFn).toHaveBeenCalledWith('wf-1');

    client.close();
    await new Promise(r => setTimeout(r, 100));
  });

  it('should only send broadcastToWorkflow to subscribed clients', async () => {
    const getWorkflowFn = vi.fn().mockResolvedValue(mockWorkflow);
    broadcaster = createBroadcaster(TEST_PORT, getWorkflowFn);

    // Connect two clients
    const client1 = new WebSocket(`ws://localhost:${TEST_PORT}`);
    const client2 = new WebSocket(`ws://localhost:${TEST_PORT}`);

    // Wait for both connection acks
    await Promise.all([
      new Promise<void>((resolve) => {
        client1.on('message', () => resolve());
      }),
      new Promise<void>((resolve) => {
        client2.on('message', () => resolve());
      }),
    ]);

    // Subscribe client1 to wf-1
    const fullSync1 = new Promise<void>((resolve) => {
      client1.on('message', () => resolve());
    });
    client1.send(JSON.stringify({ type: 'subscribe', workflowId: 'wf-1' }));
    await fullSync1;

    // Subscribe client2 to wf-2
    const fullSync2 = new Promise<void>((resolve) => {
      client2.on('message', () => resolve());
    });
    client2.send(JSON.stringify({ type: 'subscribe', workflowId: 'wf-2' }));
    await fullSync2;

    // Broadcast to wf-1 — only client1 should receive
    const client1Promise = new Promise<string>((resolve, reject) => {
      client1.on('message', (data) => resolve(data.toString()));
      setTimeout(() => reject(new Error('Timeout')), 3000);
    });

    let client2Received = false;
    client2.on('message', () => { client2Received = true; });

    broadcaster.broadcastToWorkflow('wf-1', 'node_added', { node: { id: 'n1' } });

    const msg = await client1Promise;
    const parsed = JSON.parse(msg);
    expect(parsed.type).toBe('node_added');
    expect(parsed.workflowId).toBe('wf-1');

    // Give client2 a moment to receive (it shouldn't)
    await new Promise(r => setTimeout(r, 200));
    expect(client2Received).toBe(false);

    client1.close();
    client2.close();
    await new Promise(r => setTimeout(r, 100));
  });
});

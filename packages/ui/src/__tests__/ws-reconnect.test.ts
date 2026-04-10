import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useWsStore } from '../store/ws';

// Mock the api module (required by workflow store)
vi.mock('../lib/api', () => ({
  getWorkflow: vi.fn(),
  updateWorkflow: vi.fn(),
}));

// Mock WebSocket
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  readyState = 1; // OPEN
  sentMessages: string[] = [];

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
    // Simulate async open
    setTimeout(() => this.onopen?.(), 0);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = 3; // CLOSED
  }
}

describe('useWsStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    (globalThis as any).WebSocket = MockWebSocket;
    // Reset store
    useWsStore.setState({ status: 'disconnected', lastError: null });
  });

  afterEach(() => {
    useWsStore.getState().disconnect();
    vi.useRealTimers();
    delete (globalThis as any).WebSocket;
  });

  it('connect sets status to connecting then connected on ack', async () => {
    useWsStore.getState().connect('wf-1');

    expect(useWsStore.getState().status).toBe('connecting');

    // Trigger open
    await vi.advanceTimersByTimeAsync(1);
    const ws = MockWebSocket.instances[0];
    expect(ws).toBeDefined();

    // Should have sent subscribe
    expect(ws.sentMessages).toHaveLength(1);
    expect(JSON.parse(ws.sentMessages[0])).toEqual({
      type: 'subscribe',
      workflowId: 'wf-1',
    });

    // Simulate connected ack from server
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'connected',
        workflowId: '',
        data: { clientCount: 1 },
        timestamp: new Date().toISOString(),
      }),
    });

    expect(useWsStore.getState().status).toBe('connected');
  });

  it('disconnect cleans up and sets status to disconnected', async () => {
    useWsStore.getState().connect('wf-1');
    await vi.advanceTimersByTimeAsync(1);

    useWsStore.getState().disconnect();

    expect(useWsStore.getState().status).toBe('disconnected');
    expect(MockWebSocket.instances[0].readyState).toBe(3); // CLOSED
  });

  it('schedules reconnect on close with exponential backoff', async () => {
    useWsStore.getState().connect('wf-1');
    await vi.advanceTimersByTimeAsync(1);

    const ws1 = MockWebSocket.instances[0];

    // Simulate unexpected close
    ws1.onclose?.();
    expect(useWsStore.getState().status).toBe('disconnected');

    // First reconnect: ~1s + jitter (up to 500ms)
    // Advance past max delay for first attempt
    await vi.advanceTimersByTimeAsync(1600);
    expect(MockWebSocket.instances.length).toBe(2); // Second connection attempt

    const ws2 = MockWebSocket.instances[1];
    ws2.onclose?.();

    // Second reconnect: ~2s + jitter
    await vi.advanceTimersByTimeAsync(2600);
    expect(MockWebSocket.instances.length).toBe(3); // Third connection attempt
  });

  it('resets reconnect attempt counter on successful connect', async () => {
    useWsStore.getState().connect('wf-1');
    await vi.advanceTimersByTimeAsync(1);

    const ws1 = MockWebSocket.instances[0];
    // Simulate connected ack
    ws1.onmessage?.({
      data: JSON.stringify({
        type: 'connected',
        workflowId: '',
        data: { clientCount: 1 },
        timestamp: new Date().toISOString(),
      }),
    });

    // Simulate close after connected
    ws1.onclose?.();

    // Should use attempt 0 delay (~1s), not higher
    await vi.advanceTimersByTimeAsync(1600);
    expect(MockWebSocket.instances.length).toBe(2);
  });

  it('sets lastError on WebSocket error', async () => {
    useWsStore.getState().connect('wf-1');
    await vi.advanceTimersByTimeAsync(1);

    const ws = MockWebSocket.instances[0];
    ws.onerror?.();

    expect(useWsStore.getState().lastError).toBe('WebSocket connection error');
  });
});

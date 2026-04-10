import { describe, it, expect, beforeEach } from 'vitest';
import { useExecutionStore } from '../store/execution';

describe('execution store', () => {
  beforeEach(() => {
    useExecutionStore.getState().clearExecution();
  });

  it('startExecution sets executionId and running status', () => {
    useExecutionStore.getState().startExecution('exec-1');

    const state = useExecutionStore.getState();
    expect(state.executionId).toBe('exec-1');
    expect(state.status).toBe('running');
    expect(state.nodeStatuses).toEqual({});
    expect(state.startedAt).toBeTypeOf('number');
    expect(state.durationMs).toBeNull();
    expect(state.error).toBeNull();
  });

  it('handleNodeExecuted adds node status to map', () => {
    useExecutionStore.getState().startExecution('exec-1');
    useExecutionStore.getState().handleNodeExecuted({
      node_id: 'n1',
      node_name: 'HTTP Request',
      status: 'success',
      duration_ms: 150,
    });

    const state = useExecutionStore.getState();
    expect(state.nodeStatuses['n1']).toEqual(
      expect.objectContaining({
        nodeId: 'n1',
        nodeName: 'HTTP Request',
        status: 'success',
        duration: 150,
      }),
    );
  });

  it('handleNodeExecuted tracks multiple nodes', () => {
    useExecutionStore.getState().startExecution('exec-1');
    useExecutionStore.getState().handleNodeExecuted({
      node_id: 'n1',
      node_name: 'Node 1',
      status: 'success',
      duration_ms: 100,
    });
    useExecutionStore.getState().handleNodeExecuted({
      node_id: 'n2',
      node_name: 'Node 2',
      status: 'error',
      duration_ms: 50,
    });

    const state = useExecutionStore.getState();
    expect(Object.keys(state.nodeStatuses)).toHaveLength(2);
    expect(state.nodeStatuses['n1'].status).toBe('success');
    expect(state.nodeStatuses['n2'].status).toBe('error');
  });

  it('handleExecutionCompleted sets final status and duration', () => {
    useExecutionStore.getState().startExecution('exec-1');
    useExecutionStore.getState().handleExecutionCompleted({
      status: 'success',
      duration_ms: 3200,
    });

    const state = useExecutionStore.getState();
    expect(state.status).toBe('success');
    expect(state.durationMs).toBe(3200);
  });

  it('setFullExecutionData merges full node execution data', () => {
    useExecutionStore.getState().startExecution('exec-1');
    // WS event first (minimal data)
    useExecutionStore.getState().handleNodeExecuted({
      node_id: 'n1',
      node_name: 'HTTP Request',
      status: 'success',
      duration_ms: 150,
    });

    // Then full data from REST response
    useExecutionStore.getState().setFullExecutionData('exec-1', [
      {
        nodeId: 'n1',
        nodeName: 'HTTP Request',
        nodeType: 'http-request',
        status: 'success',
        duration: 150,
        input: { url: 'https://example.com' },
        output: { statusCode: 200 },
      },
    ]);

    const state = useExecutionStore.getState();
    expect(state.nodeStatuses['n1'].input).toEqual({ url: 'https://example.com' });
    expect(state.nodeStatuses['n1'].output).toEqual({ statusCode: 200 });
    expect(state.nodeStatuses['n1'].nodeType).toBe('http-request');
  });

  it('clearExecution resets all state', () => {
    useExecutionStore.getState().startExecution('exec-1');
    useExecutionStore.getState().handleNodeExecuted({
      node_id: 'n1',
      node_name: 'Node 1',
      status: 'success',
      duration_ms: 100,
    });
    useExecutionStore.getState().handleExecutionCompleted({
      status: 'success',
      duration_ms: 500,
    });

    useExecutionStore.getState().clearExecution();

    const state = useExecutionStore.getState();
    expect(state.executionId).toBeNull();
    expect(state.status).toBeNull();
    expect(state.nodeStatuses).toEqual({});
    expect(state.startedAt).toBeNull();
    expect(state.durationMs).toBeNull();
    expect(state.error).toBeNull();
  });
});

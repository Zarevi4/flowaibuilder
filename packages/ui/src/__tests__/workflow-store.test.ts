import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useWorkflowStore } from '../store/workflow';

vi.mock('../lib/api', () => ({
  getWorkflow: vi.fn(),
  updateWorkflow: vi.fn(),
}));

import { getWorkflow, updateWorkflow } from '../lib/api';

const mockGetWorkflow = vi.mocked(getWorkflow);
const mockUpdateWorkflow = vi.mocked(updateWorkflow);

describe('useWorkflowStore', () => {
  beforeEach(() => {
    // Reset the store state between tests
    useWorkflowStore.setState({
      workflow: null,
      nodes: [],
      edges: [],
      loading: false,
      error: null,
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with empty state', () => {
    const state = useWorkflowStore.getState();
    expect(state.workflow).toBeNull();
    expect(state.nodes).toEqual([]);
    expect(state.edges).toEqual([]);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('loadWorkflow fetches and maps workflow data', async () => {
    const mockWf = {
      id: 'w1',
      name: 'Test',
      nodes: [
        {
          id: 'n1',
          type: 'webhook',
          name: 'Hook',
          position: { x: 0, y: 0 },
          data: { label: 'Hook', config: {} },
          createdAt: '',
          updatedAt: '',
        },
      ],
      connections: [
        { id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2' },
      ],
    };

    mockGetWorkflow.mockResolvedValue(mockWf as any);

    await useWorkflowStore.getState().loadWorkflow('w1');

    const state = useWorkflowStore.getState();
    expect(state.workflow).toEqual(mockWf);
    expect(state.nodes).toHaveLength(1);
    expect(state.nodes[0].type).toBe('webhook');
    expect(state.edges).toHaveLength(1);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('loadWorkflow sets error on failure', async () => {
    mockGetWorkflow.mockRejectedValue(new Error('Not found'));

    await useWorkflowStore.getState().loadWorkflow('bad');

    const state = useWorkflowStore.getState();
    expect(state.error).toBe('Not found');
    expect(state.loading).toBe(false);
  });

  it('onNodesChange applies changes', () => {
    useWorkflowStore.setState({
      nodes: [
        { id: 'n1', type: 'webhook', position: { x: 0, y: 0 }, data: {} },
      ],
    });

    useWorkflowStore.getState().onNodesChange([
      { type: 'position', id: 'n1', position: { x: 50, y: 50 } },
    ]);

    const state = useWorkflowStore.getState();
    expect(state.nodes[0].position).toEqual({ x: 50, y: 50 });
  });

  it('updateNodePosition updates workflow nodes and debounces save', async () => {
    vi.useFakeTimers();

    useWorkflowStore.setState({
      workflow: {
        id: 'w1',
        name: 'Test',
        nodes: [
          {
            id: 'n1',
            type: 'webhook',
            name: 'Hook',
            position: { x: 0, y: 0 },
            data: { label: 'Hook', config: {} },
            createdAt: '',
            updatedAt: '',
          },
        ],
        connections: [],
      } as any,
      nodes: [
        { id: 'n1', type: 'webhook', position: { x: 0, y: 0 }, data: {} },
      ],
    });

    mockUpdateWorkflow.mockResolvedValue({} as any);

    useWorkflowStore.getState().updateNodePosition('n1', { x: 100, y: 200 });

    // Workflow should be updated immediately
    const state = useWorkflowStore.getState();
    const updatedNode = state.workflow!.nodes.find((n: any) => n.id === 'n1');
    expect(updatedNode!.position).toEqual({ x: 100, y: 200 });

    // API should not be called yet (debounced)
    expect(mockUpdateWorkflow).not.toHaveBeenCalled();

    // Fast forward 500ms
    vi.advanceTimersByTime(500);

    expect(mockUpdateWorkflow).toHaveBeenCalledWith('w1', expect.objectContaining({
      nodes: expect.arrayContaining([
        expect.objectContaining({ id: 'n1', position: { x: 100, y: 200 } }),
      ]),
    }));

    vi.useRealTimers();
  });
});

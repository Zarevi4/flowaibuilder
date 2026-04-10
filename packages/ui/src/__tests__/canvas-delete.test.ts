import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useWorkflowStore } from '../store/workflow';

vi.mock('../lib/api', () => ({
  getWorkflow: vi.fn(),
  updateWorkflow: vi.fn(),
  updateNode: vi.fn(),
  addNode: vi.fn(),
  deleteNode: vi.fn().mockResolvedValue({ removed: true, node_id: 'n1' }),
  addConnection: vi.fn(),
  deleteConnection: vi.fn(),
}));

describe('Keyboard delete — store-level test', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      workflow: {
        id: 'w1',
        name: 'Test',
        nodes: [
          {
            id: 'n1',
            type: 'webhook' as const,
            name: 'Hook',
            position: { x: 0, y: 0 },
            data: { label: 'Hook', config: {} },
            createdAt: '',
            updatedAt: '',
          },
        ],
        connections: [],
        active: false,
        version: 1,
        createdBy: 'test',
        updatedBy: 'test',
        createdAt: '',
        updatedAt: '',
      },
      nodes: [
        { id: 'n1', type: 'webhook', position: { x: 0, y: 0 }, data: { label: 'Hook' } },
      ],
      edges: [],
      loading: false,
      error: null,
    });
    vi.clearAllMocks();
  });

  it('removeNode removes the node from state (simulates what onNodesDelete triggers)', async () => {
    // This tests that when ReactFlow calls onNodesDelete (via Delete/Backspace),
    // the store removeNode action correctly updates state
    const { removeNode } = useWorkflowStore.getState();
    await removeNode('n1');

    const state = useWorkflowStore.getState();
    expect(state.nodes).toHaveLength(0);
    expect(state.workflow!.nodes).toHaveLength(0);
  });

  it('does not crash when removing a non-existent node', async () => {
    const { removeNode } = useWorkflowStore.getState();
    // Should not throw
    await removeNode('nonexistent');

    // State unchanged
    const state = useWorkflowStore.getState();
    expect(state.nodes).toHaveLength(1);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useWorkflowStore } from '../store/workflow';

vi.mock('../lib/api', () => ({
  getWorkflow: vi.fn(),
  updateWorkflow: vi.fn(),
  updateNode: vi.fn(),
  addNode: vi.fn(),
  deleteNode: vi.fn(),
  addConnection: vi.fn(),
  deleteConnection: vi.fn(),
}));

import { addNode, deleteNode, addConnection } from '../lib/api';

const mockAddNode = vi.mocked(addNode);
const mockDeleteNode = vi.mocked(deleteNode);
const mockAddConnection = vi.mocked(addConnection);

const baseWorkflow = {
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
    {
      id: 'n2',
      type: 'code-js' as const,
      name: 'Code',
      position: { x: 0, y: 150 },
      data: { label: 'Code', config: {} },
      createdAt: '',
      updatedAt: '',
    },
  ],
  connections: [
    { id: 'c1', sourceNodeId: 'n1', targetNodeId: 'n2' },
  ],
  active: false,
  version: 1,
  createdBy: 'test',
  updatedBy: 'test',
  createdAt: '',
  updatedAt: '',
};

describe('Workflow Store — Node/Connection Actions', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      workflow: { ...baseWorkflow },
      nodes: [
        { id: 'n1', type: 'webhook', position: { x: 0, y: 0 }, data: { label: 'Hook' } },
        { id: 'n2', type: 'code-js', position: { x: 0, y: 150 }, data: { label: 'Code' } },
      ],
      edges: [
        { id: 'c1', source: 'n1', target: 'n2' },
      ],
      loading: false,
      error: null,
    });
    vi.clearAllMocks();
  });

  it('addNode calls API without optimistic update', async () => {
    const newNode = {
      id: 'n3', type: 'set', name: 'Set', position: { x: 0, y: 300 },
      data: { label: 'Set', config: {} }, createdAt: '', updatedAt: '',
    };
    mockAddNode.mockResolvedValue({ node: newNode as any, position: { x: 0, y: 300 } });

    await useWorkflowStore.getState().addNode('set', 'Set');

    expect(mockAddNode).toHaveBeenCalledWith('w1', { type: 'set', name: 'Set' });
    // State should NOT have changed (no optimistic update)
    expect(useWorkflowStore.getState().workflow!.nodes).toHaveLength(2);
  });

  it('removeNode optimistically removes node and its connections', async () => {
    mockDeleteNode.mockResolvedValue({ removed: true, node_id: 'n2' });

    await useWorkflowStore.getState().removeNode('n2');

    const state = useWorkflowStore.getState();
    // Node should be removed
    expect(state.workflow!.nodes).toHaveLength(1);
    expect(state.workflow!.nodes[0].id).toBe('n1');
    // Connection should be removed
    expect(state.workflow!.connections).toHaveLength(0);
    // React Flow nodes and edges
    expect(state.nodes).toHaveLength(1);
    expect(state.edges).toHaveLength(0);
    // API called
    expect(mockDeleteNode).toHaveBeenCalledWith('w1', 'n2');
  });

  it('removeNode does nothing when no workflow loaded', async () => {
    useWorkflowStore.setState({ workflow: null });
    await useWorkflowStore.getState().removeNode('n1');
    expect(mockDeleteNode).not.toHaveBeenCalled();
  });

  it('onConnect calls API with correct params', async () => {
    mockAddConnection.mockResolvedValue({
      connection: { id: 'c2', sourceNodeId: 'n1', targetNodeId: 'n2', sourceHandle: 'output-0', targetHandle: 'input-0' },
    });

    await useWorkflowStore.getState().onConnect({
      source: 'n1',
      target: 'n2',
      sourceHandle: 'output-0',
      targetHandle: 'input-0',
    });

    expect(mockAddConnection).toHaveBeenCalledWith('w1', {
      sourceNodeId: 'n1',
      targetNodeId: 'n2',
      sourceHandle: 'output-0',
      targetHandle: 'input-0',
    });
  });

  it('onConnect does nothing with missing source or target', async () => {
    await useWorkflowStore.getState().onConnect({
      source: null as unknown as string,
      target: 'n2',
      sourceHandle: null,
      targetHandle: null,
    });
    expect(mockAddConnection).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useWorkflowStore } from '../store/workflow';

vi.mock('../lib/api', () => ({
  getWorkflow: vi.fn(),
  updateWorkflow: vi.fn(),
  updateNode: vi.fn(),
}));

import { updateNode } from '../lib/api';

const mockUpdateNode = vi.mocked(updateNode);

const makeWorkflow = () => ({
  id: 'w1',
  name: 'Test',
  nodes: [
    {
      id: 'n1',
      type: 'http-request' as const,
      name: 'HTTP Node',
      position: { x: 0, y: 0 },
      data: { label: 'HTTP Node', config: { url: 'https://old.com', method: 'GET' } },
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'n2',
      type: 'code-js' as const,
      name: 'Code Node',
      position: { x: 0, y: 150 },
      data: { label: 'Code Node', config: { code: 'return {}' } },
      createdAt: '',
      updatedAt: '',
    },
  ],
  connections: [],
});

describe('updateNodeConfig', () => {
  beforeEach(() => {
    const wf = makeWorkflow();
    useWorkflowStore.setState({
      workflow: wf as any,
      nodes: wf.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: { ...n.data, name: n.name, nodeType: n.type },
      })),
      edges: [],
      loading: false,
      error: null,
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('optimistically updates both workflow.nodes and React Flow nodes for config changes', () => {
    useWorkflowStore.getState().updateNodeConfig('n1', {
      config: { url: 'https://new.com', method: 'POST' },
    });

    const state = useWorkflowStore.getState();
    // workflow.nodes should be updated
    const wfNode = state.workflow!.nodes.find((n: any) => n.id === 'n1')!;
    expect(wfNode.data.config).toEqual({ url: 'https://new.com', method: 'POST' });

    // React Flow nodes should be updated
    const rfNode = state.nodes.find((n) => n.id === 'n1')!;
    expect(rfNode.data.config).toEqual({ url: 'https://new.com', method: 'POST' });
  });

  it('optimistically updates name in both stores', () => {
    useWorkflowStore.getState().updateNodeConfig('n1', { name: 'My HTTP' });

    const state = useWorkflowStore.getState();
    const wfNode = state.workflow!.nodes.find((n: any) => n.id === 'n1')!;
    expect(wfNode.name).toBe('My HTTP');
    expect(wfNode.data.label).toBe('My HTTP');

    const rfNode = state.nodes.find((n) => n.id === 'n1')!;
    expect(rfNode.data.name).toBe('My HTTP');
    expect(rfNode.data.label).toBe('My HTTP');
  });

  it('debounces server save by 500ms', () => {
    vi.useFakeTimers();
    mockUpdateNode.mockResolvedValue({ updated: true, node_id: 'n1' });

    useWorkflowStore.getState().updateNodeConfig('n1', {
      config: { url: 'https://new.com', method: 'GET' },
    });

    // Not called immediately
    expect(mockUpdateNode).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);

    expect(mockUpdateNode).toHaveBeenCalledWith('w1', 'n1', {
      config: { url: 'https://new.com', method: 'GET' },
    });
  });

  it('does nothing when workflow is null', () => {
    useWorkflowStore.setState({ workflow: null });
    // Should not throw
    useWorkflowStore.getState().updateNodeConfig('n1', { name: 'test' });
    expect(mockUpdateNode).not.toHaveBeenCalled();
  });
});

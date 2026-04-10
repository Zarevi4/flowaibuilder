import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WebSocketMessage } from '@flowaibuilder/shared';
import { useWorkflowStore } from '../store/workflow';

// Mock the api module
vi.mock('../lib/api', () => ({
  getWorkflow: vi.fn(),
  updateWorkflow: vi.fn(),
}));

function makeWorkflow(overrides = {}) {
  return {
    id: 'wf-1',
    name: 'Test Workflow',
    description: '',
    nodes: [
      {
        id: 'n1',
        type: 'webhook' as const,
        name: 'Webhook',
        position: { x: 100, y: 200 },
        data: { label: 'Webhook', config: {} },
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ],
    connections: [
      { id: 'c1', sourceNodeId: 'n1', targetNodeId: 'n2' },
    ],
    active: false,
    version: 1,
    createdBy: 'test',
    updatedBy: 'test',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('applyWsMessage', () => {
  beforeEach(() => {
    const wf = makeWorkflow();
    useWorkflowStore.setState({
      workflow: wf as any,
      nodes: [
        {
          id: 'n1',
          type: 'webhook',
          position: { x: 100, y: 200 },
          data: { label: 'Webhook', config: {}, name: 'Webhook', nodeType: 'webhook' },
        },
      ],
      edges: [
        { id: 'c1', source: 'n1', target: 'n2' },
      ],
      loading: false,
      error: null,
    });
  });

  it('full_sync replaces workflow, nodes, and edges entirely', () => {
    const syncWorkflow = makeWorkflow({
      name: 'Synced',
      nodes: [
        {
          id: 'n10',
          type: 'manual',
          name: 'Manual',
          position: { x: 0, y: 0 },
          data: { label: 'Manual', config: {} },
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
      connections: [],
    });

    const msg: WebSocketMessage = {
      type: 'full_sync',
      workflowId: 'wf-1',
      data: syncWorkflow,
      timestamp: new Date().toISOString(),
    };

    useWorkflowStore.getState().applyWsMessage(msg);

    const state = useWorkflowStore.getState();
    expect(state.workflow!.name).toBe('Synced');
    expect(state.nodes).toHaveLength(1);
    expect(state.nodes[0].id).toBe('n10');
    expect(state.edges).toHaveLength(0);
  });

  it('node_added appends to both workflow.nodes and React Flow nodes', () => {
    const newNode = {
      id: 'n2',
      type: 'code-js' as const,
      name: 'Code',
      position: { x: 300, y: 400 },
      data: { label: 'Code', config: {} },
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    const msg: WebSocketMessage = {
      type: 'node_added',
      workflowId: 'wf-1',
      data: { node: newNode, position: { x: 300, y: 400 } },
      timestamp: new Date().toISOString(),
    };

    useWorkflowStore.getState().applyWsMessage(msg);

    const state = useWorkflowStore.getState();
    expect(state.workflow!.nodes).toHaveLength(2);
    expect(state.nodes).toHaveLength(2);
    expect(state.nodes[1].id).toBe('n2');
    expect(state.nodes[1].position).toEqual({ x: 300, y: 400 });
  });

  it('node_updated merges changes into both arrays', () => {
    const msg: WebSocketMessage = {
      type: 'node_updated',
      workflowId: 'wf-1',
      data: { node_id: 'n1', changes: { position: { x: 500, y: 600 } } },
      timestamp: new Date().toISOString(),
    };

    useWorkflowStore.getState().applyWsMessage(msg);

    const state = useWorkflowStore.getState();
    expect(state.workflow!.nodes[0].position).toEqual({ x: 500, y: 600 });
    expect(state.nodes[0].position).toEqual({ x: 500, y: 600 });
  });

  it('node_updated skips when position matches local state (feedback loop prevention)', () => {
    const msg: WebSocketMessage = {
      type: 'node_updated',
      workflowId: 'wf-1',
      data: { node_id: 'n1', changes: { position: { x: 100, y: 200 } } },
      timestamp: new Date().toISOString(),
    };

    // Store the reference before
    const nodesBefore = useWorkflowStore.getState().nodes;

    useWorkflowStore.getState().applyWsMessage(msg);

    // Position matched, so no update should have occurred
    const nodesAfter = useWorkflowStore.getState().nodes;
    expect(nodesAfter).toBe(nodesBefore);
  });

  it('node_removed removes from both arrays and removes associated edges', () => {
    const msg: WebSocketMessage = {
      type: 'node_removed',
      workflowId: 'wf-1',
      data: { node_id: 'n1' },
      timestamp: new Date().toISOString(),
    };

    useWorkflowStore.getState().applyWsMessage(msg);

    const state = useWorkflowStore.getState();
    expect(state.workflow!.nodes).toHaveLength(0);
    expect(state.nodes).toHaveLength(0);
    // Edge c1 connects n1->n2, so should be removed
    expect(state.workflow!.connections).toHaveLength(0);
    expect(state.edges).toHaveLength(0);
  });

  it('connection_added appends to both connections and edges', () => {
    const msg: WebSocketMessage = {
      type: 'connection_added',
      workflowId: 'wf-1',
      data: { source: 'n1', target: 'n3', id: 'c2' },
      timestamp: new Date().toISOString(),
    };

    useWorkflowStore.getState().applyWsMessage(msg);

    const state = useWorkflowStore.getState();
    expect(state.workflow!.connections).toHaveLength(2);
    expect(state.edges).toHaveLength(2);
    expect(state.edges[1].source).toBe('n1');
    expect(state.edges[1].target).toBe('n3');
  });

  it('connection_removed removes from both arrays', () => {
    const msg: WebSocketMessage = {
      type: 'connection_removed',
      workflowId: 'wf-1',
      data: { connection_id: 'c1' },
      timestamp: new Date().toISOString(),
    };

    useWorkflowStore.getState().applyWsMessage(msg);

    const state = useWorkflowStore.getState();
    expect(state.workflow!.connections).toHaveLength(0);
    expect(state.edges).toHaveLength(0);
  });

  it('workflow_updated updates metadata without touching nodes/connections', () => {
    const msg: WebSocketMessage = {
      type: 'workflow_updated',
      workflowId: 'wf-1',
      data: { name: 'Renamed', description: 'New desc' },
      timestamp: new Date().toISOString(),
    };

    useWorkflowStore.getState().applyWsMessage(msg);

    const state = useWorkflowStore.getState();
    expect(state.workflow!.name).toBe('Renamed');
    expect(state.workflow!.description).toBe('New desc');
    // Nodes and connections should be preserved
    expect(state.workflow!.nodes).toHaveLength(1);
    expect(state.workflow!.connections).toHaveLength(1);
  });

  it('ignores messages for different workflowId', () => {
    const msg: WebSocketMessage = {
      type: 'node_removed',
      workflowId: 'wf-OTHER',
      data: { node_id: 'n1' },
      timestamp: new Date().toISOString(),
    };

    useWorkflowStore.getState().applyWsMessage(msg);

    // n1 should still be there
    const state = useWorkflowStore.getState();
    expect(state.nodes).toHaveLength(1);
  });

  it('ignores messages when no workflow is loaded', () => {
    useWorkflowStore.setState({ workflow: null, nodes: [], edges: [] });

    const msg: WebSocketMessage = {
      type: 'full_sync',
      workflowId: 'wf-1',
      data: makeWorkflow(),
      timestamp: new Date().toISOString(),
    };

    // Should not throw
    useWorkflowStore.getState().applyWsMessage(msg);
    expect(useWorkflowStore.getState().workflow).toBeNull();
  });
});

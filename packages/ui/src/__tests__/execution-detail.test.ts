import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { ExecutionDetail } from '../pages/ExecutionDetail';
import type { Execution, Workflow } from '@flowaibuilder/shared';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', () => ({
  useParams: () => ({ workflowId: 'wf-1', executionId: 'exec-1' }),
  useNavigate: () => mockNavigate,
}));

const mockGetExecution = vi.fn();
const mockGetWorkflow = vi.fn();

vi.mock('../lib/api', () => ({
  getExecution: (...args: unknown[]) => mockGetExecution(...args),
  getWorkflow: (...args: unknown[]) => mockGetWorkflow(...args),
}));

// Mock React Flow since it requires browser APIs not available in jsdom
vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ nodes, onNodeClick, onPaneClick }: {
    nodes: Array<{ id: string; data: { executionStatus?: string; label?: string } }>;
    onNodeClick: (e: unknown, node: { id: string }) => void;
    onPaneClick: () => void;
    [key: string]: unknown;
  }) =>
    createElement('div', { 'data-testid': 'react-flow' },
      nodes.map((n: { id: string; data: { executionStatus?: string; label?: string } }) =>
        createElement('div', {
          key: n.id,
          'data-testid': `node-${n.id}`,
          'data-status': n.data.executionStatus ?? 'none',
          onClick: (e: unknown) => onNodeClick(e, { id: n.id }),
        }, n.data.label ?? n.id),
      ),
      createElement('div', { 'data-testid': 'pane', onClick: onPaneClick }),
    ),
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
}));

vi.mock('../lib/node-registry', () => ({
  nodeTypeMap: {},
}));

vi.mock('lucide-react', () => ({
  ArrowLeft: (props: Record<string, unknown>) => createElement('svg', { 'data-testid': 'arrow-left', ...props }),
  CheckCircle2: (props: Record<string, unknown>) => createElement('svg', { 'data-testid': 'check-circle', ...props }),
  XCircle: (props: Record<string, unknown>) => createElement('svg', { 'data-testid': 'x-circle', ...props }),
  MinusCircle: (props: Record<string, unknown>) => createElement('svg', { 'data-testid': 'minus-circle', ...props }),
  X: (props: Record<string, unknown>) => createElement('svg', { 'data-testid': 'x-icon', ...props }),
  Clock: (props: Record<string, unknown>) => createElement('svg', { 'data-testid': 'clock-icon', ...props }),
}));

function makeWorkflow(): Workflow {
  return {
    id: 'wf-1',
    name: 'Test Workflow',
    description: '',
    nodes: [
      { id: 'n1', type: 'manual', name: 'Start', position: { x: 0, y: 0 }, data: { label: 'Start', config: {} }, createdAt: '', updatedAt: '' },
      { id: 'n2', type: 'http-request', name: 'HTTP', position: { x: 200, y: 0 }, data: { label: 'HTTP', config: {} }, createdAt: '', updatedAt: '' },
    ],
    connections: [{ id: 'c1', sourceNodeId: 'n1', targetNodeId: 'n2' }],
    active: false,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as Workflow;
}

function makeExecution(): Execution {
  return {
    id: 'exec-1',
    workflowId: 'wf-1',
    status: 'error',
    mode: 'manual',
    nodeExecutions: [
      {
        nodeId: 'n1',
        nodeName: 'Start',
        nodeType: 'manual',
        status: 'success',
        duration: 10,
        input: { trigger: 'manual' },
        output: { ok: true },
      },
      {
        nodeId: 'n2',
        nodeName: 'HTTP',
        nodeType: 'http-request',
        status: 'error',
        duration: 340,
        input: { url: 'https://api.example.com' },
        output: null,
        error: 'TypeError: fetch failed\n    at HttpNode.execute (http-request.ts:42)',
      },
    ],
    triggeredBy: 'api',
    startedAt: new Date().toISOString(),
    durationMs: 350,
  };
}

describe('ExecutionDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 6.3: Test ExecutionDetail renders nodes with execution status overlays
  it('renders nodes with execution status overlays', async () => {
    mockGetWorkflow.mockResolvedValue(makeWorkflow());
    mockGetExecution.mockResolvedValue(makeExecution());

    render(createElement(ExecutionDetail));

    await waitFor(() => {
      expect(screen.getByTestId('react-flow')).toBeDefined();
    });

    const node1 = screen.getByTestId('node-n1');
    expect(node1.getAttribute('data-status')).toBe('success');

    const node2 = screen.getByTestId('node-n2');
    expect(node2.getAttribute('data-status')).toBe('error');
  });

  // 6.4: Test ExecutionDetail node click opens NodeTracePanel with input/output/duration
  it('node click opens NodeTracePanel with input/output/duration', async () => {
    mockGetWorkflow.mockResolvedValue(makeWorkflow());
    mockGetExecution.mockResolvedValue(makeExecution());

    render(createElement(ExecutionDetail));

    await waitFor(() => {
      expect(screen.getByTestId('react-flow')).toBeDefined();
    });

    // Click the success node
    fireEvent.click(screen.getByTestId('node-n1'));

    await waitFor(() => {
      // NodeTracePanel should show duration
      expect(screen.getByText('10ms')).toBeDefined();
    });

    // Check input/output JSON displayed
    expect(screen.getByText(/"trigger": "manual"/)).toBeDefined();
    expect(screen.getByText(/"ok": true/)).toBeDefined();
  });

  // 6.5: Test error node displays error message and stack trace in NodeTracePanel
  it('error node shows error message and stack trace in NodeTracePanel', async () => {
    mockGetWorkflow.mockResolvedValue(makeWorkflow());
    mockGetExecution.mockResolvedValue(makeExecution());

    render(createElement(ExecutionDetail));

    await waitFor(() => {
      expect(screen.getByTestId('react-flow')).toBeDefined();
    });

    // Click the error node
    fireEvent.click(screen.getByTestId('node-n2'));

    await waitFor(() => {
      // Check error is displayed
      expect(screen.getByText(/TypeError: fetch failed/)).toBeDefined();
    });
    expect(screen.getByText(/HttpNode\.execute/)).toBeDefined();
    // Duration of the error node
    expect(screen.getByText('340ms')).toBeDefined();
  });

  it('renders execution header with status, duration, mode', async () => {
    mockGetWorkflow.mockResolvedValue(makeWorkflow());
    mockGetExecution.mockResolvedValue(makeExecution());

    render(createElement(ExecutionDetail));

    await waitFor(() => {
      expect(screen.getByText(/Execution exec-1/)).toBeDefined();
    });

    expect(screen.getByText('Duration: 350ms')).toBeDefined();
    expect(screen.getByText('Mode: manual')).toBeDefined();
  });

  it('clicking pane closes NodeTracePanel', async () => {
    mockGetWorkflow.mockResolvedValue(makeWorkflow());
    mockGetExecution.mockResolvedValue(makeExecution());

    render(createElement(ExecutionDetail));

    await waitFor(() => {
      expect(screen.getByTestId('react-flow')).toBeDefined();
    });

    // Click a node to open panel
    fireEvent.click(screen.getByTestId('node-n1'));
    await waitFor(() => {
      expect(screen.getByText('10ms')).toBeDefined();
    });

    // Click pane to close
    fireEvent.click(screen.getByTestId('pane'));

    await waitFor(() => {
      expect(screen.queryByText('10ms')).toBeNull();
    });
  });
});

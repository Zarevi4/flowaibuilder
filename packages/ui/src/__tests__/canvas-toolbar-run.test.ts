import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { CanvasToolbar } from '../components/toolbar/CanvasToolbar';
import { useExecutionStore } from '../store/execution';

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

// Mock workflow store
const mockAddNode = vi.fn().mockResolvedValue(undefined);
vi.mock('../store/workflow', () => ({
  useWorkflowStore: Object.assign(
    vi.fn((selector: (s: unknown) => unknown) =>
      selector({ addNode: mockAddNode, workflow: { id: 'w1' } }),
    ),
    { setState: vi.fn() },
  ),
}));

// Mock execution store - use the real implementation
vi.mock('../store/execution', async () => {
  const actual = await vi.importActual('../store/execution');
  return actual;
});

// Mock api
const mockExecuteWorkflow = vi.fn();
vi.mock('../lib/api', () => ({
  executeWorkflow: (...args: unknown[]) => mockExecuteWorkflow(...args),
}));

// Mock icons
vi.mock('../lib/icons', () => ({
  resolveIcon: vi.fn(() => {
    return function MockIcon(props: Record<string, unknown>) {
      return createElement('svg', { 'data-testid': 'icon', ...props });
    };
  }),
}));

describe('CanvasToolbar Run button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useExecutionStore.getState().clearExecution();
  });

  it('renders Run button', () => {
    render(createElement(CanvasToolbar));
    expect(screen.getByText('Run')).toBeDefined();
  });

  it('calls executeWorkflow on Run click', async () => {
    mockExecuteWorkflow.mockResolvedValue({
      id: 'exec-1',
      nodeExecutions: [],
    });

    render(createElement(CanvasToolbar));
    fireEvent.click(screen.getByText('Run'));

    await waitFor(() => {
      expect(mockExecuteWorkflow).toHaveBeenCalledWith('w1');
    });
  });

  it('shows status indicator after execution completes', async () => {
    mockExecuteWorkflow.mockResolvedValue({
      id: 'exec-1',
      nodeExecutions: [],
    });

    // Simulate execution completed via store
    useExecutionStore.getState().startExecution('exec-1');
    useExecutionStore.getState().handleExecutionCompleted({
      status: 'success',
      duration_ms: 2500,
    });

    render(createElement(CanvasToolbar));
    expect(screen.getByText('2.5s')).toBeDefined();
  });

  it('shows error status after failed execution', () => {
    useExecutionStore.getState().startExecution('exec-1');
    useExecutionStore.getState().handleExecutionCompleted({
      status: 'error',
      duration_ms: 100,
    });

    render(createElement(CanvasToolbar));
    expect(screen.getByText('0.1s')).toBeDefined();
  });

  it('disables Run button while execution is running', () => {
    useExecutionStore.getState().startExecution('exec-1');

    render(createElement(CanvasToolbar));
    const runButton = screen.getByText('Run').closest('button')!;
    expect(runButton.disabled).toBe(true);
    expect(runButton.className).toContain('cursor-not-allowed');
  });

  it('clears execution results on Clear button click', () => {
    useExecutionStore.getState().startExecution('exec-1');
    useExecutionStore.getState().handleExecutionCompleted({
      status: 'success',
      duration_ms: 500,
    });

    render(createElement(CanvasToolbar));
    // The clear button has title "Clear execution results"
    const clearBtn = screen.getByTitle('Clear execution results');
    fireEvent.click(clearBtn);

    expect(useExecutionStore.getState().status).toBeNull();
  });
});

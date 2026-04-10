import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { ExecutionHistory } from '../pages/ExecutionHistory';
import type { Execution } from '@flowaibuilder/shared';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', () => ({
  useParams: () => ({ workflowId: 'wf-1' }),
  useNavigate: () => mockNavigate,
}));

const mockListExecutions = vi.fn();
const mockGetWorkflow = vi.fn();

vi.mock('../lib/api', () => ({
  listExecutions: (...args: unknown[]) => mockListExecutions(...args),
  getWorkflow: (...args: unknown[]) => mockGetWorkflow(...args),
}));

vi.mock('lucide-react', () => ({
  ArrowLeft: (props: Record<string, unknown>) => createElement('svg', { 'data-testid': 'arrow-left', ...props }),
  CheckCircle2: (props: Record<string, unknown>) => createElement('svg', { 'data-testid': 'check-circle', ...props }),
  XCircle: (props: Record<string, unknown>) => createElement('svg', { 'data-testid': 'x-circle', ...props }),
  MinusCircle: (props: Record<string, unknown>) => createElement('svg', { 'data-testid': 'minus-circle', ...props }),
}));

function makeExecution(overrides: Partial<Execution> = {}): Execution {
  return {
    id: 'exec-1',
    workflowId: 'wf-1',
    status: 'success',
    mode: 'manual',
    nodeExecutions: [],
    triggeredBy: 'api',
    startedAt: new Date().toISOString(),
    durationMs: 1200,
    ...overrides,
  };
}

describe('ExecutionHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWorkflow.mockResolvedValue({ id: 'wf-1', name: 'My Workflow', nodes: [], connections: [] });
  });

  // 6.1: Test ExecutionHistory renders execution rows with status, mode, duration, timestamp
  it('renders execution rows with status, mode, duration, timestamp', async () => {
    const exec = makeExecution({ status: 'success', mode: 'manual', durationMs: 1200 });
    mockListExecutions.mockResolvedValue({ executions: [exec] });

    render(createElement(ExecutionHistory));

    await waitFor(() => {
      expect(screen.getByText('success')).toBeDefined();
    });
    expect(screen.getByText('manual')).toBeDefined();
    expect(screen.getByText('1.2s')).toBeDefined();
    expect(screen.getByText('just now')).toBeDefined();
    expect(screen.getByText('api')).toBeDefined();
  });

  // 6.2: Test ExecutionHistory row click navigates to execution detail
  it('row click navigates to execution detail', async () => {
    const exec = makeExecution({ id: 'exec-42' });
    mockListExecutions.mockResolvedValue({ executions: [exec] });

    render(createElement(ExecutionHistory));

    await waitFor(() => {
      expect(screen.getByText('success')).toBeDefined();
    });

    // Click the row
    const row = screen.getByText('success').closest('tr')!;
    fireEvent.click(row);

    expect(mockNavigate).toHaveBeenCalledWith('/editor/wf-1/executions/exec-42');
  });

  // 6.6: Test empty state when no executions exist
  it('shows empty state when no executions', async () => {
    mockListExecutions.mockResolvedValue({ executions: [] });

    render(createElement(ExecutionHistory));

    await waitFor(() => {
      expect(screen.getByText('No executions yet.')).toBeDefined();
    });
    expect(screen.getByText('Run the workflow to see execution history.')).toBeDefined();
  });

  it('renders multiple execution rows with different statuses', async () => {
    const execs = [
      makeExecution({ id: 'e1', status: 'success', mode: 'manual', durationMs: 340 }),
      makeExecution({ id: 'e2', status: 'error', mode: 'webhook', durationMs: 45 }),
    ];
    mockListExecutions.mockResolvedValue({ executions: execs });

    render(createElement(ExecutionHistory));

    await waitFor(() => {
      expect(screen.getByText('success')).toBeDefined();
    });
    expect(screen.getByText('error')).toBeDefined();
    expect(screen.getByText('webhook')).toBeDefined();
    expect(screen.getByText('340ms')).toBeDefined();
    expect(screen.getByText('45ms')).toBeDefined();
  });
});

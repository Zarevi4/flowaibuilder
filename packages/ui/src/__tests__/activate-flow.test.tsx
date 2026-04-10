import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { CanvasToolbar } from '../components/toolbar/CanvasToolbar';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

const mockWorkflow: { id: string; active: boolean; settings: Record<string, unknown> } = {
  id: 'wf-1',
  active: false,
  settings: {},
};

const setStateMock = vi.fn((patch: unknown) => {
  if (typeof patch === 'object' && patch && 'workflow' in patch) {
    Object.assign(mockWorkflow, (patch as { workflow: typeof mockWorkflow }).workflow);
  }
});

vi.mock('../store/workflow', () => ({
  useWorkflowStore: Object.assign(
    (selector: (s: unknown) => unknown) =>
      selector({ addNode: vi.fn(), workflow: mockWorkflow }),
    {
      setState: (patch: unknown) => setStateMock(patch),
      getState: () => ({ workflow: mockWorkflow }),
    },
  ),
}));

vi.mock('../store/execution', () => ({
  useExecutionStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector({ status: null, durationMs: null, clearExecution: () => {} }),
    { getState: () => ({ status: null, setFullExecutionData: () => {}, clearExecution: () => {} }), setState: () => {} },
  ),
}));

vi.mock('../store/ui', () => ({
  useUiStore: (selector: (s: unknown) => unknown) => selector({ jsonPanelOpen: false, toggleJsonPanel: () => {} }),
}));

const activateMock = vi.fn();
vi.mock('../lib/api', () => ({
  executeWorkflow: vi.fn(),
  requestReview: vi.fn(async () => ({ prompt: '' })),
  activateWorkflow: (...args: unknown[]) => activateMock(...args),
  updateWorkflow: vi.fn(async () => ({})),
}));

vi.mock('../lib/icons', () => ({
  resolveIcon: vi.fn(() => () => null),
}));

describe('Activate flow with health-score gate', () => {
  beforeEach(() => {
    activateMock.mockReset();
    setStateMock.mockClear();
    mockWorkflow.active = false;
  });

  it('shows confirmation dialog when health is low and force=true on second call', async () => {
    activateMock
      .mockResolvedValueOnce({
        requiresConfirmation: true,
        healthScore: 30,
        warning: 'Health score is below 50. Activating may deploy a workflow with critical issues.',
        activated: false,
      })
      .mockResolvedValueOnce({ activated: true, healthScore: 30, requiresConfirmation: false, warning: null });

    render(createElement(CanvasToolbar));
    fireEvent.click(screen.getByTestId('activate-button'));

    await waitFor(() => {
      expect(screen.getByTestId('activate-confirm-dialog')).toBeDefined();
    });
    expect(activateMock).toHaveBeenCalledTimes(1);
    expect(activateMock).toHaveBeenLastCalledWith('wf-1', {});

    fireEvent.click(screen.getByTestId('activate-anyway-button'));

    await waitFor(() => {
      expect(activateMock).toHaveBeenCalledTimes(2);
    });
    expect(activateMock).toHaveBeenLastCalledWith('wf-1', { force: true });

    await waitFor(() => {
      expect(setStateMock).toHaveBeenCalledWith(
        expect.objectContaining({ workflow: expect.objectContaining({ active: true }) }),
      );
    });
  });

  it('activates immediately when no confirmation required', async () => {
    activateMock.mockResolvedValueOnce({ activated: true, healthScore: null, requiresConfirmation: false, warning: null });

    render(createElement(CanvasToolbar));
    fireEvent.click(screen.getByTestId('activate-button'));

    await waitFor(() => {
      expect(activateMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByTestId('activate-confirm-dialog')).toBeNull();
  });
});

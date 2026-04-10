import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { CanvasToolbar } from '../components/toolbar/CanvasToolbar';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../store/workflow', () => ({
  useWorkflowStore: Object.assign(
    (selector: (s: unknown) => unknown) =>
      selector({ addNode: vi.fn(), workflow: { id: 'wf-1', nodes: [], settings: {}, active: false } }),
    { setState: vi.fn(), getState: vi.fn(() => ({})) },
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

vi.mock('../lib/api', () => ({
  executeWorkflow: vi.fn(),
  requestReview: vi.fn(),
  activateWorkflow: vi.fn(),
  updateWorkflow: vi.fn(),
  validateWorkflow: vi.fn().mockResolvedValue({ valid: true, issues: [] }),
  importN8nWorkflow: vi.fn().mockResolvedValue({
    workflow: { id: 'wf-new', name: 'Imported', nodes: [], connections: [] },
    warnings: [],
  }),
}));

vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({ setCenter: vi.fn(), getNode: vi.fn() }),
}));

describe('CanvasToolbar — Import n8n', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('file input change calls importN8nWorkflow with parsed JSON', async () => {
    const api = await import('../lib/api');
    render(createElement(CanvasToolbar));

    const input = screen.getByTestId('import-n8n-input') as HTMLInputElement;
    const payload = { nodes: [{ id: 'a', name: 'A', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} }], connections: {} };
    const file = new File([JSON.stringify(payload)], 'wf.json', { type: 'application/json' });
    // jsdom File.text() may not exist; stub it
    Object.defineProperty(file, 'text', {
      value: () => Promise.resolve(JSON.stringify(payload)),
    });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(api.importN8nWorkflow).toHaveBeenCalledTimes(1);
    });
    const call = (api.importN8nWorkflow as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toEqual(payload);
  });

  it('Validate button calls validateWorkflow', async () => {
    const api = await import('../lib/api');
    render(createElement(CanvasToolbar));
    fireEvent.click(screen.getByTestId('validate-button'));
    await waitFor(() => {
      expect(api.validateWorkflow).toHaveBeenCalledWith('wf-1');
    });
  });
});

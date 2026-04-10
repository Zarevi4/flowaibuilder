import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import type { Workflow } from '@flowaibuilder/shared';
import { ExportDialog } from '../components/editor/ExportDialog';

vi.mock('lucide-react', () => ({
  X: (props: Record<string, unknown>) => createElement('svg', { 'data-testid': 'x-icon', ...props }),
  Download: (props: Record<string, unknown>) =>
    createElement('svg', { 'data-testid': 'download-icon', ...props }),
}));

const mockWorkflow: Workflow = {
  id: 'wf-1',
  name: 'Test WF',
  nodes: [],
  connections: [],
  active: true,
  version: 1,
  environment: 'dev',
  createdBy: 'api',
  updatedBy: 'api',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

vi.mock('../store/workflow', () => ({
  useWorkflowStore: (selector: (s: unknown) => unknown) =>
    selector({ workflow: mockWorkflow }),
}));

const exportWorkflowMock = vi.fn();
vi.mock('../lib/api', () => ({
  exportWorkflow: (...args: unknown[]) => exportWorkflowMock(...args),
}));

describe('ExportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    exportWorkflowMock.mockImplementation(async (_id: string, format: string) => ({
      format,
      content: `compiled-${format}`,
      mimeType: 'text/plain',
      filename: `wf.${format}`,
    }));
  });

  it('fetches json by default and renders compiled content', async () => {
    render(createElement(ExportDialog, { open: true, onClose: vi.fn() }));
    await waitFor(() => {
      expect(exportWorkflowMock).toHaveBeenCalledWith('wf-1', 'json', expect.anything());
    });
    await waitFor(() => {
      expect(screen.getByTestId('export-preview').textContent).toContain('compiled-json');
    });
    // No placeholder text
    expect(document.body.textContent).not.toContain('Coming in Epic 4');
    expect(document.body.textContent).not.toContain('coming in Epic 4');
  });

  it('switching format refetches', async () => {
    render(createElement(ExportDialog, { open: true, onClose: vi.fn() }));
    await waitFor(() => expect(exportWorkflowMock).toHaveBeenCalled());
    fireEvent.click(screen.getByText('Mermaid'));
    await waitFor(() => {
      expect(exportWorkflowMock).toHaveBeenCalledWith('wf-1', 'mermaid', expect.anything());
    });
    await waitFor(() => {
      expect(screen.getByTestId('export-preview').textContent).toContain('compiled-mermaid');
    });
  });

  it('Copy uses currently displayed content', async () => {
    render(createElement(ExportDialog, { open: true, onClose: vi.fn() }));
    await waitFor(() =>
      expect(screen.getByTestId('export-preview').textContent).toContain('compiled-json'),
    );
    fireEvent.click(screen.getByText('Copy to Clipboard'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('compiled-json');
  });

  it('Download creates blob URL and triggers download', async () => {
    const createObjectURL = vi.fn(() => 'blob:fake');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });

    render(createElement(ExportDialog, { open: true, onClose: vi.fn() }));
    await waitFor(() =>
      expect(screen.getByTestId('export-preview').textContent).toContain('compiled-json'),
    );
    fireEvent.click(screen.getByText('Download'));
    expect(createObjectURL).toHaveBeenCalled();
  });

  it('does not render when open is false', () => {
    render(createElement(ExportDialog, { open: false, onClose: vi.fn() }));
    expect(screen.queryByTestId('format-selector')).toBeNull();
  });
});

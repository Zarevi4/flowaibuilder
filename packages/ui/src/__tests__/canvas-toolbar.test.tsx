import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { CanvasToolbar } from '../components/toolbar/CanvasToolbar';
import { AddNodeDropdown } from '../components/toolbar/AddNodeDropdown';
import { NODE_CATEGORIES } from '@flowaibuilder/shared';

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

// Mock zustand store
vi.mock('../store/workflow', () => ({
  useWorkflowStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ addNode: mockAddNode, workflow: { id: 'wf-1' } }),
  ),
}));

// Mock execution + ui stores (toolbar reads from them)
vi.mock('../store/execution', () => ({
  useExecutionStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector({
      status: null, durationMs: null, clearExecution: () => {},
    }),
    { getState: () => ({ status: null, setFullExecutionData: () => {}, clearExecution: () => {} }), setState: () => {} },
  ),
}));
vi.mock('../store/ui', () => ({
  useUiStore: (selector: (s: unknown) => unknown) => selector({
    jsonPanelOpen: false,
    toggleJsonPanel: () => {},
  }),
}));

// Mock api (executeWorkflow + requestReview)
vi.mock('../lib/api', () => ({
  executeWorkflow: vi.fn().mockResolvedValue({ id: 'e1', nodeExecutions: [] }),
  requestReview: vi.fn().mockResolvedValue({ prompt: 'Review workflow wf-1.' }),
}));

// Mock icons
vi.mock('../lib/icons', () => ({
  resolveIcon: vi.fn(() => {
    return function MockIcon(props: Record<string, unknown>) {
      return createElement('svg', { 'data-testid': 'icon', ...props });
    };
  }),
}));

const mockAddNode = vi.fn().mockResolvedValue(undefined);

describe('CanvasToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Add Node button', () => {
    render(createElement(CanvasToolbar));
    expect(screen.getByText('Add Node')).toBeDefined();
  });

  it('opens dropdown on click', () => {
    render(createElement(CanvasToolbar));
    fireEvent.click(screen.getByText('Add Node'));

    // Should show category headers
    for (const cat of Object.values(NODE_CATEGORIES)) {
      expect(screen.getByText(cat.label)).toBeDefined();
    }
  });

  it('clicking AI Review button calls requestReview and writes prompt to clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const api = await import('../lib/api');
    render(createElement(CanvasToolbar));
    fireEvent.click(screen.getByTestId('ai-review-button'));
    await waitFor(() => {
      expect(api.requestReview).toHaveBeenCalledWith('wf-1');
      expect(writeText).toHaveBeenCalledWith('Review workflow wf-1.');
      expect(screen.getByTestId('ai-review-status')).toBeDefined();
    });
  });

  it('closes dropdown after selecting a node type', async () => {
    render(createElement(CanvasToolbar));
    fireEvent.click(screen.getByText('Add Node'));

    // Click a node type
    fireEvent.click(screen.getByText('Webhook'));

    expect(mockAddNode).toHaveBeenCalledWith('webhook', 'Webhook');

    // Dropdown should close — category headers should no longer be visible
    await waitFor(() => {
      expect(screen.queryByText('Triggers')).toBeNull();
    });
  });
});

describe('AddNodeDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all category headers', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(createElement(AddNodeDropdown, { onSelect, onClose }));

    for (const cat of Object.values(NODE_CATEGORIES)) {
      expect(screen.getByText(cat.label)).toBeDefined();
    }
  });

  it('calls onSelect with type and label on click', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(createElement(AddNodeDropdown, { onSelect, onClose }));

    fireEvent.click(screen.getByText('HTTP Request'));
    expect(onSelect).toHaveBeenCalledWith('http-request', 'HTTP Request');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on outside click', () => {
    const onClose = vi.fn();
    render(createElement(AddNodeDropdown, { onSelect: vi.fn(), onClose }));

    // Click outside the dropdown
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });
});

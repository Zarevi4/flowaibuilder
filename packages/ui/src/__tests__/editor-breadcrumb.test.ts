import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { Workflow } from '@flowaibuilder/shared';
import { EditorBreadcrumb } from '../components/editor/EditorBreadcrumb';

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) =>
    createElement('a', { href: to }, children),
}));

vi.mock('lucide-react', () => ({
  ArrowLeft: (props: Record<string, unknown>) =>
    createElement('svg', { 'data-testid': 'arrow-left', ...props }),
}));

let mockWorkflow: Workflow | null = null;
let mockReviewState: { healthScore: number | null; annotations: unknown[]; togglePanel: () => void } = {
  healthScore: null,
  annotations: [],
  togglePanel: () => {},
};

vi.mock('../store/workflow', () => ({
  useWorkflowStore: (selector: (s: unknown) => unknown) =>
    selector({ workflow: mockWorkflow }),
}));

vi.mock('../store/review', () => ({
  useReviewStore: (selector: (s: unknown) => unknown) => selector(mockReviewState),
}));

function makeWorkflow(overrides: Partial<Workflow> & { review?: { healthScore?: number } } = {}): Workflow {
  return {
    id: 'wf-1',
    name: 'My Flow',
    nodes: [],
    connections: [],
    active: true,
    version: 1,
    environment: 'dev',
    createdBy: 'api',
    updatedBy: 'api',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Workflow;
}

describe('EditorBreadcrumb', () => {
  beforeEach(() => {
    mockWorkflow = null;
    mockReviewState = { healthScore: null, annotations: [], togglePanel: () => {} };
  });

  it('renders workflow name, dev environment badge, and — when no review exists', () => {
    mockWorkflow = makeWorkflow();
    render(createElement(EditorBreadcrumb));
    expect(screen.getByTestId('wf-name').textContent).toBe('My Flow');
    expect(screen.getByTestId('env-badge').textContent).toBe('dev');
    expect(screen.getByTestId('health-pill').textContent).toBe('—');
  });

  it('renders health score from useReviewStore when set (new data source)', () => {
    mockWorkflow = makeWorkflow();
    mockReviewState = { healthScore: 88, annotations: [], togglePanel: () => {} };
    render(createElement(EditorBreadcrumb));
    const pill = screen.getByTestId('health-pill');
    expect(pill.textContent).toBe('88');
    expect(pill.className).toContain('text-amber-300');
  });

  it('annotation counter badge hidden when zero and visible with counts', () => {
    mockWorkflow = makeWorkflow();
    // zero state
    mockReviewState = { healthScore: 90, annotations: [], togglePanel: () => {} };
    const { unmount } = render(createElement(EditorBreadcrumb));
    expect(screen.queryByTestId('annotation-counter')).toBeNull();
    unmount();

    mockReviewState = {
      healthScore: 90,
      annotations: [
        { id: 'a1', severity: 'error', status: 'active' },
        { id: 'a2', severity: 'warning', status: 'active' },
        { id: 'a3', severity: 'suggestion', status: 'active' },
      ],
      togglePanel: () => {},
    };
    render(createElement(EditorBreadcrumb));
    const counter = screen.getByTestId('annotation-counter');
    expect(counter.textContent).toBe('3');
    expect(counter.getAttribute('title')).toContain('1 errors');
  });

  it('renders color-coded health score for 90, 75, 60, 40', () => {
    const cases: Array<[number, string]> = [
      [90, 'text-green-400'],
      [75, 'text-amber-300'],
      [60, 'text-orange-300'],
      [40, 'text-red-400'],
    ];
    for (const [score, expectedClass] of cases) {
      mockWorkflow = makeWorkflow();
      mockReviewState = { healthScore: score, annotations: [], togglePanel: () => {} };
      const { unmount } = render(createElement(EditorBreadcrumb));
      const pill = screen.getByTestId('health-pill');
      expect(pill.textContent).toBe(String(score));
      expect(pill.className).toContain(expectedClass);
      unmount();
    }
  });
});

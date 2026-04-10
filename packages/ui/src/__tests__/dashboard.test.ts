import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { Dashboard } from '../pages/Dashboard';
import type { Workflow } from '@flowaibuilder/shared';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useSearchParams: () => [new URLSearchParams()],
  Link: ({ children, to }: { children: React.ReactNode; to: string }) =>
    createElement('a', { href: to }, children),
}));

const mockListWorkflows = vi.fn();
const mockCreateWorkflow = vi.fn();
const mockDeleteWorkflow = vi.fn();

vi.mock('../lib/api', () => ({
  listWorkflows: (...args: unknown[]) => mockListWorkflows(...args),
  createWorkflow: (...args: unknown[]) => mockCreateWorkflow(...args),
  deleteWorkflow: (...args: unknown[]) => mockDeleteWorkflow(...args),
  listTeams: () => Promise.resolve({ teams: [] }),
  listTemplates: () => Promise.resolve({ templates: [] }),
  launchTeam: vi.fn(),
}));

vi.mock('lucide-react', () => ({
  Plus: (props: Record<string, unknown>) => createElement('svg', { 'data-testid': 'plus-icon', ...props }),
  Trash2: (props: Record<string, unknown>) => createElement('svg', { 'data-testid': 'trash-icon', ...props }),
  Zap: (props: Record<string, unknown>) => createElement('svg', { 'data-testid': 'zap-icon', ...props }),
  Users: (props: Record<string, unknown>) => createElement('svg', { 'data-testid': 'users-icon', ...props }),
  Rocket: (props: Record<string, unknown>) => createElement('svg', { 'data-testid': 'rocket-icon', ...props }),
  ListChecks: (props: Record<string, unknown>) => createElement('svg', { 'data-testid': 'listchecks-icon', ...props }),
  X: (props: Record<string, unknown>) => createElement('svg', { 'data-testid': 'x-icon', ...props }),
}));

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: 'wf-1',
    name: 'Test Workflow',
    description: 'A test workflow',
    nodes: [{ id: 'n1', type: 'manual', name: 'Start', config: {}, disabled: false }],
    connections: [],
    active: true,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Workflow;
}

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListWorkflows.mockResolvedValue({ workflows: [] });
  });

  it('renders loading skeleton cards initially', () => {
    mockListWorkflows.mockReturnValue(new Promise(() => {})); // never resolves
    render(createElement(Dashboard));
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBe(3);
  });

  it('renders empty state when no workflows', async () => {
    mockListWorkflows.mockResolvedValue({ workflows: [] });
    render(createElement(Dashboard));
    await waitFor(() => {
      expect(screen.getByText('No workflows yet')).toBeDefined();
    });
    expect(screen.getByText('Create your first workflow')).toBeDefined();
  });

  it('renders workflow cards with name, status badge, node count, modified date', async () => {
    const wf = makeWorkflow({ name: 'My Flow', active: true, version: 3 });
    mockListWorkflows.mockResolvedValue({ workflows: [wf] });
    render(createElement(Dashboard));

    await waitFor(() => {
      expect(screen.getByText('My Flow')).toBeDefined();
    });
    expect(screen.getByText('Active')).toBeDefined();
    expect(screen.getByText('1 nodes')).toBeDefined();
    expect(screen.getByText('v3')).toBeDefined();
    expect(screen.getByText('just now')).toBeDefined();
  });

  it('renders inactive badge for inactive workflow', async () => {
    const wf = makeWorkflow({ active: false });
    mockListWorkflows.mockResolvedValue({ workflows: [wf] });
    render(createElement(Dashboard));

    await waitFor(() => {
      expect(screen.getByText('Inactive')).toBeDefined();
    });
  });

  it('New Workflow button calls createWorkflow and navigates to editor', async () => {
    const newWf = makeWorkflow({ id: 'new-123' });
    mockCreateWorkflow.mockResolvedValue(newWf);
    mockListWorkflows.mockResolvedValue({ workflows: [] });

    render(createElement(Dashboard));
    await waitFor(() => {
      expect(screen.getByText('No workflows yet')).toBeDefined();
    });

    // Click the header "New Workflow" button
    const buttons = screen.getAllByText(/New Workflow/);
    fireEvent.click(buttons[0]);

    await waitFor(() => {
      expect(mockCreateWorkflow).toHaveBeenCalledWith('Untitled Workflow');
      expect(mockNavigate).toHaveBeenCalledWith('/editor/new-123');
    });
  });

  it('shows error when createWorkflow fails', async () => {
    mockCreateWorkflow.mockRejectedValue(new Error('Server error'));
    mockListWorkflows.mockResolvedValue({ workflows: [makeWorkflow()] });

    render(createElement(Dashboard));
    await waitFor(() => {
      expect(screen.getByText('Test Workflow')).toBeDefined();
    });

    fireEvent.click(screen.getByText('New Workflow'));

    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeDefined();
    });
  });

  it('delete flow: click delete -> shows confirm dialog -> confirm -> calls deleteWorkflow -> card removed', async () => {
    const wf = makeWorkflow({ name: 'Delete Me' });
    mockListWorkflows.mockResolvedValue({ workflows: [wf] });
    mockDeleteWorkflow.mockResolvedValue({ deleted: true, id: wf.id });

    render(createElement(Dashboard));
    await waitFor(() => {
      expect(screen.getByText('Delete Me')).toBeDefined();
    });

    // Click delete button
    const deleteBtn = screen.getByLabelText('Delete Delete Me');
    fireEvent.click(deleteBtn);

    // Confirm dialog shows
    expect(screen.getByText('Delete Delete Me?')).toBeDefined();
    expect(screen.getByText('This action cannot be undone.')).toBeDefined();

    // Click confirm
    fireEvent.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(mockDeleteWorkflow).toHaveBeenCalledWith(wf.id);
    });

    // Card should be removed, empty state shown
    await waitFor(() => {
      expect(screen.queryByText('Delete Me')).toBeNull();
    });
  });

  it('cancel delete keeps card visible', async () => {
    const wf = makeWorkflow({ name: 'Keep Me' });
    mockListWorkflows.mockResolvedValue({ workflows: [wf] });

    render(createElement(Dashboard));
    await waitFor(() => {
      expect(screen.getByText('Keep Me')).toBeDefined();
    });

    fireEvent.click(screen.getByLabelText('Delete Keep Me'));
    expect(screen.getByText('Delete Keep Me?')).toBeDefined();

    fireEvent.click(screen.getByText('Cancel'));

    // Dialog gone, card still there
    expect(screen.queryByText('Delete Keep Me?')).toBeNull();
    expect(screen.getByText('Keep Me')).toBeDefined();
  });
});

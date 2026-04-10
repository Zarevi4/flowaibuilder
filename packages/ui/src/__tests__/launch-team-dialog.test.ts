import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createElement } from 'react';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('../lib/api', () => ({
  listTemplates: vi.fn().mockResolvedValue({
    templates: [
      {
        id: 'webhook-pipeline',
        name: 'Webhook Pipeline',
        description: 'A 3-agent team',
        agents: [
          { name: 'api-builder', role: 'Builds APIs' },
          { name: 'logic-builder', role: 'Builds logic' },
          { name: 'reviewer', role: 'Reviews' },
        ],
        tasks: [
          { title: 'Task 1', assignee: 'api-builder', status: 'unassigned' },
          { title: 'Task 2', assignee: 'logic-builder', status: 'unassigned' },
        ],
      },
    ],
  }),
  launchTeam: vi.fn().mockResolvedValue({
    teamName: 'my-team', agents: [], tasks: [], progress: 0, watchedSince: '',
  }),
}));

import { LaunchTeamDialog } from '../components/agent-teams/LaunchTeamDialog';
import { launchTeam } from '../lib/api';

describe('LaunchTeamDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders template cards when open', async () => {
    render(createElement(LaunchTeamDialog, { open: true, onClose: vi.fn() }));

    await waitFor(() => {
      expect(screen.getByText('Webhook Pipeline')).toBeTruthy();
    });
  });

  it('shows agent count and task count', async () => {
    render(createElement(LaunchTeamDialog, { open: true, onClose: vi.fn() }));

    await waitFor(() => {
      expect(screen.getByText('3 agents')).toBeTruthy();
      expect(screen.getByText('2 tasks')).toBeTruthy();
    });
  });

  it('renders agent role pills', async () => {
    render(createElement(LaunchTeamDialog, { open: true, onClose: vi.fn() }));

    await waitFor(() => {
      expect(screen.getByText('api-builder')).toBeTruthy();
      expect(screen.getByText('logic-builder')).toBeTruthy();
      expect(screen.getByText('reviewer')).toBeTruthy();
    });
  });

  it('validates team name rejects invalid characters', async () => {
    render(createElement(LaunchTeamDialog, { open: true, onClose: vi.fn() }));

    await waitFor(() => {
      expect(screen.getByText('Webhook Pipeline')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Webhook Pipeline'));

    const input = screen.getByPlaceholderText('my-team');
    fireEvent.change(input, { target: { value: '../evil' } });

    fireEvent.click(screen.getByText('Launch'));

    await waitFor(() => {
      expect(screen.getByText(/Must not contain/)).toBeTruthy();
    });
  });

  it('calls launchTeam API and navigates on success', async () => {
    const onClose = vi.fn();
    render(createElement(LaunchTeamDialog, { open: true, onClose }));

    await waitFor(() => {
      expect(screen.getByText('Webhook Pipeline')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Webhook Pipeline'));

    const input = screen.getByPlaceholderText('my-team');
    fireEvent.change(input, { target: { value: 'test-team' } });

    fireEvent.click(screen.getByText('Launch'));

    await waitFor(() => {
      expect(vi.mocked(launchTeam)).toHaveBeenCalledWith('webhook-pipeline', 'test-team');
      expect(mockNavigate).toHaveBeenCalledWith('/teams/test-team');
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('does not render when closed', () => {
    const { container } = render(createElement(LaunchTeamDialog, { open: false, onClose: vi.fn() }));
    expect(container.innerHTML).toBe('');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import type { TeamSnapshot } from '@flowaibuilder/shared';
import { useTeamStore } from '../store/teams';

const mockGetTeamSnapshot = vi.fn();
const mockGetTeamMessages = vi.fn();

vi.mock('../lib/api', () => ({
  getTeamSnapshot: (...args: unknown[]) => mockGetTeamSnapshot(...args),
  getTeamMessages: (...args: unknown[]) => mockGetTeamMessages(...args),
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ teamName: 'test-team' }),
}));

vi.mock('../store/ws', () => ({
  useWsStore: (selector?: (state: unknown) => unknown) => {
    const state = {
      connectGlobal: vi.fn(),
      disconnect: vi.fn(),
    };
    return selector ? selector(state) : state;
  },
}));

// Import after mocks
import { TeamDashboard } from '../pages/TeamDashboard';

vi.mock('lucide-react', () => ({
  Users: (props: Record<string, unknown>) => createElement('svg', { 'data-testid': 'users-icon', ...props }),
  CheckCircle: (props: Record<string, unknown>) => createElement('svg', { 'data-testid': 'check-icon', ...props }),
  MessageSquare: (props: Record<string, unknown>) => createElement('svg', { 'data-testid': 'msg-icon', ...props }),
}));

function makeSnapshot(): TeamSnapshot {
  return {
    teamName: 'test-team',
    agents: [
      { name: 'agent-1', status: 'active', currentTask: 't1', completedCount: 2, recentMessages: [] },
      { name: 'agent-2', status: 'idle', currentTask: null, completedCount: 0, recentMessages: [] },
    ],
    tasks: [
      { id: 't1', title: 'Build API', status: 'in-progress', assignee: 'agent-1', createdAt: '', updatedAt: '' },
      { id: 't2', title: 'Write docs', status: 'done', assignee: 'agent-1', createdAt: '', updatedAt: '' },
      { id: 't3', title: 'Deploy', status: 'unassigned', assignee: null, createdAt: '', updatedAt: '' },
    ],
    progress: 33,
    watchedSince: '2026-03-28T00:00:00Z',
  };
}

describe('TeamDashboard page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTeamStore.getState().clearTeam();
  });

  it('renders loading state initially', () => {
    mockGetTeamSnapshot.mockReturnValue(new Promise(() => {})); // never resolves
    mockGetTeamMessages.mockReturnValue(new Promise(() => {}));
    render(createElement(TeamDashboard));
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('renders all sections with test data', async () => {
    const snap = makeSnapshot();
    mockGetTeamSnapshot.mockResolvedValue(snap);
    mockGetTeamMessages.mockResolvedValue({
      messages: [
        { id: 'm1', from: 'agent-1', to: 'agent-2', message: 'Status update', timestamp: '2026-03-28T10:00:00Z', read: false },
      ],
    });

    render(createElement(TeamDashboard));

    await waitFor(() => {
      // TeamHeader
      expect(screen.getByText('test-team')).toBeDefined();
      expect(screen.getByText('2 agents')).toBeDefined();
      expect(screen.getByText('33%')).toBeDefined();
    });

    // AgentCards (agent names also appear in TaskBoard assignee labels)
    expect(screen.getAllByText('agent-1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('agent-2').length).toBeGreaterThan(0);

    // TaskBoard (Build API also in AgentCard)
    expect(screen.getAllByText('Build API').length).toBeGreaterThan(0);
    expect(screen.getByText('Write docs')).toBeDefined();
    expect(screen.getByText('Deploy')).toBeDefined();

    // MessageFeed
    expect(screen.getByText('Status update')).toBeDefined();
  });

  it('renders error state', async () => {
    mockGetTeamSnapshot.mockRejectedValue(new Error('Team not found'));
    mockGetTeamMessages.mockRejectedValue(new Error('Team not found'));

    render(createElement(TeamDashboard));

    await waitFor(() => {
      expect(screen.getByText('Team not found')).toBeDefined();
    });
  });
});

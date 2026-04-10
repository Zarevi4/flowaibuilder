import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTeamStore } from '../store/teams';
import type { TeamSnapshot, WebSocketMessage } from '@flowaibuilder/shared';

const mockGetTeamSnapshot = vi.fn();
const mockGetTeamMessages = vi.fn();

vi.mock('../lib/api', () => ({
  getTeamSnapshot: (...args: unknown[]) => mockGetTeamSnapshot(...args),
  getTeamMessages: (...args: unknown[]) => mockGetTeamMessages(...args),
}));

function makeSnapshot(teamName = 'alpha'): TeamSnapshot {
  return {
    teamName,
    agents: [
      { name: 'agent-1', status: 'active', currentTask: 't1', completedCount: 2, recentMessages: [] },
    ],
    tasks: [
      { id: 't1', title: 'Task 1', status: 'in-progress', assignee: 'agent-1', createdAt: '', updatedAt: '' },
      { id: 't2', title: 'Task 2', status: 'done', assignee: 'agent-1', createdAt: '', updatedAt: '' },
    ],
    progress: 50,
    watchedSince: '2026-03-28T00:00:00Z',
  };
}

describe('useTeamStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTeamStore.getState().clearTeam();
  });

  it('loadTeam populates state from API', async () => {
    const snap = makeSnapshot();
    mockGetTeamSnapshot.mockResolvedValue(snap);
    mockGetTeamMessages.mockResolvedValue({
      messages: [{ id: 'm1', from: 'a', to: 'b', message: 'Hi', timestamp: '2026-03-28T10:00:00Z', read: false }],
    });

    await useTeamStore.getState().loadTeam('alpha');

    const state = useTeamStore.getState();
    expect(state.teamName).toBe('alpha');
    expect(state.snapshot?.teamName).toBe('alpha');
    expect(state.messages).toHaveLength(1);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('loadTeam sets error on failure', async () => {
    mockGetTeamSnapshot.mockRejectedValue(new Error('Network fail'));
    mockGetTeamMessages.mockRejectedValue(new Error('Network fail'));

    await useTeamStore.getState().loadTeam('alpha');

    const state = useTeamStore.getState();
    expect(state.error).toBe('Network fail');
    expect(state.loading).toBe(false);
  });

  it('clearTeam resets all state', async () => {
    const snap = makeSnapshot();
    mockGetTeamSnapshot.mockResolvedValue(snap);
    mockGetTeamMessages.mockResolvedValue({ messages: [] });

    await useTeamStore.getState().loadTeam('alpha');
    expect(useTeamStore.getState().teamName).toBe('alpha');

    useTeamStore.getState().clearTeam();

    const state = useTeamStore.getState();
    expect(state.teamName).toBeNull();
    expect(state.snapshot).toBeNull();
    expect(state.messages).toHaveLength(0);
  });

  describe('applyWsMessage', () => {
    beforeEach(async () => {
      const snap = makeSnapshot();
      mockGetTeamSnapshot.mockResolvedValue(snap);
      mockGetTeamMessages.mockResolvedValue({ messages: [] });
      await useTeamStore.getState().loadTeam('alpha');
    });

    it('team_tasks_updated updates tasks and progress', () => {
      const msg: WebSocketMessage = {
        type: 'team_tasks_updated',
        workflowId: '',
        data: {
          teamName: 'alpha',
          tasks: [{ id: 't1', title: 'Task 1', status: 'done', assignee: 'agent-1', createdAt: '', updatedAt: '' }],
          progress: 100,
        },
        timestamp: new Date().toISOString(),
      };

      useTeamStore.getState().applyWsMessage(msg);

      const state = useTeamStore.getState();
      expect(state.snapshot!.progress).toBe(100);
      expect(state.snapshot!.tasks[0].status).toBe('done');
    });

    it('agent_messages_updated merges messages', () => {
      const msg: WebSocketMessage = {
        type: 'agent_messages_updated',
        workflowId: '',
        data: {
          teamName: 'alpha',
          agentName: 'agent-1',
          messages: [{ id: 'm1', from: 'agent-2', message: 'Hello', timestamp: '2026-03-28T10:00:00Z', read: false }],
        },
        timestamp: new Date().toISOString(),
      };

      useTeamStore.getState().applyWsMessage(msg);

      const state = useTeamStore.getState();
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0].to).toBe('agent-1');
    });

    it('team_watch_stopped clears state', () => {
      const msg: WebSocketMessage = {
        type: 'team_watch_stopped',
        workflowId: '',
        data: { teamName: 'alpha' },
        timestamp: new Date().toISOString(),
      };

      useTeamStore.getState().applyWsMessage(msg);

      const state = useTeamStore.getState();
      expect(state.teamName).toBeNull();
      expect(state.snapshot).toBeNull();
      expect(state.error).toBe('Team is no longer being watched');
    });

    it('ignores events for different team', () => {
      const msg: WebSocketMessage = {
        type: 'team_tasks_updated',
        workflowId: '',
        data: { teamName: 'other-team', tasks: [], progress: 0 },
        timestamp: new Date().toISOString(),
      };

      useTeamStore.getState().applyWsMessage(msg);

      // Should not change alpha's snapshot
      expect(useTeamStore.getState().snapshot!.progress).toBe(50);
    });
  });
});

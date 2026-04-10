import { create } from 'zustand';
import type { TeamSnapshot, InboxMessage, WebSocketMessage } from '@flowaibuilder/shared';
import { watchTeam, getTeamMessages } from '../lib/api';

interface DashboardMessage extends InboxMessage {
  to: string;
}

interface TeamState {
  teamName: string | null;
  snapshot: TeamSnapshot | null;
  messages: DashboardMessage[];
  loading: boolean;
  error: string | null;
  loadTeam: (teamName: string) => Promise<void>;
  applyWsMessage: (msg: WebSocketMessage) => void;
  clearTeam: () => void;
}

export const useTeamStore = create<TeamState>()((set, get) => ({
  teamName: null,
  snapshot: null,
  messages: [],
  loading: false,
  error: null,

  loadTeam: async (teamName: string) => {
    set({ loading: true, error: null, teamName });
    try {
      // Watch first (idempotent — re-watches if already watched)
      const snapshot = await watchTeam(teamName);
      // Only apply if we're still viewing this team (user may have navigated away)
      if (get().teamName !== teamName) return;
      set({ snapshot });

      // Then load messages
      try {
        const { messages } = await getTeamMessages(teamName);
        if (get().teamName === teamName) {
          set({ messages, loading: false });
        }
      } catch {
        // Messages may fail if no inboxes — that's fine
        if (get().teamName === teamName) {
          set({ loading: false });
        }
      }
    } catch (err) {
      if (get().teamName === teamName) {
        set({
          error: err instanceof Error ? err.message : 'Failed to load team',
          loading: false,
        });
      }
    }
  },

  applyWsMessage: (msg: WebSocketMessage) => {
    const state = get();

    // Guard against null/non-object data
    if (!msg.data || typeof msg.data !== 'object') return;
    const data = msg.data as Record<string, unknown>;
    const eventTeamName = data.teamName as string | undefined;

    // Only apply events for the currently viewed team
    if (eventTeamName && eventTeamName !== state.teamName) return;

    switch (msg.type) {
      case 'team_watch_started': {
        const snapshot = data.snapshot as TeamSnapshot | undefined;
        if (snapshot) {
          set({ snapshot, loading: false });
        }
        break;
      }
      case 'team_tasks_updated': {
        const tasks = data.tasks as TeamSnapshot['tasks'];
        const progress = data.progress as number;
        if (state.snapshot) {
          set({
            snapshot: { ...state.snapshot, tasks, progress },
          });
        }
        break;
      }
      case 'agent_messages_updated': {
        const agentName = data.agentName as string;
        const newMessages = data.messages as InboxMessage[];
        // Replace all messages for this agent, add `to` field
        const otherMessages = state.messages.filter(m => m.to !== agentName);
        const withTo: DashboardMessage[] = newMessages.map(m => ({ ...m, to: agentName }));
        const merged = [...otherMessages, ...withTo].sort(
          (a, b) => a.timestamp.localeCompare(b.timestamp),
        );

        // Single set() to avoid double re-render
        if (state.snapshot) {
          const agents = state.snapshot.agents.map(a =>
            a.name === agentName ? { ...a, recentMessages: newMessages.slice(-5) } : a,
          );
          set({ messages: merged, snapshot: { ...state.snapshot, agents } });
        } else {
          set({ messages: merged });
        }
        break;
      }
      case 'team_watch_stopped': {
        if (eventTeamName === state.teamName) {
          set({ teamName: null, snapshot: null, messages: [], error: 'Team is no longer being watched' });
        }
        break;
      }
      case 'task_linked_to_node':
        // Informational — used in Story 6.4
        break;
    }
  },

  clearTeam: () => {
    set({ teamName: null, snapshot: null, messages: [], loading: false, error: null });
  },
}));

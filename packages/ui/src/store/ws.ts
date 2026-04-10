import { create } from 'zustand';
import type { WebSocketMessage } from '@flowaibuilder/shared';
import { useWorkflowStore } from './workflow';
import { useExecutionStore } from './execution';
import { useTeamStore } from './teams';
import { useReviewStore } from './review';

type WsStatus = 'connecting' | 'connected' | 'disconnected';

interface WsState {
  status: WsStatus;
  lastError: string | null;
  connectGlobal: () => void;
  connect: (workflowId: string) => void;
  disconnect: () => void;
}

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
const MAX_RECONNECT_ATTEMPTS = 20;
// Use a sentinel to distinguish "global connection" from "no connection".
// null = not connected, '__global__' = global (team events only), other = workflow-specific.
let currentWorkflowId: string | null = null;

// RAF batching for rapid WS messages
let pendingMessages: WebSocketMessage[] = [];
let rafId: number | null = null;

function flushMessages() {
  rafId = null;
  const messages = pendingMessages;
  pendingMessages = [];
  if (messages.length === 0) return;
  // Apply all queued messages in a single set() via batch reducer
  useWorkflowStore.getState().applyWsMessages(messages);
}

function queueMessage(msg: WebSocketMessage) {
  pendingMessages.push(msg);
  if (rafId === null) {
    rafId = requestAnimationFrame(flushMessages);
  }
}

function getWsUrl(): string {
  const envUrl = import.meta.env.VITE_WS_URL;
  if (envUrl) return envUrl;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

function clearReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

export const useWsStore = create<WsState>()((set, get) => ({
  status: 'disconnected',
  lastError: null,

  connectGlobal: () => {
    // Connect without subscribing to a specific workflow — receives broadcast events (team events)
    get().connect('__global__');
  },

  connect: (workflowId: string) => {
    // Disconnect existing connection first
    get().disconnect();

    currentWorkflowId = workflowId;
    reconnectAttempt = 0;

    function openConnection() {
      set({ status: 'connecting', lastError: null });

      const ws = new WebSocket(getWsUrl());
      socket = ws;

      ws.onopen = () => {
        // Send subscribe message (global connections send empty workflowId)
        const subscribeId = currentWorkflowId === '__global__' ? '' : currentWorkflowId;
        ws.send(JSON.stringify({ type: 'subscribe', workflowId: subscribeId }));
      };

      ws.onmessage = (event) => {
        try {
          const msg: WebSocketMessage = JSON.parse(event.data);

          if (msg.type === 'connected') {
            set({ status: 'connected' });
            reconnectAttempt = 0;
            return;
          }

          // full_sync applied immediately (restore canvas on reconnect)
          if (msg.type === 'full_sync') {
            useWorkflowStore.getState().applyWsMessage(msg);
            return;
          }

          // Execution events applied immediately (no RAF batching) for real-time feedback
          if (msg.type === 'execution_started' || msg.type === 'node_executed' || msg.type === 'execution_completed') {
            const execStore = useExecutionStore.getState();
            const data = msg.data as Record<string, unknown>;
            if (msg.type === 'execution_started') {
              execStore.startExecution(data.execution_id as string);
            } else {
              // Ignore events from a different execution
              if (execStore.executionId && data.execution_id && data.execution_id !== execStore.executionId) return;
              if (msg.type === 'node_executed') {
                execStore.handleNodeExecuted(data as { node_id: string; node_name: string; status: import('@flowaibuilder/shared').ExecutionStatus; duration_ms: number });
              } else {
                execStore.handleExecutionCompleted(data as { status: import('@flowaibuilder/shared').ExecutionStatus; duration_ms: number });
              }
            }
            return;
          }

          // Route annotation/review events to review store (apply immediately)
          const annotationEventTypes: string[] = [
            'annotation_added',
            'annotation_applied',
            'annotations_updated',
            'review_completed',
          ];
          if (annotationEventTypes.includes(msg.type)) {
            useReviewStore.getState().applyWsMessage(msg);
            return;
          }
          if (msg.type === 'review_requested') {
            const data = msg.data as { trigger?: string; context_type?: string; workflow_id?: string };
            // eslint-disable-next-line no-console
            console.debug('[review-trigger]', data?.trigger ?? 'manual', data?.context_type ?? 'general', data?.workflow_id);
            // Signal intended for MCP clients, ignored by UI
            return;
          }

          // Route team events to team store (apply immediately, no batching)
          const teamEventTypes: string[] = ['agent_messages_updated', 'team_tasks_updated',
            'team_watch_started', 'team_watch_stopped', 'task_linked_to_node'];
          if (teamEventTypes.includes(msg.type)) {
            useTeamStore.getState().applyWsMessage(msg);
            // Also route task_linked_to_node and team_tasks_updated to workflow store
            // so canvas can update agent badges and building indicators
            const t = msg.type as string;
            if (t === 'task_linked_to_node' || t === 'team_tasks_updated') {
              queueMessage(msg);
            }
            return;
          }

          // Batch incremental updates via RAF to prevent glitching
          queueMessage(msg);
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        set({ status: 'disconnected' });
        socket = null;

        // Clear stuck execution state — execution_completed may never arrive
        const execStore = useExecutionStore.getState();
        if (execStore.status === 'running') {
          execStore.clearExecution();
        }

        // Auto-reconnect if we haven't been explicitly disconnected
        if (currentWorkflowId) {
          scheduleReconnect();
        }
      };

      ws.onerror = () => {
        set({ status: 'disconnected', lastError: 'WebSocket connection error' });
        // onclose will fire after onerror, which handles reconnect
      };
    }

    function scheduleReconnect() {
      clearReconnect();
      if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
        set({ lastError: 'Max reconnect attempts reached. Refresh to retry.' });
        return;
      }
      const jitter = Math.random() * 500;
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempt) + jitter, 16000);
      reconnectAttempt++;
      reconnectTimer = setTimeout(openConnection, delay);
    }

    openConnection();
  },

  disconnect: () => {
    currentWorkflowId = null;
    clearReconnect();
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
      pendingMessages = [];
    }
    if (socket) {
      socket.onclose = null; // Prevent auto-reconnect
      socket.onerror = null;
      socket.close();
      socket = null;
    }
    set({ status: 'disconnected', lastError: null });
  },
}));

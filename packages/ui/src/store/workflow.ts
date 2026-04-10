import { create } from 'zustand';
import type { Node, Edge, NodeChange, EdgeChange } from '@xyflow/react';
import { applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import type { Workflow, WebSocketMessage, ProtectedZone } from '@flowaibuilder/shared';
import type { Connection as RFConnection } from '@xyflow/react';
import { getWorkflow, updateWorkflow, updateNode, addNode as apiAddNode, deleteNode as apiDeleteNode, addConnection as apiAddConnection, getTaskLinks, requestReview, getZones } from '../lib/api';
import type { TaskLinkInfo } from '../lib/api';
import { toReactFlowNode, toReactFlowEdge, toReactFlowNodes, toReactFlowEdges } from '../lib/mappers';

interface WorkflowState {
  workflow: Workflow | null;
  nodes: Node[];
  edges: Edge[];
  taskLinks: TaskLinkInfo[];
  zones: ProtectedZone[];
  loading: boolean;
  error: string | null;
  fitViewCounter: number;
  loadWorkflow: (id: string) => Promise<void>;
  loadTaskLinks: (workflowId: string) => Promise<void>;
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  updateNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  updateNodeConfig: (nodeId: string, changes: { name?: string; config?: Record<string, unknown> }) => void;
  addNode: (type: string, name: string) => Promise<void>;
  removeNode: (nodeId: string) => Promise<void>;
  onConnect: (connection: RFConnection) => Promise<void>;
  applyWsMessage: (msg: WebSocketMessage) => void;
  applyWsMessages: (msgs: WebSocketMessage[]) => void;
}

let saveTimeout: ReturnType<typeof setTimeout> | null = null;
const configSaveTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
let loadRequestId = 0;

// Story 2.4 AC#2: continuous review debounce
export const continuousReviewDebounceMs = 2000;
let continuousReviewTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleContinuousReview(workflowId: string): void {
  if (continuousReviewTimer) clearTimeout(continuousReviewTimer);
  continuousReviewTimer = setTimeout(() => {
    continuousReviewTimer = null;
    requestReview(workflowId, { trigger: 'continuous', context_type: 'on-edit' }).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[continuous-review] failed:', err);
    });
  }, continuousReviewDebounceMs);
}

export function cancelContinuousReview(): void {
  if (continuousReviewTimer) {
    clearTimeout(continuousReviewTimer);
    continuousReviewTimer = null;
  }
}

function maybeScheduleContinuousReview(workflow: Workflow | null): void {
  if (!workflow) return;
  const settings = workflow.settings as Record<string, unknown> | undefined;
  if (settings?.continuousReviewEnabled === true) {
    scheduleContinuousReview(workflow.id);
  }
}

/** Cancel all pending debounce timers. Called on workflow unload. */
export function cancelPendingSaves() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  for (const t of configSaveTimeouts.values()) clearTimeout(t);
  configSaveTimeouts.clear();
  cancelContinuousReview();
}

export const useWorkflowStore = create<WorkflowState>()((set, get) => ({
  workflow: null,
  nodes: [],
  edges: [],
  taskLinks: [],
  zones: [],
  loading: false,
  error: null,
  fitViewCounter: 0,

  loadWorkflow: async (id: string) => {
    // Cancel any pending saves from previous workflow
    cancelPendingSaves();
    const requestId = ++loadRequestId;
    set({ loading: true, error: null, workflow: null, nodes: [], edges: [], taskLinks: [], zones: [] });
    try {
      const workflow = await getWorkflow(id);
      // Discard stale response if another load was initiated
      if (requestId !== loadRequestId) return;
      set({
        workflow,
        nodes: toReactFlowNodes(workflow.nodes ?? []),
        edges: toReactFlowEdges(workflow.connections ?? []),
        loading: false,
      });
      // Initial zones load (non-blocking failure ok)
      try {
        const { zones } = await getZones(id);
        if (requestId === loadRequestId) set({ zones });
      } catch {
        // canvas still works without zones
      }
    } catch (err) {
      if (requestId !== loadRequestId) return;
      set({
        error: err instanceof Error ? err.message : 'Failed to load workflow',
        loading: false,
      });
    }
  },

  loadTaskLinks: async (workflowId: string) => {
    try {
      const { links } = await getTaskLinks(workflowId);
      set({ taskLinks: links });
    } catch {
      // Non-critical — canvas still works without task links
    }
  },

  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),

  onNodesChange: (changes) => {
    set((state) => ({
      nodes: applyNodeChanges(changes, state.nodes),
    }));
  },

  onEdgesChange: (changes) => {
    set((state) => ({
      edges: applyEdgeChanges(changes, state.edges),
    }));
  },

  updateNodePosition: (nodeId, position) => {
    const { workflow, nodes } = get();
    if (!workflow) return;

    // Update the workflow nodes with new position
    const updatedWorkflowNodes = (workflow.nodes ?? []).map((n) =>
      n.id === nodeId ? { ...n, position } : n,
    );

    set({
      workflow: { ...workflow, nodes: updatedWorkflowNodes },
    });

    // Debounced save to server
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      updateWorkflow(workflow.id, { nodes: updatedWorkflowNodes }).catch(
        console.error,
      );
    }, 500);
    maybeScheduleContinuousReview(workflow);
  },

  updateNodeConfig: (nodeId, changes) => {
    const { workflow, nodes } = get();
    if (!workflow) return;

    // Optimistic local update
    const updatedWfNodes = (workflow.nodes ?? []).map((n) => {
      if (n.id !== nodeId) return n;
      const updated = { ...n };
      if (changes.name !== undefined) { updated.name = changes.name; updated.data = { ...updated.data, label: changes.name }; }
      if (changes.config !== undefined) { updated.data = { ...updated.data, config: changes.config }; }
      return updated;
    });
    const updatedRfNodes = nodes.map((n) => {
      if (n.id !== nodeId) return n;
      const updated = { ...n, data: { ...n.data } };
      if (changes.name !== undefined) { updated.data.name = changes.name; updated.data.label = changes.name; }
      if (changes.config !== undefined) { updated.data.config = changes.config; }
      return updated;
    });

    set({
      workflow: { ...workflow, nodes: updatedWfNodes },
      nodes: updatedRfNodes,
    });

    // Per-node debounced save to server (P9: prevents cross-node cancellation)
    const existing = configSaveTimeouts.get(nodeId);
    if (existing) clearTimeout(existing);
    configSaveTimeouts.set(nodeId, setTimeout(() => {
      configSaveTimeouts.delete(nodeId);
      updateNode(workflow.id, nodeId, changes).catch(console.error);
    }, 500));
    maybeScheduleContinuousReview(workflow);
  },

  addNode: async (type, name) => {
    const { workflow } = get();
    if (!workflow) return;
    // No optimistic update — let the WS broadcast add the node to state
    try {
      await apiAddNode(workflow.id, { type, name });
      maybeScheduleContinuousReview(workflow);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to add node' });
    }
  },

  removeNode: async (nodeId) => {
    const { workflow } = get();
    if (!workflow) return;
    // Optimistic removal (applying twice via WS is harmless — filter is idempotent)
    const filteredWfNodes = (workflow.nodes ?? []).filter((n) => n.id !== nodeId);
    const filteredWfConns = (workflow.connections ?? []).filter(
      (c) => c.sourceNodeId !== nodeId && c.targetNodeId !== nodeId,
    );
    const filteredRfNodes = get().nodes.filter((n) => n.id !== nodeId);
    const filteredRfEdges = get().edges.filter(
      (e) => e.source !== nodeId && e.target !== nodeId,
    );
    set({
      workflow: { ...workflow, nodes: filteredWfNodes, connections: filteredWfConns },
      nodes: filteredRfNodes,
      edges: filteredRfEdges,
    });
    try {
      await apiDeleteNode(workflow.id, nodeId);
      maybeScheduleContinuousReview(workflow);
    } catch (err) {
      // D1: No rollback — WS full_sync on reconnect will recover correct state
      set({ error: err instanceof Error ? err.message : 'Failed to delete node' });
    }
  },

  onConnect: async (connection) => {
    const { workflow } = get();
    if (!workflow) return;
    if (!connection.source || !connection.target) return;
    // No optimistic update — let the WS broadcast add the connection
    try {
      await apiAddConnection(workflow.id, {
        sourceNodeId: connection.source,
        targetNodeId: connection.target,
        sourceHandle: connection.sourceHandle ?? undefined,
        targetHandle: connection.targetHandle ?? undefined,
      });
      maybeScheduleContinuousReview(workflow);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to create connection' });
    }
  },

  applyWsMessage: (msg: WebSocketMessage) => {
    const state = get();
    const next = reduceWsMessage(state, msg);
    if (next !== state) set(next as WorkflowState);
  },

  applyWsMessages: (msgs: WebSocketMessage[]) => {
    // Apply all messages in a single set() call to avoid N re-renders
    let state: WsReducerState = get();
    for (const msg of msgs) {
      state = reduceWsMessage(state, msg);
    }
    set(state as WorkflowState);
  },
}));

type WsReducerState = Pick<WorkflowState, 'workflow' | 'nodes' | 'edges' | 'fitViewCounter' | 'taskLinks' | 'zones'>;

/** Pure reducer: applies a single WS message to state, returns new state (or same ref if no-op). */
function reduceWsMessage(state: WsReducerState, msg: WebSocketMessage): WsReducerState {
  const { workflow, nodes, edges } = state;
  if (!workflow) return state;

  // Filter: only process messages for the current workflow
  if (msg.workflowId && msg.workflowId !== workflow.id) return state;

  const data = msg.data as Record<string, unknown>;

  switch (msg.type) {
    case 'full_sync': {
      const syncedWorkflow = data as unknown as Workflow;
      return {
        workflow: syncedWorkflow,
        nodes: toReactFlowNodes(syncedWorkflow.nodes ?? []),
        edges: toReactFlowEdges(syncedWorkflow.connections ?? []),
        taskLinks: state.taskLinks,
        zones: state.zones,
        fitViewCounter: state.fitViewCounter + 1,
      };
    }

    case 'zone_created': {
      const zone = data.zone as ProtectedZone;
      if (state.zones.some((z) => z.id === zone.id)) return state;
      return { ...state, zones: [...state.zones, zone] };
    }

    case 'zone_updated': {
      const zone = data.zone as ProtectedZone;
      return { ...state, zones: state.zones.map((z) => (z.id === zone.id ? zone : z)) };
    }

    case 'zone_deleted': {
      const zoneId = data.zone_id as string;
      const next = state.zones.filter((z) => z.id !== zoneId);
      if (next.length === state.zones.length) return state;
      return { ...state, zones: next };
    }

    case 'node_added': {
      const newNode = data.node as Workflow['nodes'][0];
      // P1: Guard against duplicate node_added messages (reconnect replays)
      if ((workflow.nodes ?? []).some((n) => n.id === newNode.id)) return state;
      const updatedWfNodes = [...(workflow.nodes ?? []), newNode];
      const updatedRfNodes = [...nodes, toReactFlowNode(newNode)];
      return {
        ...state,
        workflow: { ...workflow, nodes: updatedWfNodes },
        nodes: updatedRfNodes,
      };
    }

    case 'node_updated': {
      const nodeId = data.node_id as string;
      // Support both formats: nested { changes: {...} } and flat { name, config, ... }
      const changes = (data.changes ?? (() => { const { node_id: _nid, ...rest } = data; return rest; })()) as Partial<Workflow['nodes'][0]>;

      // Skip if position matches local state (feedback loop prevention)
      if (changes.position) {
        const localNode = nodes.find((n) => n.id === nodeId);
        if (
          localNode &&
          localNode.position.x === changes.position.x &&
          localNode.position.y === changes.position.y
        ) {
          return state;
        }
      }

      const updatedWfNodes = (workflow.nodes ?? []).map((n) =>
        n.id === nodeId ? { ...n, ...changes } : n,
      );
      const updatedRfNodes = nodes.map((n) => {
        if (n.id !== nodeId) return n;
        const merged = { ...n };
        if (changes.position) merged.position = changes.position;
        if (changes.data) merged.data = { ...n.data, ...changes.data };
        if (changes.name) merged.data = { ...merged.data, name: changes.name };
        return merged;
      });
      return {
        ...state,
        workflow: { ...workflow, nodes: updatedWfNodes },
        nodes: updatedRfNodes,
      };
    }

    case 'node_removed': {
      const removedId = data.node_id as string;
      const filteredWfNodes = (workflow.nodes ?? []).filter((n) => n.id !== removedId);
      const filteredRfNodes = nodes.filter((n) => n.id !== removedId);
      const filteredWfConns = (workflow.connections ?? []).filter(
        (c) => c.sourceNodeId !== removedId && c.targetNodeId !== removedId,
      );
      const filteredRfEdges = edges.filter(
        (e) => e.source !== removedId && e.target !== removedId,
      );
      return {
        ...state,
        workflow: { ...workflow, nodes: filteredWfNodes, connections: filteredWfConns },
        nodes: filteredRfNodes,
        edges: filteredRfEdges,
      };
    }

    case 'connection_added': {
      const conn = (data.connection ?? data) as Record<string, unknown>;
      const source = (conn.sourceNodeId ?? conn.source) as string;
      const target = (conn.targetNodeId ?? conn.target) as string;
      // P8: Use nullish coalescing to avoid "undefined" string from `as string ||`
      const connId = (conn.id as string | undefined) ?? `${source}-${target}`;
      // P2: Guard against duplicate connection_added messages
      if ((workflow.connections ?? []).some((c) => c.id === connId)) return state;
      const newConn = {
        id: connId,
        sourceNodeId: source,
        targetNodeId: target,
        sourceHandle: conn.sourceHandle as string | undefined,
        targetHandle: conn.targetHandle as string | undefined,
      };
      return {
        ...state,
        workflow: {
          ...workflow,
          connections: [...(workflow.connections ?? []), newConn],
        },
        edges: [...edges, toReactFlowEdge(newConn)],
      };
    }

    case 'connection_removed': {
      const connIdToRemove = data.connection_id as string | undefined;
      const srcToRemove = (data.source_node_id ?? data.source) as string | undefined;
      const tgtToRemove = (data.target_node_id ?? data.target) as string | undefined;
      const filteredConns = (workflow.connections ?? []).filter((c) => {
        if (connIdToRemove && c.id === connIdToRemove) return false;
        if (srcToRemove && tgtToRemove && c.sourceNodeId === srcToRemove && c.targetNodeId === tgtToRemove) return false;
        return true;
      });
      const filteredEdges = edges.filter((e) => {
        if (connIdToRemove && e.id === connIdToRemove) return false;
        if (srcToRemove && tgtToRemove && e.source === srcToRemove && e.target === tgtToRemove) return false;
        return true;
      });
      return {
        ...state,
        workflow: { ...workflow, connections: filteredConns },
        edges: filteredEdges,
      };
    }

    case 'workflow_updated': {
      const updates = data as Partial<Workflow>;
      return {
        ...state,
        workflow: { ...workflow, ...updates, nodes: workflow.nodes, connections: workflow.connections },
      };
    }

    case 'task_linked_to_node': {
      const linkData = data as { teamName: string; taskId: string; nodeId: string; assignee?: string | null; taskStatus?: string; taskTitle?: string };
      const newLink: TaskLinkInfo = {
        taskId: linkData.taskId,
        nodeId: linkData.nodeId,
        teamName: linkData.teamName,
        assignee: linkData.assignee ?? null,
        taskStatus: linkData.taskStatus ?? 'unknown',
        taskTitle: linkData.taskTitle ?? '',
      };
      return {
        ...state,
        taskLinks: [...state.taskLinks, newLink],
      };
    }

    case 'team_tasks_updated': {
      const teamName = data.teamName as string;
      const tasks = data.tasks as Array<{ id: string; status: string; assignee: string | null; title: string }>;
      if (!tasks || state.taskLinks.length === 0) return state;
      const taskMap = new Map(tasks.map(t => [t.id, t]));
      let changed = false;
      const updatedLinks = state.taskLinks.map(link => {
        if (link.teamName !== teamName) return link;
        const task = taskMap.get(link.taskId);
        if (!task) return link;
        if (link.taskStatus === task.status && link.assignee === task.assignee && link.taskTitle === task.title) return link;
        changed = true;
        return { ...link, taskStatus: task.status, assignee: task.assignee, taskTitle: task.title };
      });
      return changed ? { ...state, taskLinks: updatedLinks } : state;
    }

    default:
      return state;
  }
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  type OnNodeDrag,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useWorkflowStore } from '../../store/workflow';
import { useExecutionStore } from '../../store/execution';
import { useUiStore } from '../../store/ui';
import { nodeTypeMap } from '../../lib/node-registry';
import { NODE_TYPES } from '@flowaibuilder/shared';
import { ReactFlowAnnotationLayer } from './review/ReactFlowAnnotationLayer';
import { ReviewPanel } from './review/ReviewPanel';
import { ZoneLayer } from './zones/ZoneLayer';
import { CanvasContextMenu, type ContextMenuState } from './zones/ContextMenu';
import {
  applyPinnedFlag,
  buildNodeMenuLabels,
  buildPaneMenuLabels,
  buildZoneMenuLabels,
  sanitizeZoneName,
} from './zones/helpers';
import {
  createZone as apiCreateZone,
  deleteZone as apiDeleteZone,
  renameZone as apiRenameZone,
  removeNodesFromZone as apiRemoveNodesFromZone,
} from '../../lib/api';
import type { ProtectedZone } from '@flowaibuilder/shared';
import type { Connection } from '@xyflow/react';

/** Triggers fitView when full_sync increments the counter. Must be inside <ReactFlow>. */
function FitViewOnSync() {
  const fitViewCounter = useWorkflowStore((s) => s.fitViewCounter);
  const { fitView } = useReactFlow();
  const prevCounter = useRef(fitViewCounter);

  useEffect(() => {
    if (fitViewCounter !== prevCounter.current) {
      prevCounter.current = fitViewCounter;
      requestAnimationFrame(() => fitView({ duration: 200 }));
    }
  }, [fitViewCounter, fitView]);

  return null;
}

const AGENT_COLORS = [
  'bg-teal-500', 'bg-orange-500', 'bg-amber-500', 'bg-violet-500',
  'bg-rose-500', 'bg-cyan-500', 'bg-lime-500', 'bg-sky-500',
];

export function agentColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length];
}


export function Canvas() {
  const rawNodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const taskLinks = useWorkflowStore((s) => s.taskLinks);
  const zones = useWorkflowStore((s) => s.zones);
  const workflow = useWorkflowStore((s) => s.workflow);
  const nodeStatuses = useExecutionStore((s) => s.nodeStatuses);

  // Story 3.2: derive set of pinned node ids from zones
  const pinnedNodeIds = useMemo(() => {
    const set = new Set<string>();
    for (const z of zones) for (const id of z.nodeIds) set.add(id);
    return set;
  }, [zones]);

  // Map nodeId -> the zone it belongs to (first match)
  const nodeIdToZone = useMemo(() => {
    const map = new Map<string, ProtectedZone>();
    for (const z of zones) for (const id of z.nodeIds) if (!map.has(id)) map.set(id, z);
    return map;
  }, [zones]);

  const [menuState, setMenuState] = useState<ContextMenuState | null>(null);
  const setError = useCallback((message: string) => {
    useWorkflowStore.setState({ error: message });
  }, []);

  // Build task-link lookup map
  const taskLinkMap = useMemo(() => {
    const map = new Map<string, (typeof taskLinks)[0]>();
    for (const link of taskLinks) {
      map.set(link.nodeId, link);
    }
    return map;
  }, [taskLinks]);

  // Merge execution status, task-link data, and zone-pinned data into node data for BaseNode overlay rendering
  const nodes = useMemo(
    () =>
      rawNodes.map((n) => {
        const execStatus = nodeStatuses[n.id]?.status ?? null;
        const taskLink = taskLinkMap.get(n.id);
        const isPinned = pinnedNodeIds.has(n.id);
        if (!execStatus && !taskLink && !isPinned) return n;
        const merged = {
          ...n,
          data: {
            ...n.data,
            executionStatus: execStatus ?? undefined,
            linkedAgent: taskLink?.assignee ?? undefined,
            linkedTaskStatus: taskLink?.taskStatus ?? undefined,
            linkedTaskTitle: taskLink?.taskTitle ?? undefined,
          },
        };
        // applyPinnedFlag sets draggable:false, deletable:false, data.pinned:true.
        return applyPinnedFlag(merged, isPinned);
      }),
    [rawNodes, nodeStatuses, taskLinkMap, pinnedNodeIds],
  );
  const onNodesChange = useWorkflowStore((s) => s.onNodesChange);
  const onEdgesChange = useWorkflowStore((s) => s.onEdgesChange);
  const updateNodePosition = useWorkflowStore((s) => s.updateNodePosition);
  const removeNode = useWorkflowStore((s) => s.removeNode);
  const storeOnConnect = useWorkflowStore((s) => s.onConnect);

  const selectNode = useUiStore((s) => s.selectNode);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: { id: string }) => {
      selectNode(node.id);
    },
    [selectNode],
  );

  const handlePaneClick = useCallback(() => {
    selectNode(null);
  }, [selectNode]);

  const onNodeDragStop: OnNodeDrag = useCallback(
    (_event, node) => {
      // Multi-select drag bypass guard: React Flow will move pinned nodes when they're
      // part of a selection led by a non-pinned node. Skip persistence for pinned ids.
      if (pinnedNodeIds.has(node.id)) return;
      updateNodePosition(node.id, node.position);
    },
    [updateNodePosition, pinnedNodeIds],
  );

  const handleNodesDelete = useCallback(
    (deletedNodes: { id: string }[]) => {
      for (const node of deletedNodes) {
        // Pinned nodes carry deletable:false, so React Flow should not deliver them here.
        // Defense-in-depth: skip if it ever does, surface an error to the user.
        if (pinnedNodeIds.has(node.id)) {
          useWorkflowStore.setState({ error: 'Cannot delete a node inside a protected zone' });
          continue;
        }
        removeNode(node.id);
        // If the deleted node was selected, close sidebar
        if (useUiStore.getState().selectedNodeId === node.id) {
          selectNode(null);
        }
      }
    },
    [removeNode, selectNode, pinnedNodeIds],
  );

  const handleConnect = useCallback(
    (params: Connection) => {
      storeOnConnect(params);
    },
    [storeOnConnect],
  );

  // ─── Story 3.2: Zone context-menu helpers ────────────────
  const closeMenu = useCallback(() => setMenuState(null), []);

  const promptCreateZoneFor = useCallback(
    (nodeIds: string[]) => {
      if (!workflow || nodeIds.length === 0) return;
      // Don't pin a node that's already in another zone (server now rejects too).
      const filtered = nodeIds.filter((id) => !pinnedNodeIds.has(id));
      if (filtered.length === 0) return;
      const cleaned = sanitizeZoneName(window.prompt('Zone name'));
      if (!cleaned) return;
      apiCreateZone(workflow.id, { name: cleaned, nodeIds: filtered }).catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to create zone');
      });
    },
    [workflow, setError, pinnedNodeIds],
  );

  const removeNodeFromItsZone = useCallback(
    (nodeId: string) => {
      if (!workflow) return;
      const z = nodeIdToZone.get(nodeId);
      if (!z) return;
      apiRemoveNodesFromZone(workflow.id, z.id, [nodeId]).catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to remove from zone');
      });
    },
    [workflow, nodeIdToZone, setError],
  );

  const unpinZone = useCallback(
    (zone: ProtectedZone) => {
      if (!workflow) return;
      apiDeleteZone(workflow.id, zone.id).catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to unpin zone');
      });
    },
    [workflow, setError],
  );

  const renameZone = useCallback(
    (zone: ProtectedZone) => {
      if (!workflow) return;
      const cleaned = sanitizeZoneName(window.prompt('New zone name', zone.name));
      if (!cleaned || cleaned === zone.name) return;
      apiRenameZone(workflow.id, zone.id, cleaned).catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to rename zone');
      });
    },
    [workflow, setError],
  );

  const handleNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: { id: string }) => {
      event.preventDefault();
      const isPinned = pinnedNodeIds.has(node.id);
      // Selected ids — if the right-clicked node is part of selection use the whole selection
      const selectedIds = rawNodes.filter((n) => n.selected).map((n) => n.id);
      const targetIds = selectedIds.includes(node.id) && selectedIds.length > 0 ? selectedIds : [node.id];
      const labels = buildNodeMenuLabels(isPinned);
      setMenuState({
        x: event.clientX,
        y: event.clientY,
        items: isPinned
          ? [{ label: labels[0], onSelect: () => removeNodeFromItsZone(node.id) }]
          : [{ label: labels[0], onSelect: () => promptCreateZoneFor(targetIds) }],
      });
    },
    [pinnedNodeIds, rawNodes, removeNodeFromItsZone, promptCreateZoneFor],
  );

  const handlePaneContextMenu = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      event.preventDefault();
      const selectedIds = rawNodes.filter((n) => n.selected).map((n) => n.id);
      if (selectedIds.length === 0) {
        setMenuState(null);
        return;
      }
      const me = event as React.MouseEvent;
      setMenuState({
        x: me.clientX,
        y: me.clientY,
        items: [
          {
            label: buildPaneMenuLabels()[0],
            onSelect: () => promptCreateZoneFor(selectedIds),
          },
        ],
      });
    },
    [rawNodes, promptCreateZoneFor],
  );

  const handleZoneContextMenu = useCallback(
    (event: React.MouseEvent, zone: ProtectedZone) => {
      const labels = buildZoneMenuLabels();
      setMenuState({
        x: event.clientX,
        y: event.clientY,
        items: [
          { label: labels[0], onSelect: () => unpinZone(zone) },
          { label: labels[1], onSelect: () => renameZone(zone) },
        ],
      });
    },
    [unpinZone, renameZone],
  );

  const miniMapNodeColor = useCallback((node: { type?: string }) => {
    const meta = node.type ? NODE_TYPES[node.type] : null;
    return meta?.color ?? '#888';
  }, []);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypeMap}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={onNodeDragStop}
      onNodeClick={handleNodeClick}
      onPaneClick={handlePaneClick}
      onNodesDelete={handleNodesDelete}
      onConnect={handleConnect}
      onNodeContextMenu={handleNodeContextMenu}
      onPaneContextMenu={handlePaneContextMenu}
      deleteKeyCode={['Delete', 'Backspace']}
      fitView
      className="bg-gray-950"
    >
      <Background color="#374151" gap={20} />
      <Controls />
      <MiniMap
        style={{ background: '#111827' }}
        nodeColor={miniMapNodeColor}
      />
      <FitViewOnSync />
      <ZoneLayer onZoneContextMenu={handleZoneContextMenu} />
      <ReactFlowAnnotationLayer />
      <ReviewPanel />
      <CanvasContextMenu state={menuState} onClose={closeMenu} />
    </ReactFlow>
  );
}

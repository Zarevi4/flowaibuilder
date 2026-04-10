import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowLeft, CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
import type { Execution, Workflow, ExecutionStatus, NodeExecutionData } from '@flowaibuilder/shared';
import { NODE_TYPES } from '@flowaibuilder/shared';
import { getExecution, getWorkflow } from '../lib/api';
import { timeAgo, formatDuration } from '../lib/utils';
import { nodeTypeMap } from '../lib/node-registry';
import { NodeTracePanel } from '../components/execution/NodeTracePanel';

function getNodeStyle(status?: ExecutionStatus) {
  switch (status) {
    case 'success':
      return { borderColor: '#22c55e', borderWidth: 2, borderStyle: 'solid' as const };
    case 'error':
      return { borderColor: '#ef4444', borderWidth: 2, borderStyle: 'solid' as const, backgroundColor: 'rgba(239, 68, 68, 0.1)' };
    case 'cancelled':
      return { borderColor: '#6b7280', borderWidth: 2, borderStyle: 'solid' as const, opacity: 0.6 };
    case 'running':
      return { borderColor: '#3b82f6', borderWidth: 2, borderStyle: 'solid' as const };
    case 'pending':
      return { borderColor: '#6b7280', borderWidth: 1, borderStyle: 'solid' as const, opacity: 0.4 };
    default:
      return { borderColor: '#374151', borderWidth: 1, borderStyle: 'dashed' as const, opacity: 0.5 };
  }
}

function StatusIcon({ status }: { status: ExecutionStatus }) {
  switch (status) {
    case 'success':
      return <CheckCircle2 size={16} className="text-green-400" />;
    case 'error':
      return <XCircle size={16} className="text-red-400" />;
    default:
      return <MinusCircle size={16} className="text-gray-400" />;
  }
}

export function ExecutionDetail() {
  const { workflowId, executionId } = useParams<{ workflowId: string; executionId: string }>();
  const navigate = useNavigate();
  const [execution, setExecution] = useState<Execution | null>(null);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workflowId || !executionId) {
      setError('Missing workflow or execution id');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setSelectedNodeId(null);
    // Fetch execution first (required); workflow is best-effort so a deleted
    // workflow still lets the user inspect trace data via the panel.
    getExecution(workflowId, executionId)
      .then((exec) => {
        setExecution(exec);
        return getWorkflow(workflowId).then(
          (wf) => setWorkflow(wf),
          () => setWorkflow(null), // workflow deleted — degrade gracefully
        );
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load execution'))
      .finally(() => setLoading(false));
  }, [workflowId, executionId]);

  // Build nodeExecution lookup
  const nodeExecMap = useMemo(() => {
    const map = new Map<string, NodeExecutionData>();
    if (execution) {
      for (const ne of execution.nodeExecutions) {
        map.set(ne.nodeId, ne);
      }
    }
    return map;
  }, [execution]);

  // Build React Flow nodes with execution overlays
  const rfNodes = useMemo(() => {
    if (!workflow) return [];
    return workflow.nodes.map((node) => {
      const trace = nodeExecMap.get(node.id);
      return {
        id: node.id,
        type: node.type,
        position: node.position,
        data: {
          ...(node.data ?? {}),
          label: node.name ?? node.data?.label ?? node.type,
          config: node.data?.config ?? {},
          executionStatus: trace?.status ?? undefined,
        },
        style: getNodeStyle(trace?.status),
      };
    });
  }, [workflow, nodeExecMap]);

  // Build React Flow edges
  const rfEdges = useMemo(() => {
    if (!workflow) return [];
    return workflow.connections.map((conn) => ({
      id: conn.id,
      source: conn.sourceNodeId,
      target: conn.targetNodeId,
      sourceHandle: conn.sourceHandle,
      targetHandle: conn.targetHandle,
    }));
  }, [workflow]);

  const handleNodeClick = useCallback((_event: React.MouseEvent, node: { id: string }) => {
    setSelectedNodeId(node.id);
  }, []);

  const handlePaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const selectedTrace = selectedNodeId ? nodeExecMap.get(selectedNodeId) ?? null : null;

  const miniMapNodeColor = useCallback((node: { type?: string }) => {
    const meta = node.type ? NODE_TYPES[node.type] : null;
    return meta?.color ?? '#888';
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-950">
        <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !execution) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-950">
        <div className="text-center">
          <div className="text-red-400 text-lg font-medium mb-2">Error</div>
          <div className="text-gray-500 text-sm">{error ?? 'Execution not found'}</div>
        </div>
      </div>
    );
  }

  const shortId = execution.id.slice(0, 8);

  return (
    <div className="flex-1 flex flex-col bg-gray-950 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-gray-800">
        <button
          onClick={() => navigate(`/editor/${workflowId}/executions`)}
          className="text-gray-400 hover:text-white text-sm flex items-center gap-1"
        >
          <ArrowLeft size={16} />
          Back to History
        </button>
        <span className="text-gray-600">|</span>
        <div className="flex items-center gap-2">
          <span className="text-white text-sm font-medium">Execution {shortId}</span>
          <StatusIcon status={execution.status} />
        </div>
        <div className="flex items-center gap-3 ml-4 text-gray-400 text-xs">
          {execution.durationMs != null && (
            <span>Duration: {formatDuration(execution.durationMs)}</span>
          )}
          <span>Mode: {execution.mode}</span>
          <span>{timeAgo(execution.startedAt)}</span>
        </div>
      </div>

      {!workflow && (
        <div className="px-6 py-2 bg-yellow-950/40 border-b border-yellow-800/50 text-yellow-300 text-xs">
          The workflow for this execution has been deleted. Trace data is shown below; click a node in the list to inspect it.
        </div>
      )}

      {/* Canvas + Panel */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 relative">
          {!workflow && (
            <div className="absolute inset-0 overflow-auto p-4 z-10">
              <ul className="space-y-1">
                {execution.nodeExecutions.map((ne) => (
                  <li
                    key={ne.nodeId}
                    onClick={() => setSelectedNodeId(ne.nodeId)}
                    className="cursor-pointer px-3 py-2 rounded bg-gray-900 hover:bg-gray-800 text-sm text-gray-300 border border-gray-800"
                  >
                    <span className="font-medium text-white">{ne.nodeName}</span>
                    <span className="ml-2 text-gray-500 text-xs">{ne.nodeType}</span>
                    <span className="ml-2 text-xs">{ne.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypeMap}
            onNodeClick={handleNodeClick}
            onPaneClick={handlePaneClick}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={true}
            panOnDrag={true}
            zoomOnScroll={true}
            fitView
            className="bg-gray-950"
          >
            <Background color="#374151" gap={20} />
            <Controls />
            <MiniMap
              style={{ background: '#111827' }}
              nodeColor={miniMapNodeColor}
            />
          </ReactFlow>
        </div>
        {selectedTrace && (
          <NodeTracePanel
            trace={selectedTrace}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </div>
    </div>
  );
}

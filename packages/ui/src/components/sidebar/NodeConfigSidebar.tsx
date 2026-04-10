import { useCallback, useState } from 'react';
import { X, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import type { NodeExecutionData } from '@flowaibuilder/shared';
import { NODE_TYPES } from '@flowaibuilder/shared';
import type { ExecutionStatus } from '@flowaibuilder/shared';
import { useUiStore } from '../../store/ui';
import { useWorkflowStore } from '../../store/workflow';
import { useExecutionStore } from '../../store/execution';
import { HttpRequestForm } from './forms/HttpRequestForm';
import { IfForm } from './forms/IfForm';
import { WebhookForm } from './forms/WebhookForm';
import { ScheduleForm } from './forms/ScheduleForm';
import { SetForm } from './forms/SetForm';
import { CodeForm } from './forms/CodeForm';
import { DefaultForm } from './forms/DefaultForm';

const FORM_MAP: Record<string, React.ComponentType<{ nodeId: string; config: Record<string, unknown>; onChange: (config: Record<string, unknown>) => void }>> = {
  'http-request': HttpRequestForm,
  if: IfForm,
  webhook: WebhookForm,
  schedule: ScheduleForm,
  set: SetForm,
  'code-js': CodeForm,
  'code-python': CodeForm,
};

function StatusBadge({ status }: { status: ExecutionStatus }) {
  const colorMap: Record<ExecutionStatus, string> = {
    pending: 'bg-gray-700 text-gray-300',
    running: 'bg-blue-900/50 text-blue-300',
    success: 'bg-green-900/50 text-green-300',
    error: 'bg-red-900/50 text-red-300',
    cancelled: 'bg-gray-700 text-gray-400',
  };
  return (
    <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${colorMap[status]}`}>
      {status}
    </span>
  );
}

function JsonViewer({ label, data }: { label: string; data: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-300"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {label}
      </button>
      {open && (
        <pre className="mt-1 p-2 bg-gray-800 rounded text-[10px] text-gray-300 font-mono overflow-x-auto max-h-48 overflow-y-auto">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

function formatError(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  try { return JSON.stringify(error, null, 2); } catch { return String(error); }
}

function ExecutionSection({ nodeExecData }: { nodeExecData: NodeExecutionData }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-t border-gray-700 mt-4 pt-4" data-testid="execution-section">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs font-medium text-gray-300 mb-2 w-full"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Execution
      </button>
      {open && (
        <>
          <div className="flex items-center gap-2 mb-2">
            <StatusBadge status={nodeExecData.status} />
            {nodeExecData.duration != null && (
              <span className="text-xs text-gray-400">{nodeExecData.duration}ms</span>
            )}
          </div>

          {nodeExecData.error && (
            <div className="bg-red-900/30 border border-red-700 rounded p-3 mt-2">
              <p className="text-red-300 text-xs font-medium font-mono whitespace-pre-wrap">{formatError(nodeExecData.error)}</p>
            </div>
          )}

          {nodeExecData.input != null && <JsonViewer label="Input" data={nodeExecData.input} />}
          {nodeExecData.output != null && <JsonViewer label="Output" data={nodeExecData.output} />}
        </>
      )}
    </div>
  );
}

export function NodeConfigSidebar() {
  const selectedNodeId = useUiStore((s) => s.selectedNodeId);
  const selectNode = useUiStore((s) => s.selectNode);
  const workflow = useWorkflowStore((s) => s.workflow);
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);
  const removeNode = useWorkflowStore((s) => s.removeNode);
  const nodeExecData = useExecutionStore((s) =>
    selectedNodeId ? s.nodeStatuses[selectedNodeId] : undefined,
  );

  const wfNode = workflow?.nodes?.find((n) => n.id === selectedNodeId);
  const meta = wfNode ? NODE_TYPES[wfNode.type] : null;

  const handleNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!selectedNodeId) return;
      updateNodeConfig(selectedNodeId, { name: e.target.value });
    },
    [selectedNodeId, updateNodeConfig],
  );

  const handleConfigChange = useCallback(
    (configDelta: Record<string, unknown>) => {
      if (!selectedNodeId || !wfNode) return;
      const merged = { ...(wfNode.data.config as Record<string, unknown> ?? {}), ...configDelta };
      updateNodeConfig(selectedNodeId, { config: merged });
    },
    [selectedNodeId, updateNodeConfig, wfNode],
  );

  const handleDelete = useCallback(async () => {
    if (!selectedNodeId) return;
    await removeNode(selectedNodeId);
    selectNode(null);
  }, [selectedNodeId, removeNode, selectNode]);

  if (!wfNode || !meta) return null;

  const FormComponent = FORM_MAP[wfNode.type] ?? DefaultForm;

  return (
    <div className="w-80 bg-gray-900 border-l border-gray-700 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-gray-700">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: meta.color }}
          />
          <span className="text-xs text-gray-400 flex-shrink-0">{meta.label}</span>
        </div>
        <button
          onClick={() => selectNode(null)}
          className="p-1 text-gray-400 hover:text-white rounded hover:bg-gray-800"
        >
          <X size={16} />
        </button>
      </div>

      {/* Node name */}
      <div className="px-3 py-2 border-b border-gray-800">
        <input
          type="text"
          value={wfNode.name}
          onChange={handleNameChange}
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-purple-500"
        />
      </div>

      {/* Config form */}
      <div className="flex-1 overflow-y-auto p-3">
        <FormComponent
          nodeId={wfNode.id}
          config={(wfNode.data.config ?? {}) as Record<string, unknown>}
          onChange={handleConfigChange}
        />

        {/* Execution results section (collapsible) */}
        {nodeExecData && (
          <ExecutionSection nodeExecData={nodeExecData} />
        )}
      </div>

      {/* Delete button */}
      <div className="p-3 border-t border-gray-700">
        <button
          onClick={handleDelete}
          className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-red-900/30 border border-red-800/50 text-red-400 hover:bg-red-900/50 hover:text-red-300 transition-colors"
        >
          <Trash2 size={14} />
          Delete Node
        </button>
      </div>
    </div>
  );
}

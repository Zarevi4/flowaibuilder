import { X, CheckCircle2, XCircle, MinusCircle, Clock } from 'lucide-react';
import type { NodeExecutionData, ExecutionStatus } from '@flowaibuilder/shared';
import { formatDuration } from '../../lib/utils';

interface NodeTracePanelProps {
  trace: NodeExecutionData;
  onClose: () => void;
}

function StatusBadge({ status }: { status: ExecutionStatus }) {
  const styles: Record<string, string> = {
    success: 'bg-green-500/20 text-green-400',
    error: 'bg-red-500/20 text-red-400',
    cancelled: 'bg-gray-500/20 text-gray-400',
    running: 'bg-blue-500/20 text-blue-400',
    pending: 'bg-gray-500/20 text-gray-400',
  };
  const icons: Record<string, typeof CheckCircle2> = {
    success: CheckCircle2,
    error: XCircle,
    cancelled: MinusCircle,
    running: MinusCircle,
    pending: MinusCircle,
  };
  const Icon = icons[status] ?? MinusCircle;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${styles[status] ?? styles.pending}`}>
      <Icon size={12} />
      {status}
    </span>
  );
}

export function NodeTracePanel({ trace, onClose }: NodeTracePanelProps) {
  return (
    <div className="w-80 border-l border-gray-800 bg-gray-900 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex flex-col gap-1">
          <span className="text-white text-sm font-medium">{trace.nodeName}</span>
          <span className="text-gray-500 text-xs">{trace.nodeType}</span>
        </div>
        <button onClick={onClose} className="p-1 text-gray-400 hover:text-white rounded hover:bg-gray-800">
          <X size={14} />
        </button>
      </div>

      {/* Status & Duration */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
        <StatusBadge status={trace.status} />
        {trace.duration != null && (
          <span className="text-gray-400 text-xs flex items-center gap-1">
            <Clock size={12} />
            {formatDuration(trace.duration)}
          </span>
        )}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-auto px-4 py-3 space-y-4">
        {/* Input */}
        {trace.input != null && (
          <div>
            <h3 className="text-gray-400 text-xs font-medium uppercase tracking-wider mb-2">Input</h3>
            <pre className="bg-gray-950 text-gray-300 font-mono text-xs p-3 rounded overflow-auto max-h-64">
              {JSON.stringify(trace.input, null, 2)}
            </pre>
          </div>
        )}

        {/* Output */}
        {trace.output != null && (
          <div>
            <h3 className="text-gray-400 text-xs font-medium uppercase tracking-wider mb-2">Output</h3>
            <pre className="bg-gray-950 text-gray-300 font-mono text-xs p-3 rounded overflow-auto max-h-64">
              {JSON.stringify(trace.output, null, 2)}
            </pre>
          </div>
        )}

        {/* Error */}
        {trace.error && (
          <div>
            <h3 className="text-red-400 text-xs font-medium uppercase tracking-wider mb-2">Error</h3>
            <pre className="bg-red-950/50 text-red-300 font-mono text-xs p-3 rounded border border-red-800/50 overflow-auto max-h-64 whitespace-pre-wrap">
              {trace.error}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
import type { Execution, ExecutionStatus, ExecutionMode } from '@flowaibuilder/shared';
import { listExecutions, getWorkflow } from '../lib/api';
import { timeAgo, formatDuration } from '../lib/utils';

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

function ModeBadge({ mode }: { mode: ExecutionMode }) {
  return (
    <span className="bg-gray-700 text-gray-300 px-2 py-0.5 rounded text-xs">
      {mode}
    </span>
  );
}

export function ExecutionHistory() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const navigate = useNavigate();
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [workflowName, setWorkflowName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workflowId) {
      setError('Missing workflow id');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    Promise.all([
      listExecutions(workflowId),
      getWorkflow(workflowId),
    ])
      .then(([execRes, wf]) => {
        setExecutions(execRes.executions);
        setWorkflowName(wf.name);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load executions'))
      .finally(() => setLoading(false));
  }, [workflowId]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-950">
        <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-950">
        <div className="text-center">
          <div className="text-red-400 text-lg font-medium mb-2">Error</div>
          <div className="text-gray-500 text-sm">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-gray-950 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-800">
        <button
          onClick={() => navigate(`/editor/${workflowId}`)}
          className="text-gray-400 hover:text-white text-sm flex items-center gap-1"
        >
          <ArrowLeft size={16} />
          Back to Editor
        </button>
        <span className="text-gray-600">|</span>
        <h1 className="text-white text-sm font-medium">
          Execution History — {workflowName}
        </h1>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {executions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-gray-400 text-sm">No executions yet.</p>
            <p className="text-gray-500 text-xs mt-1">Run the workflow to see execution history.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-xs uppercase tracking-wider border-b border-gray-800">
                <th className="text-left py-2 px-3 font-medium">Status</th>
                <th className="text-left py-2 px-3 font-medium">Mode</th>
                <th className="text-left py-2 px-3 font-medium">Duration</th>
                <th className="text-left py-2 px-3 font-medium">Started</th>
                <th className="text-left py-2 px-3 font-medium">By</th>
              </tr>
            </thead>
            <tbody>
              {executions.map((exec) => (
                <tr
                  key={exec.id}
                  onClick={() => navigate(`/editor/${workflowId}/executions/${exec.id}`)}
                  className="bg-gray-900 hover:bg-gray-800 cursor-pointer border-b border-gray-800 transition-colors"
                >
                  <td className="py-2.5 px-3">
                    <StatusBadge status={exec.status} />
                  </td>
                  <td className="py-2.5 px-3">
                    <ModeBadge mode={exec.mode} />
                  </td>
                  <td className="py-2.5 px-3 text-gray-400">
                    {exec.durationMs != null ? formatDuration(exec.durationMs) : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-gray-400">
                    {timeAgo(exec.startedAt)}
                  </td>
                  <td className="py-2.5 px-3 text-gray-400">
                    {exec.triggeredBy}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

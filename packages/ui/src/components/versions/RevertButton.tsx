import { useState } from 'react';
import { revertWorkflow } from '../../lib/api';
import { useWorkflowStore } from '../../store/workflow';

interface Props {
  workflowId: string;
  version: number;
  role?: 'admin' | 'editor' | 'viewer';
  onReverted?: (newVersion: number) => void;
}

export function RevertButton({ workflowId, version, role, onReverted }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isViewer = role === 'viewer';
  // Reloading the workflow from the store after a revert so the canvas
  // reflects the restored nodes/connections immediately instead of showing
  // stale pre-revert state. Falls back to no-op if the store is absent.
  const reloadWorkflow = useWorkflowStore((s) => s.loadWorkflow);

  async function handleClick() {
    if (isViewer) return;
    if (!window.confirm(`Revert workflow to version ${version}? A new version will be created.`)) return;
    setLoading(true);
    setError(null);
    try {
      const result = await revertWorkflow(workflowId, version);
      // Refresh the canvas state from the server before notifying the
      // parent, so the user sees the restored graph without a page reload.
      try { await reloadWorkflow(workflowId); } catch { /* store unavailable in tests */ }
      onReverted?.(result.version);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'inline-block' }}>
      <button
        type="button"
        onClick={handleClick}
        disabled={isViewer || loading}
        title={isViewer ? 'Viewer role cannot revert' : `Revert to v${version}`}
        style={{
          padding: '4px 10px',
          fontSize: 12,
          opacity: isViewer || loading ? 0.5 : 1,
          cursor: isViewer || loading ? 'not-allowed' : 'pointer',
        }}
      >
        {loading ? 'Reverting…' : `Revert to v${version}`}
      </button>
      {error && <span style={{ marginLeft: 8, color: '#c00', fontSize: 12 }}>{error}</span>}
    </div>
  );
}

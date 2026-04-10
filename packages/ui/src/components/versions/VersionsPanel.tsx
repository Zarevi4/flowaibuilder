import { useEffect, useState } from 'react';
import type { WorkflowVersionMeta } from '@flowaibuilder/shared';
import { listVersions, gitPush, getGitSettings } from '../../lib/api';
import { DiffViewer } from './DiffViewer';
import { RevertButton } from './RevertButton';

interface Props {
  workflowId: string;
  role?: 'admin' | 'editor' | 'viewer';
  onClose?: () => void;
}

export function VersionsPanel({ workflowId, role, onClose }: Props) {
  const [versions, setVersions] = useState<WorkflowVersionMeta[]>([]);
  const [gitEnabled, setGitEnabled] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pushingId, setPushingId] = useState<string | null>(null);

  async function refresh() {
    try {
      const { versions } = await listVersions(workflowId, 100);
      setVersions(versions);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    // Cancelled flag prevents setState-after-unmount warnings / stale
    // writes if workflowId changes while a fetch is in flight.
    let cancelled = false;
    (async () => {
      try {
        const { versions: vs } = await listVersions(workflowId, 100);
        if (!cancelled) setVersions(vs);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
      try {
        const s = await getGitSettings();
        if (!cancelled) setGitEnabled(Boolean(s.gitSyncEnabled));
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [workflowId]);

  // Subscribe to workflow_version_created to refresh the list.
  useEffect(() => {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/workflow/${workflowId}`;
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(url);
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg?.type === 'workflow_version_created') refresh();
        } catch { /* ignore */ }
      };
    } catch { /* tests / no ws */ }
    return () => { ws?.close(); };
  }, [workflowId]);

  function toggleSelect(v: number) {
    setSelected((prev) => {
      if (prev.includes(v)) return prev.filter((x) => x !== v);
      if (prev.length === 2) return [prev[1], v];
      return [...prev, v];
    });
  }

  async function handlePush(versionRowId: string, versionNumber: number) {
    setPushingId(versionRowId);
    setError(null);
    try {
      // Pass the specific version row id so the server pushes THIS row,
      // not whatever the latest version happens to be.
      await gitPush(workflowId, `push workflow ${workflowId} v${versionNumber}`, versionRowId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPushingId(null);
    }
  }

  const canRevert = role !== 'viewer';
  const [from, to] = selected.length === 2 ? [Math.min(...selected), Math.max(...selected)] : [null, null];

  return (
    <div style={{ padding: 16, width: 640, maxHeight: '80vh', overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Versions</h3>
        {onClose && <button type="button" onClick={onClose}>✕</button>}
      </div>
      {error && <div style={{ color: '#c00', fontSize: 12, marginBottom: 8 }}>{error}</div>}

      <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 8 }}>
        Select two versions to diff. {canRevert ? '' : 'Viewer role cannot revert.'}
      </div>

      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e5e5' }}>
            <th style={{ padding: 4 }}>#</th>
            <th style={{ padding: 4 }}>Version</th>
            <th style={{ padding: 4 }}>Message</th>
            <th style={{ padding: 4 }}>Author</th>
            <th style={{ padding: 4 }}>Git SHA</th>
            <th style={{ padding: 4 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td style={{ padding: 4 }}>
                <input
                  type="checkbox"
                  checked={selected.includes(v.version)}
                  onChange={() => toggleSelect(v.version)}
                />
              </td>
              <td style={{ padding: 4 }}>v{v.version}</td>
              <td style={{ padding: 4 }}>{v.message ?? '—'}</td>
              <td style={{ padding: 4 }}>{v.createdBy}</td>
              <td style={{ padding: 4, fontFamily: 'monospace', fontSize: 10 }}>
                {v.gitSha ? v.gitSha.slice(0, 8) : '—'}
              </td>
              <td style={{ padding: 4, display: 'flex', gap: 6 }}>
                <RevertButton workflowId={workflowId} version={v.version} role={role} onReverted={refresh} />
                {gitEnabled && !v.gitSha && canRevert && (
                  <button
                    type="button"
                    onClick={() => handlePush(v.id, v.version)}
                    disabled={pushingId === v.id}
                    style={{ fontSize: 11 }}
                  >
                    {pushingId === v.id ? 'Pushing…' : 'Push'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {from !== null && to !== null && from !== to && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #e5e5e5' }}>
          <DiffViewer workflowId={workflowId} from={from} to={to} />
        </div>
      )}
    </div>
  );
}

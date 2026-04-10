import { useEffect, useState } from 'react';
import type { WorkflowDiff } from '@flowaibuilder/shared';
import { diffVersions } from '../../lib/api';

interface Props {
  workflowId: string;
  from: number;
  to: number;
}

export function DiffViewer({ workflowId, from, to }: Props) {
  const [diff, setDiff] = useState<WorkflowDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openAdded, setOpenAdded] = useState(true);
  const [openRemoved, setOpenRemoved] = useState(true);
  const [openChanged, setOpenChanged] = useState(true);

  useEffect(() => {
    let cancelled = false;
    diffVersions(workflowId, from, to)
      .then((d) => { if (!cancelled) setDiff(d); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [workflowId, from, to]);

  if (error) return <div style={{ color: '#c00', fontSize: 12 }}>Diff failed: {error}</div>;
  if (!diff) return <div style={{ fontSize: 12, opacity: 0.7 }}>Loading diff…</div>;

  // Defense-in-depth against a server response missing one of the expected
  // fields — render an empty-but-well-formed diff rather than crashing.
  const meta = diff.meta ?? { nameChanged: false, descriptionChanged: false, settingsChanged: false };
  const nodes = diff.nodes ?? { added: [], removed: [], changed: [] };
  const connections = diff.connections ?? { added: [], removed: [] };

  const pre: React.CSSProperties = {
    background: '#f5f5f5',
    padding: 8,
    fontSize: 11,
    borderRadius: 4,
    overflow: 'auto',
    maxHeight: 240,
  };
  const section: React.CSSProperties = {
    border: '1px solid #e5e5e5',
    borderRadius: 6,
    padding: 10,
    marginBottom: 10,
  };

  return (
    <div>
      <div style={{ fontSize: 12, marginBottom: 10, opacity: 0.7 }}>
        Diff v{diff.from} → v{diff.to} · meta: name={String(meta.nameChanged)} desc=
        {String(meta.descriptionChanged)} settings={String(meta.settingsChanged)}
      </div>

      <div style={section}>
        <div
          style={{ fontWeight: 600, cursor: 'pointer', marginBottom: 6 }}
          onClick={() => setOpenAdded((x) => !x)}
        >
          {openAdded ? '▼' : '▶'} Added nodes ({nodes.added.length}) · connections (
          {connections.added.length})
        </div>
        {openAdded && (
          <>
            {nodes.added.map((n) => (
              <div key={n.id}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{n.name} <span style={{ opacity: 0.5 }}>({n.type})</span></div>
                <pre style={pre}>{JSON.stringify(n.data?.config ?? {}, null, 2)}</pre>
              </div>
            ))}
            {connections.added.map((c) => (
              <div key={c.id} style={{ fontSize: 11 }}>{c.sourceNodeId} → {c.targetNodeId}</div>
            ))}
          </>
        )}
      </div>

      <div style={section}>
        <div
          style={{ fontWeight: 600, cursor: 'pointer', marginBottom: 6 }}
          onClick={() => setOpenRemoved((x) => !x)}
        >
          {openRemoved ? '▼' : '▶'} Removed nodes ({nodes.removed.length}) · connections (
          {connections.removed.length})
        </div>
        {openRemoved && (
          <>
            {nodes.removed.map((n) => (
              <div key={n.id} style={{ fontSize: 12 }}>{n.name} <span style={{ opacity: 0.5 }}>({n.type})</span></div>
            ))}
            {connections.removed.map((c) => (
              <div key={c.id} style={{ fontSize: 11 }}>{c.sourceNodeId} → {c.targetNodeId}</div>
            ))}
          </>
        )}
      </div>

      <div style={section}>
        <div
          style={{ fontWeight: 600, cursor: 'pointer', marginBottom: 6 }}
          onClick={() => setOpenChanged((x) => !x)}
        >
          {openChanged ? '▼' : '▶'} Changed nodes ({nodes.changed.length})
        </div>
        {openChanged && nodes.changed.map((entry) => {
          const changedFields = entry.changedFields ?? [];
          const shows = (f: string) => changedFields.includes(f);
          return (
            <div key={entry.id} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>
                {entry.after.name} <span style={{ opacity: 0.5 }}>({changedFields.join(', ') || 'no fields'})</span>
              </div>
              {/* Per-field before/after per AC #10: name, position, disabled, data.config */}
              {shows('name') && (
                <div style={{ fontSize: 11, marginTop: 4 }}>
                  <span style={{ opacity: 0.6 }}>name:</span>{' '}
                  <code>{String(entry.before.name)}</code> → <code>{String(entry.after.name)}</code>
                </div>
              )}
              {(shows('position.x') || shows('position.y')) && (
                <div style={{ fontSize: 11, marginTop: 4 }}>
                  <span style={{ opacity: 0.6 }}>position:</span>{' '}
                  <code>({entry.before.position?.x},{entry.before.position?.y})</code> →{' '}
                  <code>({entry.after.position?.x},{entry.after.position?.y})</code>
                </div>
              )}
              {shows('disabled') && (
                <div style={{ fontSize: 11, marginTop: 4 }}>
                  <span style={{ opacity: 0.6 }}>disabled:</span>{' '}
                  <code>{String(entry.before.disabled ?? false)}</code> →{' '}
                  <code>{String(entry.after.disabled ?? false)}</code>
                </div>
              )}
              {shows('data.config') && (
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 10, opacity: 0.6 }}>Before config</div>
                    <pre style={pre}>{JSON.stringify(entry.before.data?.config ?? {}, null, 2)}</pre>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 10, opacity: 0.6 }}>After config</div>
                    <pre style={pre}>{JSON.stringify(entry.after.data?.config ?? {}, null, 2)}</pre>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

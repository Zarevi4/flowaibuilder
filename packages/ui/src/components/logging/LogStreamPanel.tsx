import { useEffect, useState } from 'react';
import type { LogDestination } from '@flowaibuilder/shared';
import { getSettings, updateLogStreamConfig } from '../../lib/api';

interface LogStreamPanelProps {
  role?: string | null;
}

const inputClass =
  'bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-white focus:border-purple-500 focus:outline-none w-full';

export function LogStreamPanel({ role }: LogStreamPanelProps) {
  const isViewer = role === 'viewer';
  const [destinations, setDestinations] = useState<LogDestination[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newType, setNewType] = useState<'stdout' | 'webhook' | 's3'>('stdout');

  const reload = () => {
    setLoading(true);
    getSettings()
      .then((s) => setDestinations(s.logStreamDestinations ?? []))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { reload(); }, []);

  const save = async (dests: LogDestination[]) => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateLogStreamConfig(dests);
      setDestinations(updated.logStreamDestinations ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = () => {
    const base: LogDestination = { type: newType, enabled: true };
    if (newType === 'webhook') base.url = '';
    if (newType === 's3') { base.bucket = ''; base.region = 'us-east-1'; base.prefix = 'logs/'; }
    setDestinations([...destinations, base]);
    setShowAdd(false);
  };

  const handleRemove = (index: number) => {
    const next = destinations.filter((_, i) => i !== index);
    setDestinations(next);
  };

  const handleUpdate = (index: number, field: string, value: string | boolean) => {
    const next = [...destinations];
    next[index] = { ...next[index], [field]: value };
    setDestinations(next);
  };

  return (
    <div>
      <h2 className="text-white text-sm font-semibold mb-2">Log Streaming</h2>
      <p className="text-xs text-gray-500 mb-3">
        Stream execution events to external destinations for centralized observability.
      </p>

      {loading ? (
        <div className="text-gray-400 text-xs">Loading...</div>
      ) : (
        <>
          {destinations.length === 0 && (
            <p className="text-gray-600 text-xs mb-2">No log destinations configured.</p>
          )}

          {destinations.map((dest, i) => (
            <div key={i} className="flex items-start gap-2 mb-2 p-2 bg-gray-900 border border-gray-800 rounded">
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-purple-400 font-mono uppercase">{dest.type}</span>
                  <label className="flex items-center gap-1 text-xs text-gray-400">
                    <input
                      type="checkbox"
                      checked={dest.enabled}
                      onChange={(e) => handleUpdate(i, 'enabled', e.target.checked)}
                      disabled={isViewer}
                      className="accent-purple-600"
                    />
                    enabled
                  </label>
                </div>
                {dest.type === 'webhook' && (
                  <input
                    type="url"
                    placeholder="https://hooks.example.com/logs"
                    value={dest.url ?? ''}
                    onChange={(e) => handleUpdate(i, 'url', e.target.value)}
                    disabled={isViewer}
                    className={inputClass}
                  />
                )}
                {dest.type === 's3' && (
                  <div className="space-y-1">
                    <input
                      type="text"
                      placeholder="bucket-name"
                      value={dest.bucket ?? ''}
                      onChange={(e) => handleUpdate(i, 'bucket', e.target.value)}
                      disabled={isViewer}
                      className={inputClass}
                    />
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="us-east-1"
                        value={dest.region ?? ''}
                        onChange={(e) => handleUpdate(i, 'region', e.target.value)}
                        disabled={isViewer}
                        className={inputClass}
                      />
                      <input
                        type="text"
                        placeholder="logs/"
                        value={dest.prefix ?? ''}
                        onChange={(e) => handleUpdate(i, 'prefix', e.target.value)}
                        disabled={isViewer}
                        className={inputClass}
                      />
                    </div>
                  </div>
                )}
              </div>
              <button
                onClick={() => handleRemove(i)}
                disabled={isViewer}
                className="text-gray-500 hover:text-red-400 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                title={isViewer ? 'Viewers cannot modify log destinations' : 'Remove'}
              >
                Remove
              </button>
            </div>
          ))}

          {showAdd ? (
            <div className="flex items-center gap-2 mb-2">
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as 'stdout' | 'webhook' | 's3')}
                className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-white"
              >
                <option value="stdout">stdout</option>
                <option value="webhook">webhook</option>
                <option value="s3">S3</option>
              </select>
              <button
                onClick={handleAdd}
                className="bg-purple-600 hover:bg-purple-700 text-white px-2 py-1 rounded text-xs"
              >
                Add
              </button>
              <button
                onClick={() => setShowAdd(false)}
                className="text-gray-500 hover:text-gray-300 text-xs"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowAdd(true)}
              disabled={isViewer}
              className="text-purple-400 hover:text-purple-300 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
              title={isViewer ? 'Viewers cannot add log destinations' : undefined}
            >
              + Add Destination
            </button>
          )}

          {error && <div className="text-red-400 text-xs mt-1">{error}</div>}

          <div className="mt-2">
            <button
              onClick={() => save(destinations)}
              disabled={isViewer || saving}
              className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-3 py-1 rounded text-xs"
            >
              {saving ? 'Saving...' : 'Save Log Destinations'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

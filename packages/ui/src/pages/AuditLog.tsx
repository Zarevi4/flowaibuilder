import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import type { AuditLogEntry } from '@flowaibuilder/shared';
import { listAuditLog } from '../lib/api';
import { timeAgo } from '../lib/utils';

export function AuditLog() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstFetch = useRef(true);

  useEffect(() => {
    const fetchEntries = () => {
      setLoading(true);
      listAuditLog({
        actor: actor || undefined,
        action: action || undefined,
        resourceType: resourceType || undefined,
      })
        .then((res) => {
          setEntries(res.entries);
          setError(null);
        })
        .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load audit log'))
        .finally(() => setLoading(false));
    };

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (isFirstFetch.current) {
      // Fire immediately on mount; only debounce subsequent filter changes.
      isFirstFetch.current = false;
      fetchEntries();
    } else {
      debounceRef.current = setTimeout(fetchEntries, 300);
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [actor, action, resourceType]);

  const hasFilters = actor || action || resourceType;
  const inputClass =
    'bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-white focus:border-purple-500 focus:outline-none';

  return (
    <div className="flex-1 bg-gray-950 min-h-full p-6 overflow-auto">
      <div className="flex items-center gap-3 mb-4">
        <Link to="/" className="text-gray-400 hover:text-white text-sm flex items-center gap-1">
          <ArrowLeft size={16} />
          Back
        </Link>
        <span className="text-gray-600">|</span>
        <h1 className="text-white text-lg font-semibold">Audit Log</h1>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <input
          aria-label="Actor filter"
          placeholder="Actor"
          value={actor}
          onChange={(e) => setActor(e.target.value)}
          className={inputClass}
        />
        <input
          aria-label="Action filter"
          placeholder="Action"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className={inputClass}
        />
        <input
          aria-label="Resource type filter"
          placeholder="Resource type"
          value={resourceType}
          onChange={(e) => setResourceType(e.target.value)}
          className={inputClass}
        />
      </div>

      {error && <div className="text-red-400 text-sm mb-3">{error}</div>}

      {loading ? (
        <div className="text-gray-400 text-sm">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="text-gray-400 text-sm">
          {hasFilters ? 'No audit entries match these filters.' : 'No audit entries yet.'}
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 text-xs uppercase tracking-wider border-b border-gray-800">
              <th className="text-left py-2 px-3 font-medium">Timestamp</th>
              <th className="text-left py-2 px-3 font-medium">Actor</th>
              <th className="text-left py-2 px-3 font-medium">Action</th>
              <th className="text-left py-2 px-3 font-medium">Resource</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr
                key={entry.id}
                className="bg-gray-900 hover:bg-gray-800 border-b border-gray-800 transition-colors"
              >
                <td className="py-2.5 px-3 text-gray-400">{timeAgo(entry.timestamp)}</td>
                <td className="py-2.5 px-3 text-gray-300">{entry.actor}</td>
                <td className="py-2.5 px-3 text-gray-300">{entry.action}</td>
                <td className="py-2.5 px-3 text-gray-400">
                  {entry.resourceType ?? '—'}
                  {entry.resourceId ? `:${entry.resourceId}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

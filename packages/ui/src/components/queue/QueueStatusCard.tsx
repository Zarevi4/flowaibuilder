import { useEffect, useState } from 'react';
import type { QueueStatus } from '@flowaibuilder/shared';
import { getQueueStatus } from '../../lib/api';

export function QueueStatusCard() {
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    getQueueStatus()
      .then(setStatus)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load queue status'));
  };

  useEffect(() => {
    refresh();
    if (!status || status.enabled) {
      const interval = setInterval(refresh, 10_000);
      return () => clearInterval(interval);
    }
  }, [status?.enabled]);

  if (error) return null; // Silently hide if queue endpoint unavailable

  if (!status) return null;

  if (!status.enabled) {
    return (
      <div className="p-4 bg-gray-900 border border-gray-800 rounded-lg">
        <h3 className="text-white text-sm font-semibold mb-1">Queue Status</h3>
        <p className="text-gray-500 text-xs">
          Queue mode is disabled. Set <code className="text-gray-400">QUEUE_MODE=true</code> to enable.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 bg-gray-900 border border-gray-800 rounded-lg">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-white text-sm font-semibold">Queue Status</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs px-2 py-0.5 bg-green-900/50 text-green-400 rounded">Enabled</span>
          <button
            onClick={refresh}
            className="text-gray-500 hover:text-gray-300 text-xs"
          >
            Refresh
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-gray-500">Concurrency</span>
          <p className="text-white font-mono">{status.concurrency}</p>
        </div>
        <div>
          <span className="text-gray-500">Workers</span>
          <p className="text-white font-mono">{status.workers ?? 0}</p>
        </div>
        <div>
          <span className="text-gray-500">Waiting</span>
          <p className="text-yellow-400 font-mono">{status.waiting ?? 0}</p>
        </div>
        <div>
          <span className="text-gray-500">Active</span>
          <p className="text-blue-400 font-mono">{status.active ?? 0}</p>
        </div>
        <div>
          <span className="text-gray-500">Completed</span>
          <p className="text-green-400 font-mono">{status.completed ?? 0}</p>
        </div>
        <div>
          <span className="text-gray-500">Failed</span>
          <p className="text-red-400 font-mono">{status.failed ?? 0}</p>
        </div>
      </div>
    </div>
  );
}

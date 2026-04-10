import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import type { InstanceSettings } from '@flowaibuilder/shared';
import { getSettings, updateSettings, getCurrentUser, type CurrentUser } from '../lib/api';
import { SecretsPanel } from '../components/secrets/SecretsPanel';
import { LogStreamPanel } from '../components/logging/LogStreamPanel';

export function Settings() {
  const [settings, setSettings] = useState<InstanceSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    getCurrentUser().then(setCurrentUser);
  }, []);

  useEffect(() => {
    getSettings()
      .then(setSettings)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load settings'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateSettings({
        timezone: settings.timezone,
        autoReviewEnabled: settings.autoReviewEnabled,
        errorWorkflowId: settings.errorWorkflowId,
        gitRepoUrl: settings.gitRepoUrl,
        gitBranch: settings.gitBranch,
        gitAuthorName: settings.gitAuthorName,
        gitAuthorEmail: settings.gitAuthorEmail,
        gitSyncEnabled: settings.gitSyncEnabled,
        ...(settings.gitToken ? { gitToken: settings.gitToken } : {}),
      });
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    'bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-white focus:border-purple-500 focus:outline-none w-full max-w-md';

  return (
    <div className="flex-1 bg-gray-950 min-h-full p-6 overflow-auto">
      <div className="flex items-center gap-3 mb-4">
        <Link to="/" className="text-gray-400 hover:text-white text-sm flex items-center gap-1">
          <ArrowLeft size={16} />
          Back
        </Link>
        <span className="text-gray-600">|</span>
        <h1 className="text-white text-lg font-semibold">Instance Settings</h1>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
          Loading…
        </div>
      ) : settings ? (
        <div className="space-y-4 max-w-md">
          <div>
            <label className="block text-gray-400 text-xs uppercase tracking-wider mb-1">Timezone</label>
            <input
              type="text"
              value={settings.timezone}
              onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
              className={inputClass}
            />
          </div>

          <div>
            <label className="flex items-center gap-2 text-gray-300 text-sm">
              <input
                type="checkbox"
                checked={settings.autoReviewEnabled}
                onChange={(e) => setSettings({ ...settings, autoReviewEnabled: e.target.checked })}
                className="accent-purple-600"
              />
              Auto-review enabled
            </label>
            <p className="text-xs text-gray-500 mt-1">
              Triggers a review_requested event whenever any workflow is saved. Claude Code sessions connected via MCP will be notified.
            </p>
          </div>

          <div>
            <label className="block text-gray-400 text-xs uppercase tracking-wider mb-1">Error workflow ID</label>
            <input
              type="text"
              value={settings.errorWorkflowId ?? ''}
              onChange={(e) =>
                setSettings({ ...settings, errorWorkflowId: e.target.value || null })
              }
              className={inputClass}
            />
          </div>

          <div className="pt-4 border-t border-gray-800">
            <h2 className="text-white text-sm font-semibold mb-2">Git Sync</h2>
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-gray-300 text-sm">
                <input
                  type="checkbox"
                  checked={settings.gitSyncEnabled ?? false}
                  onChange={(e) => setSettings({ ...settings, gitSyncEnabled: e.target.checked })}
                  className="accent-purple-600"
                />
                Enable git sync
              </label>
              <div>
                <label className="block text-gray-400 text-xs uppercase tracking-wider mb-1">Repo URL</label>
                <input type="text" value={settings.gitRepoUrl ?? ''}
                  onChange={(e) => setSettings({ ...settings, gitRepoUrl: e.target.value || null })}
                  placeholder="https://github.com/org/repo.git" className={inputClass} />
              </div>
              <div>
                <label className="block text-gray-400 text-xs uppercase tracking-wider mb-1">Branch</label>
                <input type="text" value={settings.gitBranch ?? 'main'}
                  onChange={(e) => setSettings({ ...settings, gitBranch: e.target.value })}
                  className={inputClass} />
              </div>
              <div>
                <label className="block text-gray-400 text-xs uppercase tracking-wider mb-1">Author name</label>
                <input type="text" value={settings.gitAuthorName ?? ''}
                  onChange={(e) => setSettings({ ...settings, gitAuthorName: e.target.value || null })}
                  className={inputClass} />
              </div>
              <div>
                <label className="block text-gray-400 text-xs uppercase tracking-wider mb-1">Author email</label>
                <input type="email" value={settings.gitAuthorEmail ?? ''}
                  onChange={(e) => setSettings({ ...settings, gitAuthorEmail: e.target.value || null })}
                  className={inputClass} />
              </div>
              <div>
                <label className="block text-gray-400 text-xs uppercase tracking-wider mb-1">
                  Access token {settings.gitTokenStatus === '***' && <span className="text-green-400">(set)</span>}
                </label>
                <input type="password" value={settings.gitToken ?? ''}
                  onChange={(e) => setSettings({ ...settings, gitToken: e.target.value })}
                  placeholder={settings.gitTokenStatus === '***' ? 'Leave blank to keep existing' : ''}
                  className={inputClass} />
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-gray-800">
            <SecretsPanel role={currentUser?.role} />
          </div>

          <div className="pt-4 border-t border-gray-800">
            <LogStreamPanel role={currentUser?.role} />
          </div>

          {error && <div className="text-red-400 text-sm">{error}</div>}

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-3 py-1.5 rounded text-sm"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {saved && <span className="text-green-400 text-sm">Saved!</span>}
          </div>
        </div>
      ) : (
        <div className="text-red-400 text-sm">{error}</div>
      )}
    </div>
  );
}

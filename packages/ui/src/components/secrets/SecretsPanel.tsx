import { useEffect, useState } from 'react';
import type { Credential, CredentialType } from '@flowaibuilder/shared';
import { listSecrets, createSecret, updateSecret, deleteSecret } from '../../lib/api';

const CREDENTIAL_TYPES: CredentialType[] = ['api_key', 'oauth2', 'basic', 'custom'];

interface SecretsPanelProps {
  role?: 'admin' | 'editor' | 'viewer';
}

export function SecretsPanel({ role }: SecretsPanelProps) {
  const [secrets, setSecrets] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add form state
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<CredentialType>('api_key');
  const [newValue, setNewValue] = useState('');
  const [saving, setSaving] = useState(false);

  // Update form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const isViewer = role === 'viewer';

  const reload = () => {
    setLoading(true);
    listSecrets()
      .then((res) => setSecrets(res.secrets))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load secrets'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { reload(); }, []);

  const handleAdd = async () => {
    if (!newName || !newValue) return;
    setSaving(true);
    setError(null);
    try {
      await createSecret({ name: newName, type: newType, value: newValue });
      setNewName('');
      setNewValue('');
      setNewType('api_key');
      setShowAdd(false);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create secret');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (id: string) => {
    if (!editValue) return;
    setSaving(true);
    setError(null);
    try {
      await updateSecret(id, { value: editValue });
      setEditingId(null);
      setEditValue('');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update secret');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    try {
      await deleteSecret(id);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete secret');
    }
  };

  const inputClass =
    'bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-white focus:border-purple-500 focus:outline-none w-full';

  return (
    <div>
      <h2 className="text-white text-sm font-semibold mb-2">Secrets</h2>
      <p className="text-xs text-gray-500 mb-3">
        Encrypted credentials available as <code className="text-purple-400">$secrets.NAME</code> in Code and HTTP Request nodes.
      </p>

      {loading ? (
        <div className="text-gray-400 text-xs">Loading secrets...</div>
      ) : (
        <>
          {secrets.length === 0 && !showAdd ? (
            <div className="text-gray-500 text-xs mb-2">No secrets configured.</div>
          ) : (
            <table className="w-full text-sm mb-2">
              <thead>
                <tr className="text-gray-500 text-xs uppercase tracking-wider">
                  <th className="text-left py-1">Name</th>
                  <th className="text-left py-1">Type</th>
                  <th className="text-right py-1">Actions</th>
                </tr>
              </thead>
              <tbody>
                {secrets.map((s) => (
                  <tr key={s.id} className="border-t border-gray-800">
                    <td className="py-1.5 text-white font-mono text-xs">{s.name}</td>
                    <td className="py-1.5 text-gray-400 text-xs">{s.type}</td>
                    <td className="py-1.5 text-right">
                      {editingId === s.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="password"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            placeholder="New value"
                            className={`${inputClass} max-w-[160px]`}
                          />
                          <button
                            onClick={() => handleUpdate(s.id)}
                            disabled={saving || !editValue}
                            className="text-green-400 hover:text-green-300 text-xs disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => { setEditingId(null); setEditValue(''); }}
                            className="text-gray-400 hover:text-gray-300 text-xs"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 justify-end">
                          <button
                            onClick={() => { setEditingId(s.id); setEditValue(''); }}
                            disabled={isViewer}
                            className="text-purple-400 hover:text-purple-300 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                            title={isViewer ? 'Viewer role cannot manage secrets' : 'Update value'}
                          >
                            Update
                          </button>
                          <button
                            onClick={() => handleDelete(s.id)}
                            disabled={isViewer}
                            className="text-red-400 hover:text-red-300 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                            title={isViewer ? 'Viewer role cannot manage secrets' : 'Delete secret'}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {error && <div className="text-red-400 text-xs mb-2">{error}</div>}

          {showAdd ? (
            <div className="space-y-2 bg-gray-900/50 border border-gray-800 rounded p-2">
              <div>
                <label className="block text-gray-400 text-xs mb-0.5">Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="API_KEY"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-gray-400 text-xs mb-0.5">Type</label>
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as CredentialType)}
                  className={inputClass}
                >
                  {CREDENTIAL_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-gray-400 text-xs mb-0.5">Value</label>
                <input
                  type="password"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleAdd}
                  disabled={saving || !newName || !newValue}
                  className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-2 py-1 rounded text-xs"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => { setShowAdd(false); setNewName(''); setNewValue(''); }}
                  className="text-gray-400 hover:text-gray-300 text-xs"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowAdd(true)}
              disabled={isViewer}
              className="text-purple-400 hover:text-purple-300 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
              title={isViewer ? 'Viewer role cannot manage secrets' : 'Add a new secret'}
            >
              + Add Secret
            </button>
          )}
        </>
      )}
    </div>
  );
}

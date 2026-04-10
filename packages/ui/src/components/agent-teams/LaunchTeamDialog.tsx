import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TeamTemplate } from '@flowaibuilder/shared';
import { listTemplates, launchTeam } from '../../lib/api';
import { Rocket, Users, ListChecks, X } from 'lucide-react';

interface LaunchTeamDialogProps {
  open: boolean;
  onClose: () => void;
}

function validateTeamName(name: string): string | null {
  if (!name.trim()) return 'Team name is required';
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    return 'Must not contain path separators or ".."';
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return 'Only letters, numbers, hyphens, and underscores allowed';
  }
  return null;
}

export function LaunchTeamDialog({ open, onClose }: LaunchTeamDialogProps) {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<TeamTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [teamName, setTeamName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      listTemplates().then(({ templates: t }) => setTemplates(t)).catch(() => setError('Failed to load templates'));
    }
  }, [open]);

  if (!open) return null;

  const handleLaunch = async () => {
    if (!selectedId || !teamName.trim()) return;
    const validationError = validateTeamName(teamName);
    if (validationError) {
      setNameError(validationError);
      return;
    }
    setLaunching(true);
    setError(null);
    try {
      await launchTeam(selectedId, teamName);
      onClose();
      navigate(`/teams/${encodeURIComponent(teamName)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Launch failed');
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white text-lg font-semibold flex items-center gap-2">
            <Rocket size={18} />
            Launch Team from Template
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-900/30 border border-red-800 rounded-lg">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <div className="space-y-3 mb-4">
          {templates.map(template => (
            <button
              key={template.id}
              onClick={() => setSelectedId(template.id)}
              className={`w-full text-left p-4 rounded-lg border transition-colors ${
                selectedId === template.id
                  ? 'border-purple-500 bg-purple-900/20'
                  : 'border-gray-800 bg-gray-900 hover:bg-gray-800'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-white font-medium">{template.name}</span>
                <div className="flex items-center gap-3 text-gray-400 text-xs">
                  <span className="flex items-center gap-1">
                    <Users size={12} />
                    {template.agents.length} agents
                  </span>
                  <span className="flex items-center gap-1">
                    <ListChecks size={12} />
                    {template.tasks.length} tasks
                  </span>
                </div>
              </div>
              <p className="text-gray-400 text-sm mb-2">{template.description}</p>
              <div className="flex flex-wrap gap-1.5">
                {template.agents.map(agent => (
                  <span
                    key={agent.name}
                    className="px-2 py-0.5 bg-gray-800 rounded-full text-[10px] text-gray-300"
                    title={agent.role}
                  >
                    {agent.name}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>

        <div className="mb-4">
          <label className="block text-gray-400 text-xs font-medium mb-1">Team Name</label>
          <input
            type="text"
            value={teamName}
            onChange={(e) => {
              setTeamName(e.target.value);
              setNameError(null);
            }}
            placeholder="my-team"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-purple-500"
          />
          {nameError && <p className="text-red-400 text-xs mt-1">{nameError}</p>}
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={handleLaunch}
            disabled={!selectedId || !teamName.trim() || launching}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-lg flex items-center gap-2"
          >
            <Rocket size={14} />
            {launching ? 'Launching...' : 'Launch'}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Workflow } from '@flowaibuilder/shared';
import { Plus, Zap, Users, Rocket } from 'lucide-react';
import { listWorkflows, createWorkflow, deleteWorkflow, listTeams } from '../lib/api';
import { WorkflowCard } from '../components/dashboard/WorkflowCard';
import { DeleteConfirmDialog } from '../components/dashboard/DeleteConfirmDialog';
import { LaunchTeamDialog } from '../components/agent-teams/LaunchTeamDialog';
import { QueueStatusCard } from '../components/queue/QueueStatusCard';

export function Dashboard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const teamsRef = useRef<HTMLDivElement>(null);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Workflow | null>(null);
  const [creating, setCreating] = useState(false);
  const [teams, setTeams] = useState<string[]>([]);
  const [showLaunchDialog, setShowLaunchDialog] = useState(false);

  useEffect(() => {
    if (searchParams.get('section') === 'teams' && !loading) {
      teamsRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [searchParams, loading]);

  useEffect(() => {
    listTeams()
      .then(res => setTeams(res.teams ?? []))
      .catch(() => { /* teams not available */ });
    listWorkflows()
      .then((res) => setWorkflows(res.workflows ?? []))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load workflows'))
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const wf = await createWorkflow('Untitled Workflow');
      navigate(`/editor/${wf.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workflow');
      setCreating(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteTarget(null);
    try {
      await deleteWorkflow(id);
      setWorkflows((prev) => prev.filter((wf) => wf.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete workflow');
    }
  }

  return (
    <div className="flex-1 p-6 bg-gray-950 min-h-screen">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-white text-xl font-semibold">Workflows</h1>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm"
        >
          <Plus size={16} />
          {creating ? 'Creating...' : 'New Workflow'}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-800 rounded-lg">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse bg-gray-800 rounded-lg h-32" />
          ))}
        </div>
      )}

      {!loading && workflows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Zap size={48} className="text-gray-700 mb-4" />
          <h2 className="text-gray-400 text-lg font-medium mb-2">No workflows yet</h2>
          <p className="text-gray-600 text-sm mb-6">Create your first workflow to get started</p>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm"
          >
            <Plus size={16} />
            Create your first workflow
          </button>
        </div>
      )}

      {!loading && workflows.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {workflows.map((wf) => (
            <WorkflowCard
              key={wf.id}
              workflow={wf}
              onDelete={(id) => {
                const target = workflows.find((w) => w.id === id);
                if (target) setDeleteTarget(target);
              }}
            />
          ))}
        </div>
      )}

      {/* Queue Status */}
      <div className="mt-8">
        <QueueStatusCard />
      </div>

      {/* Watched Teams */}
      <div ref={teamsRef} className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white text-lg font-semibold flex items-center gap-2">
            <Users size={18} className="text-purple-400" />
            Watched Teams
          </h2>
          <button
            onClick={() => setShowLaunchDialog(true)}
            className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded-lg text-sm"
          >
            <Rocket size={14} />
            Launch Team
          </button>
        </div>
        {teams.length === 0 ? (
          <p className="text-gray-600 text-sm">
            No teams watched. Use Claude Code to run <code className="text-gray-500">watch_team</code> via MCP.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {teams.map(name => (
              <button
                key={name}
                onClick={() => navigate(`/teams/${encodeURIComponent(name)}`)}
                className="p-4 bg-gray-900 border border-gray-800 rounded-lg hover:bg-gray-800 text-left"
              >
                <div className="flex items-center gap-2">
                  <Users size={16} className="text-purple-400" />
                  <span className="text-white text-sm font-medium">{name}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {deleteTarget && (
        <DeleteConfirmDialog
          workflowName={deleteTarget.name}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      <LaunchTeamDialog
        open={showLaunchDialog}
        onClose={() => setShowLaunchDialog(false)}
      />
    </div>
  );
}

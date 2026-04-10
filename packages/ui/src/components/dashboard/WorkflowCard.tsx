import { useNavigate } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import type { Workflow } from '@flowaibuilder/shared';
import { timeAgo } from '../../lib/utils';

interface WorkflowCardProps {
  workflow: Workflow;
  onDelete: (id: string) => void;
}

export function WorkflowCard({ workflow, onDelete }: WorkflowCardProps) {
  const navigate = useNavigate();

  return (
    <div
      onClick={() => navigate(`/editor/${workflow.id}`)}
      className="group relative p-4 bg-gray-900 rounded-lg border border-gray-800 hover:border-purple-500/50 transition-colors cursor-pointer"
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete(workflow.id);
        }}
        className="absolute top-3 right-3 p-1.5 rounded-md text-gray-500 hover:text-red-400 hover:bg-gray-800 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
        aria-label={`Delete ${workflow.name}`}
      >
        <Trash2 size={14} />
      </button>

      <div className="text-white font-medium text-sm truncate pr-8">
        {workflow.name}
      </div>

      {workflow.description && (
        <div className="text-gray-500 text-xs mt-1 truncate">
          {workflow.description}
        </div>
      )}

      <div className="flex items-center gap-3 mt-3">
        <span className="flex items-center gap-1.5 text-xs">
          <span
            className={`w-2 h-2 rounded-full ${workflow.active ? 'bg-green-400' : 'bg-gray-500'}`}
          />
          <span className={workflow.active ? 'text-green-400' : 'text-gray-500'}>
            {workflow.active ? 'Active' : 'Inactive'}
          </span>
        </span>

        <span className="text-gray-600 text-xs">
          {workflow.nodes?.length ?? 0} nodes
        </span>

        <span className="text-gray-600 text-xs">
          v{workflow.version ?? 0}
        </span>
      </div>

      <div className="text-gray-600 text-xs mt-2">
        {timeAgo(workflow.updatedAt)}
      </div>
    </div>
  );
}

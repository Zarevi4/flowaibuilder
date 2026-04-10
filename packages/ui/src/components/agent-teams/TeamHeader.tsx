import { Users } from 'lucide-react';
import type { TeamSnapshot } from '@flowaibuilder/shared';

interface TeamHeaderProps {
  snapshot: TeamSnapshot;
}

export function TeamHeader({ snapshot }: TeamHeaderProps) {
  const { teamName, agents, progress } = snapshot;

  return (
    <div className="flex items-center gap-4 p-4 bg-gray-900 border border-gray-800 rounded-lg">
      <div className="flex items-center gap-2">
        <Users className="w-5 h-5 text-purple-400" />
        <h1 className="text-white font-semibold text-lg">{teamName}</h1>
      </div>

      <span className="px-2 py-0.5 bg-gray-800 text-gray-300 text-xs rounded-full">
        {agents.length} agent{agents.length !== 1 ? 's' : ''}
      </span>

      <div className="flex-1 flex items-center gap-3">
        <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-purple-500 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-gray-400 text-sm whitespace-nowrap">{progress}%</span>
      </div>
    </div>
  );
}

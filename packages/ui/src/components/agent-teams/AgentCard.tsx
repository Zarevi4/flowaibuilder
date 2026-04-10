import { CheckCircle } from 'lucide-react';
import type { AgentInfo, TeamTask } from '@flowaibuilder/shared';

interface AgentCardProps {
  agent: AgentInfo;
  tasks: TeamTask[];
}

const statusColors: Record<AgentInfo['status'], string> = {
  active: 'bg-green-400',
  idle: 'bg-yellow-400',
  blocked: 'bg-red-400',
};

export function AgentCard({ agent, tasks }: AgentCardProps) {
  const currentTask = agent.currentTask
    ? tasks.find(t => t.id === agent.currentTask)
    : null;

  return (
    <div className="min-w-[200px] p-3 bg-gray-900 border border-gray-800 rounded-lg flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${statusColors[agent.status]}`} />
        <span className="text-white text-sm font-medium truncate">{agent.name}</span>
      </div>

      <p className="text-gray-400 text-xs truncate">
        {currentTask ? currentTask.title : 'No active task'}
      </p>

      <div className="flex items-center gap-1 text-gray-500 text-xs">
        <CheckCircle className="w-3 h-3" />
        <span>{agent.completedCount} done</span>
      </div>
    </div>
  );
}

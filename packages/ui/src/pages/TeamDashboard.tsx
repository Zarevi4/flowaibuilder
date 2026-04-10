import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useTeamStore } from '../store/teams';
import { useWsStore } from '../store/ws';
import { TeamHeader } from '../components/agent-teams/TeamHeader';
import { AgentCard } from '../components/agent-teams/AgentCard';
import { TaskBoard } from '../components/agent-teams/TaskBoard';
import { MessageFeed } from '../components/agent-teams/MessageFeed';

export function TeamDashboard() {
  const { teamName } = useParams<{ teamName: string }>();
  const { snapshot, messages, loading, error, loadTeam, clearTeam } = useTeamStore();
  const connectGlobal = useWsStore(s => s.connectGlobal);
  const disconnect = useWsStore(s => s.disconnect);

  useEffect(() => {
    connectGlobal();
    return () => disconnect();
  }, [connectGlobal, disconnect]);

  useEffect(() => {
    if (teamName) loadTeam(teamName);
    return () => clearTeam();
  }, [teamName, loadTeam, clearTeam]);

  if (loading) {
    return (
      <div className="flex-1 p-6 bg-gray-950">
        <div className="animate-pulse bg-gray-800 rounded-lg h-16 mb-4" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="animate-pulse bg-gray-800 rounded-lg h-24" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 p-6 bg-gray-950">
        <div className="p-4 bg-red-900/30 border border-red-800 rounded-lg">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="flex-1 p-6 bg-gray-950">
        <p className="text-gray-400">No team data available.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col gap-4 p-6 bg-gray-950 overflow-hidden">
      <TeamHeader snapshot={snapshot} />

      {/* Agent Cards — horizontal scroll */}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {snapshot.agents.map(agent => (
          <AgentCard key={agent.name} agent={agent} tasks={snapshot.tasks} />
        ))}
        {snapshot.agents.length === 0 && (
          <p className="text-gray-600 text-sm">No agents discovered yet.</p>
        )}
      </div>

      {/* Bottom half: TaskBoard + MessageFeed */}
      <div className="grid grid-cols-2 gap-4 flex-1 min-h-0">
        <div className="overflow-hidden">
          <h2 className="text-gray-400 text-xs font-medium uppercase mb-2">Tasks</h2>
          <TaskBoard tasks={snapshot.tasks} />
        </div>
        <div className="flex flex-col overflow-hidden">
          <h2 className="text-gray-400 text-xs font-medium uppercase mb-2">Messages</h2>
          <div className="flex-1 min-h-0">
            <MessageFeed messages={messages} />
          </div>
        </div>
      </div>
    </div>
  );
}

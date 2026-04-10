import type { TeamTask } from '@flowaibuilder/shared';

interface TaskBoardProps {
  tasks: TeamTask[];
}

const columns = [
  { key: 'unassigned', label: 'Unassigned', statuses: ['unassigned', 'assigned'] },
  { key: 'in-progress', label: 'In Progress', statuses: ['in-progress'] },
  { key: 'blocked', label: 'Blocked', statuses: ['blocked'] },
  { key: 'done', label: 'Done', statuses: ['done'] },
] as const;

export function TaskBoard({ tasks }: TaskBoardProps) {
  return (
    <div className="grid grid-cols-4 gap-3 h-full">
      {columns.map(col => {
        const colTasks = tasks.filter(t => (col.statuses as readonly string[]).includes(t.status));
        return (
          <div key={col.key} className="flex flex-col gap-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-gray-400 text-xs font-medium uppercase">{col.label}</span>
              <span className="text-gray-600 text-xs">{colTasks.length}</span>
            </div>
            <div className="flex flex-col gap-2 overflow-y-auto flex-1">
              {colTasks.map(task => (
                <div key={task.id} className="p-2 bg-gray-900 border border-gray-800 rounded-lg">
                  <p className="text-white text-xs truncate">{task.title}</p>
                  {task.assignee && (
                    <span className="text-gray-500 text-xs">{task.assignee}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export interface InboxMessage {
  id: string;
  from: string;
  message: string;
  timestamp: string;
  read: boolean;
}

export interface TeamTask {
  id: string;
  title: string;
  status: 'unassigned' | 'assigned' | 'in-progress' | 'blocked' | 'done';
  assignee: string | null;
  blockers?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentInfo {
  name: string;
  status: 'active' | 'idle' | 'blocked';
  currentTask: string | null;
  completedCount: number;
  recentMessages: InboxMessage[];
}

export interface TeamSnapshot {
  teamName: string;
  agents: AgentInfo[];
  tasks: TeamTask[];
  progress: number;
  watchedSince: string;
}

export interface TaskNodeLink {
  id: string;
  teamName: string;
  taskId: string;
  workflowId: string;
  nodeId: string;
  createdAt: string;
}

export interface TeamTemplate {
  id: string;
  name: string;
  description: string;
  agents: Array<{ name: string; role: string }>;
  tasks: Array<{ title: string; assignee: string; status: 'unassigned' }>;
}

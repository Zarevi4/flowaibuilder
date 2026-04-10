import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { TeamSnapshot, AgentInfo, TeamTask, InboxMessage } from '@flowaibuilder/shared';

// Mock lucide-react
vi.mock('lucide-react', () => ({
  Users: (props: Record<string, unknown>) => createElement('svg', { 'data-testid': 'users-icon', ...props }),
  CheckCircle: (props: Record<string, unknown>) => createElement('svg', { 'data-testid': 'check-icon', ...props }),
  MessageSquare: (props: Record<string, unknown>) => createElement('svg', { 'data-testid': 'msg-icon', ...props }),
}));

import { TeamHeader } from '../components/agent-teams/TeamHeader';
import { AgentCard } from '../components/agent-teams/AgentCard';
import { TaskBoard } from '../components/agent-teams/TaskBoard';
import { MessageFeed } from '../components/agent-teams/MessageFeed';

function makeSnapshot(): TeamSnapshot {
  return {
    teamName: 'test-team',
    agents: [
      { name: 'agent-1', status: 'active', currentTask: 't1', completedCount: 3, recentMessages: [] },
      { name: 'agent-2', status: 'idle', currentTask: null, completedCount: 0, recentMessages: [] },
      { name: 'agent-3', status: 'blocked', currentTask: 't3', completedCount: 1, recentMessages: [] },
    ],
    tasks: [
      { id: 't1', title: 'Build API', status: 'in-progress', assignee: 'agent-1', createdAt: '', updatedAt: '' },
      { id: 't2', title: 'Write tests', status: 'done', assignee: 'agent-1', createdAt: '', updatedAt: '' },
      { id: 't3', title: 'Fix bug', status: 'blocked', assignee: 'agent-3', blockers: ['dependency'], createdAt: '', updatedAt: '' },
      { id: 't4', title: 'Deploy', status: 'unassigned', assignee: null, createdAt: '', updatedAt: '' },
    ],
    progress: 25,
    watchedSince: '2026-03-28T00:00:00Z',
  };
}

describe('TeamHeader', () => {
  it('renders team name, agent count, and progress bar', () => {
    const snap = makeSnapshot();
    render(createElement(TeamHeader, { snapshot: snap }));

    expect(screen.getByText('test-team')).toBeDefined();
    expect(screen.getByText('3 agents')).toBeDefined();
    expect(screen.getByText('25%')).toBeDefined();
  });

  it('renders singular "agent" for single agent', () => {
    const snap = makeSnapshot();
    snap.agents = [snap.agents[0]];
    render(createElement(TeamHeader, { snapshot: snap }));
    expect(screen.getByText('1 agent')).toBeDefined();
  });

  it('renders progress bar with correct width', () => {
    const snap = makeSnapshot();
    render(createElement(TeamHeader, { snapshot: snap }));
    const progressBar = document.querySelector('[style*="width"]') as HTMLElement;
    expect(progressBar?.style.width).toBe('25%');
  });
});

describe('AgentCard', () => {
  const tasks: TeamTask[] = [
    { id: 't1', title: 'Build API', status: 'in-progress', assignee: 'agent-1', createdAt: '', updatedAt: '' },
  ];

  it('renders agent name and status dot', () => {
    const agent: AgentInfo = { name: 'agent-1', status: 'active', currentTask: 't1', completedCount: 3, recentMessages: [] };
    render(createElement(AgentCard, { agent, tasks }));

    expect(screen.getByText('agent-1')).toBeDefined();
    // Green dot for active
    const dot = document.querySelector('.bg-green-400');
    expect(dot).toBeTruthy();
  });

  it('renders current task title', () => {
    const agent: AgentInfo = { name: 'agent-1', status: 'active', currentTask: 't1', completedCount: 3, recentMessages: [] };
    render(createElement(AgentCard, { agent, tasks }));
    expect(screen.getByText('Build API')).toBeDefined();
  });

  it('shows "No active task" when no current task', () => {
    const agent: AgentInfo = { name: 'agent-2', status: 'idle', currentTask: null, completedCount: 0, recentMessages: [] };
    render(createElement(AgentCard, { agent, tasks }));
    expect(screen.getByText('No active task')).toBeDefined();
  });

  it('shows completed count', () => {
    const agent: AgentInfo = { name: 'agent-1', status: 'active', currentTask: 't1', completedCount: 3, recentMessages: [] };
    render(createElement(AgentCard, { agent, tasks }));
    expect(screen.getByText('3 done')).toBeDefined();
  });

  it('renders blocked status with red dot', () => {
    const agent: AgentInfo = { name: 'agent-3', status: 'blocked', currentTask: null, completedCount: 0, recentMessages: [] };
    render(createElement(AgentCard, { agent, tasks }));
    const dot = document.querySelector('.bg-red-400');
    expect(dot).toBeTruthy();
  });
});

describe('TaskBoard', () => {
  it('renders tasks in correct columns', () => {
    const snap = makeSnapshot();
    render(createElement(TaskBoard, { tasks: snap.tasks }));

    expect(screen.getByText('Build API')).toBeDefined();
    expect(screen.getByText('Write tests')).toBeDefined();
    expect(screen.getByText('Fix bug')).toBeDefined();
    expect(screen.getByText('Deploy')).toBeDefined();
  });

  it('shows assignee labels on tasks', () => {
    const snap = makeSnapshot();
    render(createElement(TaskBoard, { tasks: snap.tasks }));
    expect(screen.getAllByText('agent-1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('agent-3').length).toBeGreaterThan(0);
  });

  it('shows column headers with counts', () => {
    const snap = makeSnapshot();
    render(createElement(TaskBoard, { tasks: snap.tasks }));

    expect(screen.getByText('Unassigned')).toBeDefined();
    expect(screen.getByText('In Progress')).toBeDefined();
    expect(screen.getByText('Blocked')).toBeDefined();
    expect(screen.getByText('Done')).toBeDefined();
  });
});

describe('MessageFeed', () => {
  it('renders messages chronologically with sender and timestamp', () => {
    const messages = [
      { id: 'm1', from: 'agent-1', to: 'agent-2', message: 'Hello there', timestamp: '2026-03-28T10:00:00Z', read: false },
      { id: 'm2', from: 'agent-2', to: 'agent-1', message: 'Hi back', timestamp: '2026-03-28T10:01:00Z', read: true },
    ];
    render(createElement(MessageFeed, { messages }));

    expect(screen.getByText('Hello there')).toBeDefined();
    expect(screen.getByText('Hi back')).toBeDefined();
    expect(screen.getAllByText('agent-1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('agent-2').length).toBeGreaterThan(0);
  });

  it('shows empty state when no messages', () => {
    render(createElement(MessageFeed, { messages: [] }));
    expect(screen.getByText('No messages yet')).toBeDefined();
  });
});

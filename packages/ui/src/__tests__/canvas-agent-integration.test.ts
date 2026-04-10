import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { useWorkflowStore } from '../store/workflow';
import { BaseNode } from '../components/canvas/nodes/BaseNode';
import { agentColor } from '../components/canvas/Canvas';
import type { WebSocketMessage } from '@flowaibuilder/shared';

// ─── Mock @xyflow/react ────────────────────────────────────
vi.mock('@xyflow/react', () => ({
  Handle: function MockHandle(props: Record<string, unknown>) {
    return createElement('div', { 'data-testid': `handle-${props.type}-${props.id}` });
  },
  Position: { Left: 'left', Right: 'right' },
}));

// ─── Mock shared constants ─────────────────────────────────
vi.mock('@flowaibuilder/shared', () => ({
  NODE_TYPES: {
    'http-request': {
      label: 'HTTP Request',
      icon: 'Globe',
      color: '#D85A30',
      category: 'integration',
      inputs: 1,
      outputs: 1,
    },
  },
}));

// ─── Mock icons ────────────────────────────────────────────
vi.mock('../../lib/icons', () => ({
  resolveIcon: vi.fn(() => null),
}));

// ─── Mock Canvas import for agentColor in BaseNode ─────────
vi.mock('../components/canvas/Canvas', () => ({
  agentColor: (name: string) => {
    const colors = [
      'bg-teal-500', 'bg-orange-500', 'bg-amber-500', 'bg-violet-500',
      'bg-rose-500', 'bg-cyan-500', 'bg-lime-500', 'bg-sky-500',
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
    return colors[Math.abs(hash) % colors.length];
  },
}));

vi.mock('../lib/api', () => ({
  getWorkflow: vi.fn(),
  updateWorkflow: vi.fn(),
  updateNode: vi.fn(),
  addNode: vi.fn(),
  deleteNode: vi.fn(),
  addConnection: vi.fn(),
  getTaskLinks: vi.fn().mockResolvedValue({ links: [] }),
}));

import { getTaskLinks } from '../lib/api';
const mockGetTaskLinks = vi.mocked(getTaskLinks);

describe('Workflow Store task_linked_to_node WS handler', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      workflow: { id: 'wf-1', name: 'Test', nodes: [], connections: [] } as any,
      nodes: [],
      edges: [],
      taskLinks: [],
      loading: false,
      error: null,
      fitViewCounter: 0,
    });
  });

  it('appends new task link on task_linked_to_node event', () => {
    const msg: WebSocketMessage = {
      type: 'task_linked_to_node',
      workflowId: 'wf-1',
      data: { teamName: 'alpha', taskId: 't1', nodeId: 'n1' },
      timestamp: new Date().toISOString(),
    };

    useWorkflowStore.getState().applyWsMessage(msg);
    const state = useWorkflowStore.getState();
    expect(state.taskLinks).toHaveLength(1);
    expect(state.taskLinks[0]).toEqual({
      taskId: 't1',
      nodeId: 'n1',
      teamName: 'alpha',
      assignee: null,
      taskStatus: 'unknown',
      taskTitle: '',
    });
  });

  it('updates task status on team_tasks_updated event', () => {
    // Pre-populate a task link
    useWorkflowStore.setState({
      taskLinks: [
        { taskId: 't1', nodeId: 'n1', teamName: 'alpha', assignee: null, taskStatus: 'unknown', taskTitle: '' },
      ],
    });

    const msg: WebSocketMessage = {
      type: 'team_tasks_updated' as any,
      workflowId: '',
      data: {
        teamName: 'alpha',
        tasks: [
          { id: 't1', title: 'Build webhook', status: 'in-progress', assignee: 'api-builder' },
        ],
        progress: 0,
      },
      timestamp: new Date().toISOString(),
    };

    useWorkflowStore.getState().applyWsMessage(msg);
    const state = useWorkflowStore.getState();
    expect(state.taskLinks[0].taskStatus).toBe('in-progress');
    expect(state.taskLinks[0].assignee).toBe('api-builder');
    expect(state.taskLinks[0].taskTitle).toBe('Build webhook');
  });

  it('ignores team_tasks_updated for different team', () => {
    useWorkflowStore.setState({
      taskLinks: [
        { taskId: 't1', nodeId: 'n1', teamName: 'alpha', assignee: null, taskStatus: 'unknown', taskTitle: '' },
      ],
    });

    const msg: WebSocketMessage = {
      type: 'team_tasks_updated' as any,
      workflowId: '',
      data: {
        teamName: 'beta',
        tasks: [{ id: 't2', title: 'Other task', status: 'done', assignee: 'bot' }],
        progress: 100,
      },
      timestamp: new Date().toISOString(),
    };

    useWorkflowStore.getState().applyWsMessage(msg);
    const state = useWorkflowStore.getState();
    expect(state.taskLinks[0].taskStatus).toBe('unknown');
  });

  it('loadTaskLinks fetches and stores task links', async () => {
    mockGetTaskLinks.mockResolvedValue({
      links: [
        { taskId: 't1', nodeId: 'n1', teamName: 'alpha', assignee: 'bot', taskStatus: 'done', taskTitle: 'Done task' },
      ],
    });

    await useWorkflowStore.getState().loadTaskLinks('wf-1');
    const state = useWorkflowStore.getState();
    expect(state.taskLinks).toHaveLength(1);
    expect(state.taskLinks[0].assignee).toBe('bot');
  });
});

describe('BaseNode agent badge', () => {
  const defaultProps = {
    nodeType: 'http-request',
    name: 'My HTTP Node',
  };

  it('renders agent badge when linkedAgent is set', () => {
    const { container } = render(
      createElement(BaseNode, { ...defaultProps, linkedAgent: 'api-builder', linkedTaskTitle: 'Build webhook' }),
    );
    const badge = container.querySelector('.absolute.-bottom-5');
    // Find badge by text content
    const allText = container.textContent;
    expect(allText).toContain('api-builder');
  });

  it('does not render badge when linkedAgent is not set', () => {
    const { container } = render(createElement(BaseNode, defaultProps));
    const allText = container.textContent;
    expect(allText).not.toContain('api-builder');
  });

  it('renders pulsing border when linkedTaskStatus is in-progress', () => {
    const { container } = render(
      createElement(BaseNode, { ...defaultProps, linkedAgent: 'bot', linkedTaskStatus: 'in-progress' }),
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('ring-purple-400');
    expect(wrapper.className).toContain('animate-pulse');
  });

  it('does not render pulsing border when linkedTaskStatus is not in-progress', () => {
    const { container } = render(
      createElement(BaseNode, { ...defaultProps, linkedAgent: 'bot', linkedTaskStatus: 'done' }),
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).not.toContain('ring-purple-400');
  });

  it('execution status takes priority over building indicator', () => {
    const { container } = render(
      createElement(BaseNode, {
        ...defaultProps,
        executionStatus: 'running',
        linkedAgent: 'bot',
        linkedTaskStatus: 'in-progress',
      }),
    );
    const wrapper = container.firstChild as HTMLElement;
    // Should show execution ring, not building ring
    expect(wrapper.className).toContain('ring-blue-400');
    expect(wrapper.className).not.toContain('ring-purple-400');
  });
});

describe('agentColor', () => {
  it('returns a consistent color for the same agent name', () => {
    const color1 = agentColor('api-builder');
    const color2 = agentColor('api-builder');
    expect(color1).toBe(color2);
  });

  it('returns a valid Tailwind bg class', () => {
    const color = agentColor('test-agent');
    expect(color).toMatch(/^bg-\w+-500$/);
  });
});

describe('agentColor', () => {
  // Additional standalone test
  it('different names produce different colors for sufficient variety', () => {
    const colors = new Set(['alpha', 'beta', 'gamma', 'delta', 'epsilon'].map(agentColor));
    expect(colors.size).toBeGreaterThanOrEqual(2);
  });
});

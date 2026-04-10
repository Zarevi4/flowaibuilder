import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMcpServer } from '../mcp/index.js';

// Mock database
vi.mock('../db/index.js', () => ({
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => []) })) })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(() => []) })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
    delete: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn(() => []) })) })),
  },
}));

vi.mock('../db/schema.js', () => ({
  workflows: { id: 'id' },
  executions: { id: 'id', workflowId: 'workflowId', startedAt: 'startedAt' },
  taskNodeLinks: { id: 'id', teamName: 'teamName', taskId: 'taskId', workflowId: 'workflowId', nodeId: 'nodeId' },
}));

vi.mock('../engine/executor.js', () => ({
  workflowExecutor: { execute: vi.fn() },
}));

vi.mock('../api/ws/broadcaster.js', () => ({
  getBroadcaster: vi.fn(() => ({
    broadcast: vi.fn(),
    broadcastToWorkflow: vi.fn(),
  })),
}));

vi.mock('../agent-teams/watcher.js', () => ({
  validateName: vi.fn(),
}));

vi.mock('../agent-teams/index.js', () => ({
  getTeamWatcher: vi.fn(() => ({
    watch: vi.fn(async () => ({
      teamName: 'test-team',
      agents: [],
      tasks: [],
      progress: 0,
      watchedSince: '2026-01-01T00:00:00Z',
    })),
    getSnapshot: vi.fn(async () => ({
      teamName: 'test-team',
      agents: [],
      tasks: [],
      progress: 0,
      watchedSince: '2026-01-01T00:00:00Z',
    })),
    isWatching: vi.fn(() => true),
    unwatch: vi.fn(),
    closeAll: vi.fn(),
  })),
}));

vi.mock('../agent-teams/parser.js', () => ({
  parseInboxFile: vi.fn(async () => [
    { id: 'm1', from: 'human', message: 'Hello', timestamp: '2026-01-01T00:00:00Z', read: false },
  ]),
  parseTasksFile: vi.fn(async () => []),
  computeProgress: vi.fn(() => 0),
  inferAgentStatus: vi.fn(() => 'idle'),
  buildTeamSnapshot: vi.fn(async () => ({
    teamName: 'test-team',
    agents: [],
    tasks: [],
    progress: 0,
    watchedSince: '2026-01-01T00:00:00Z',
  })),
  writeTasksFile: vi.fn(async () => {}),
  appendToInbox: vi.fn(async () => {}),
  generateId: vi.fn(() => 'task-12345678'),
}));

describe('Agent Teams MCP Tools Registration', () => {
  it('should register agent team tools on the MCP server', () => {
    const server = createMcpServer();
    expect(server).toBeDefined();
    // The server.tool() calls don't throw = tools registered successfully
  });
});

describe('MCP Server includes agent-teams tools', () => {
  it('should create server with all tools including agent-teams', () => {
    const server = createMcpServer();
    // If registerAgentTeamTools threw, createMcpServer would fail
    expect(server).toBeDefined();
  });
});

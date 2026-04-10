import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseTasksFile,
  parseInboxFile,
  computeProgress,
  inferAgentStatus,
  buildTeamSnapshot,
} from '../agent-teams/parser.js';
import type { TeamTask } from '@flowaibuilder/shared';

const TEST_DIR = join(tmpdir(), 'flowai-test-parser-' + process.pid);

beforeEach(async () => {
  await mkdir(join(TEST_DIR, 'inboxes'), { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe('parseTasksFile', () => {
  it('should parse valid tasks.json', async () => {
    const tasks = [
      { id: 't1', title: 'Task 1', status: 'done', assignee: 'agent-1', blockers: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      { id: 't2', title: 'Task 2', status: 'in-progress', assignee: 'agent-2', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    ];
    await writeFile(join(TEST_DIR, 'tasks.json'), JSON.stringify(tasks));
    const result = await parseTasksFile(join(TEST_DIR, 'tasks.json'));
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('t1');
    expect(result[0].status).toBe('done');
  });

  it('should return empty array for missing file', async () => {
    const result = await parseTasksFile(join(TEST_DIR, 'nonexistent.json'));
    expect(result).toEqual([]);
  });

  it('should skip invalid tasks and keep valid ones', async () => {
    const data = [
      { id: 't1', title: 'Valid', status: 'done', assignee: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      { id: 't2', title: 'Invalid', status: 'UNKNOWN_STATUS', assignee: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    ];
    await writeFile(join(TEST_DIR, 'tasks.json'), JSON.stringify(data));
    const result = await parseTasksFile(join(TEST_DIR, 'tasks.json'));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('t1');
  });

  it('should return empty array for non-array JSON', async () => {
    await writeFile(join(TEST_DIR, 'tasks.json'), '{"not": "array"}');
    const result = await parseTasksFile(join(TEST_DIR, 'tasks.json'));
    expect(result).toEqual([]);
  });
});

describe('parseInboxFile', () => {
  it('should parse valid inbox messages', async () => {
    const messages = [
      { id: 'm1', from: 'agent-1', message: 'Hello', timestamp: '2026-01-01T00:00:00Z', read: false },
    ];
    const path = join(TEST_DIR, 'inboxes', 'agent-1.json');
    await writeFile(path, JSON.stringify(messages));
    const result = await parseInboxFile(path);
    expect(result).toHaveLength(1);
    expect(result[0].from).toBe('agent-1');
    expect(result[0].read).toBe(false);
  });

  it('should return empty array for missing inbox file', async () => {
    const result = await parseInboxFile(join(TEST_DIR, 'inboxes', 'nonexistent.json'));
    expect(result).toEqual([]);
  });
});

describe('computeProgress', () => {
  it('should return 0 for empty tasks', () => {
    expect(computeProgress([])).toBe(0);
  });

  it('should compute percentage correctly', () => {
    const tasks: TeamTask[] = [
      { id: '1', title: 'A', status: 'done', assignee: null, createdAt: '', updatedAt: '' },
      { id: '2', title: 'B', status: 'in-progress', assignee: null, createdAt: '', updatedAt: '' },
      { id: '3', title: 'C', status: 'done', assignee: null, createdAt: '', updatedAt: '' },
      { id: '4', title: 'D', status: 'unassigned', assignee: null, createdAt: '', updatedAt: '' },
    ];
    expect(computeProgress(tasks)).toBe(50);
  });

  it('should return 100 when all tasks done', () => {
    const tasks: TeamTask[] = [
      { id: '1', title: 'A', status: 'done', assignee: null, createdAt: '', updatedAt: '' },
    ];
    expect(computeProgress(tasks)).toBe(100);
  });
});

describe('inferAgentStatus', () => {
  const tasks: TeamTask[] = [
    { id: '1', title: 'A', status: 'in-progress', assignee: 'alice', createdAt: '', updatedAt: '' },
    { id: '2', title: 'B', status: 'blocked', assignee: 'bob', createdAt: '', updatedAt: '' },
    { id: '3', title: 'C', status: 'done', assignee: 'charlie', createdAt: '', updatedAt: '' },
  ];

  it('should return active for agent with in-progress task', () => {
    expect(inferAgentStatus('alice', tasks)).toBe('active');
  });

  it('should return blocked for agent with blocked task', () => {
    expect(inferAgentStatus('bob', tasks)).toBe('blocked');
  });

  it('should return idle for agent with only done tasks', () => {
    expect(inferAgentStatus('charlie', tasks)).toBe('idle');
  });

  it('should return idle for agent with no tasks', () => {
    expect(inferAgentStatus('nobody', tasks)).toBe('idle');
  });
});

describe('buildTeamSnapshot', () => {
  it('should build complete snapshot from team directory', async () => {
    const tasks = [
      { id: 't1', title: 'Task A', status: 'in-progress', assignee: 'agent-1', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      { id: 't2', title: 'Task B', status: 'done', assignee: 'agent-2', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    ];
    const messages = [
      { id: 'm1', from: 'agent-2', message: 'Done!', timestamp: '2026-01-01T00:00:00Z', read: true },
    ];

    await writeFile(join(TEST_DIR, 'tasks.json'), JSON.stringify(tasks));
    await writeFile(join(TEST_DIR, 'inboxes', 'agent-1.json'), JSON.stringify(messages));
    await writeFile(join(TEST_DIR, 'inboxes', 'agent-2.json'), JSON.stringify([]));

    const snapshot = await buildTeamSnapshot(TEST_DIR, 'test-team', '2026-01-01T00:00:00Z');

    expect(snapshot.teamName).toBe('test-team');
    expect(snapshot.tasks).toHaveLength(2);
    expect(snapshot.progress).toBe(50);
    expect(snapshot.agents).toHaveLength(2);

    const agent1 = snapshot.agents.find(a => a.name === 'agent-1');
    expect(agent1?.status).toBe('active');
    expect(agent1?.currentTask).toBe('t1');
    expect(agent1?.recentMessages).toHaveLength(1);

    const agent2 = snapshot.agents.find(a => a.name === 'agent-2');
    expect(agent2?.status).toBe('idle');
    expect(agent2?.completedCount).toBe(1);
  });

  it('should handle missing inboxes directory', async () => {
    await rm(join(TEST_DIR, 'inboxes'), { recursive: true });
    await writeFile(join(TEST_DIR, 'tasks.json'), JSON.stringify([]));

    const snapshot = await buildTeamSnapshot(TEST_DIR, 'test-team', '2026-01-01T00:00:00Z');
    expect(snapshot.agents).toHaveLength(0);
    expect(snapshot.tasks).toHaveLength(0);
    expect(snapshot.progress).toBe(0);
  });
});

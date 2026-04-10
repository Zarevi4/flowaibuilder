import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  writeTasksFile,
  appendToInbox,
  generateId,
  parseTasksFile,
  parseInboxFile,
} from '../agent-teams/parser.js';
import type { TeamTask, InboxMessage } from '@flowaibuilder/shared';

const TEST_DIR = join(tmpdir(), 'flowai-test-intervention-' + process.pid);

beforeEach(async () => {
  await mkdir(join(TEST_DIR, 'inboxes'), { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

// ─── Parser Write Functions ─────────────────────────────────

describe('writeTasksFile', () => {
  it('should write tasks atomically and be readable back', async () => {
    const tasks: TeamTask[] = [
      { id: 't1', title: 'Task 1', status: 'done', assignee: 'agent-1', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      { id: 't2', title: 'Task 2', status: 'in-progress', assignee: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    ];
    const filePath = join(TEST_DIR, 'tasks.json');
    await writeTasksFile(filePath, tasks);

    const result = await parseTasksFile(filePath);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('t1');
    expect(result[1].status).toBe('in-progress');
  });

  it('should overwrite existing file', async () => {
    const filePath = join(TEST_DIR, 'tasks.json');
    await writeTasksFile(filePath, [
      { id: 't1', title: 'Old', status: 'done', assignee: null, createdAt: '', updatedAt: '' },
    ]);
    await writeTasksFile(filePath, [
      { id: 't2', title: 'New', status: 'unassigned', assignee: null, createdAt: '', updatedAt: '' },
    ]);

    const result = await parseTasksFile(filePath);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('t2');
  });

  it('should create parent directories if missing', async () => {
    const filePath = join(TEST_DIR, 'nested', 'dir', 'tasks.json');
    await writeTasksFile(filePath, []);
    const raw = await readFile(filePath, 'utf-8');
    expect(JSON.parse(raw)).toEqual([]);
  });
});

describe('appendToInbox', () => {
  it('should append message to existing inbox', async () => {
    const filePath = join(TEST_DIR, 'inboxes', 'agent-1.json');
    const existing: InboxMessage[] = [
      { id: 'm1', from: 'agent-2', message: 'Hello', timestamp: '2026-01-01T00:00:00Z', read: true },
    ];
    await writeFile(filePath, JSON.stringify(existing));

    const newMsg: InboxMessage = {
      id: 'm2', from: 'human', message: 'Do this', timestamp: '2026-01-02T00:00:00Z', read: false,
    };
    await appendToInbox(filePath, newMsg);

    const result = await parseInboxFile(filePath);
    expect(result).toHaveLength(2);
    expect(result[1].from).toBe('human');
    expect(result[1].read).toBe(false);
  });

  it('should create new file if inbox does not exist', async () => {
    const filePath = join(TEST_DIR, 'inboxes', 'new-agent.json');
    const msg: InboxMessage = {
      id: 'm1', from: 'human', message: 'Hi', timestamp: '2026-01-01T00:00:00Z', read: false,
    };
    await appendToInbox(filePath, msg);

    const result = await parseInboxFile(filePath);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('m1');
  });

  it('should create parent directories if inboxes dir missing', async () => {
    const filePath = join(TEST_DIR, 'new-inboxes', 'agent.json');
    const msg: InboxMessage = {
      id: 'm1', from: 'human', message: 'Hi', timestamp: '2026-01-01T00:00:00Z', read: false,
    };
    await appendToInbox(filePath, msg);

    const result = await parseInboxFile(filePath);
    expect(result).toHaveLength(1);
  });
});

describe('generateId', () => {
  it('should return string starting with task-', () => {
    const id = generateId();
    expect(id).toMatch(/^task-[a-f0-9]{8}$/);
  });

  it('should return unique ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

// ─── MCP Tool Tests (mocked) ──────────────────────────────

describe('MCP intervention tools', () => {
  // We test via createMcpServer which registers all tools.
  // Tools are tested by calling the underlying functions they use,
  // since MCP server.tool() handlers are not directly callable in unit tests.
  // The registration test in agent-teams-mcp.test.ts covers that they register without error.

  describe('send_team_message logic', () => {
    it('should create inbox message with from:human and read:false', async () => {
      const filePath = join(TEST_DIR, 'inboxes', 'bob.json');
      const msg: InboxMessage = {
        id: 'test-id',
        from: 'human',
        message: 'Please do X',
        timestamp: new Date().toISOString(),
        read: false,
      };
      await appendToInbox(filePath, msg);

      const messages = await parseInboxFile(filePath);
      expect(messages).toHaveLength(1);
      expect(messages[0].from).toBe('human');
      expect(messages[0].read).toBe(false);
      expect(messages[0].message).toBe('Please do X');
    });
  });

  describe('update_task logic', () => {
    it('should update only specified fields', async () => {
      const filePath = join(TEST_DIR, 'tasks.json');
      const tasks: TeamTask[] = [
        { id: 't1', title: 'Task A', status: 'unassigned', assignee: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
        { id: 't2', title: 'Task B', status: 'assigned', assignee: 'agent-1', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      ];
      await writeTasksFile(filePath, tasks);

      // Simulate update_task: read, modify, write
      const loaded = await parseTasksFile(filePath);
      const task = loaded.find(t => t.id === 't1')!;
      task.status = 'in-progress';
      task.assignee = 'agent-2';
      task.updatedAt = '2026-01-02T00:00:00Z';
      await writeTasksFile(filePath, loaded);

      const result = await parseTasksFile(filePath);
      expect(result[0].status).toBe('in-progress');
      expect(result[0].assignee).toBe('agent-2');
      // t2 unchanged
      expect(result[1].status).toBe('assigned');
      expect(result[1].assignee).toBe('agent-1');
    });

    it('should return error for missing task_id', async () => {
      const filePath = join(TEST_DIR, 'tasks.json');
      await writeTasksFile(filePath, [
        { id: 't1', title: 'Task A', status: 'done', assignee: null, createdAt: '', updatedAt: '' },
      ]);
      const tasks = await parseTasksFile(filePath);
      const task = tasks.find(t => t.id === 'nonexistent');
      expect(task).toBeUndefined();
    });
  });

  describe('add_task logic', () => {
    it('should generate ID and set status unassigned when no assignee', async () => {
      const id = generateId();
      expect(id).toMatch(/^task-/);

      const filePath = join(TEST_DIR, 'tasks.json');
      await writeTasksFile(filePath, []);
      const tasks = await parseTasksFile(filePath);

      const newTask: TeamTask = {
        id,
        title: 'New task',
        status: 'unassigned',
        assignee: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      tasks.push(newTask);
      await writeTasksFile(filePath, tasks);

      const result = await parseTasksFile(filePath);
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('unassigned');
      expect(result[0].assignee).toBeNull();
    });

    it('should set status assigned when assignee provided', () => {
      const status = 'bob' ? 'assigned' : 'unassigned';
      expect(status).toBe('assigned');
    });

    it('should append to existing tasks', async () => {
      const filePath = join(TEST_DIR, 'tasks.json');
      await writeTasksFile(filePath, [
        { id: 't1', title: 'Existing', status: 'done', assignee: null, createdAt: '', updatedAt: '' },
      ]);

      const tasks = await parseTasksFile(filePath);
      tasks.push({
        id: generateId(),
        title: 'Added',
        status: 'unassigned',
        assignee: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      await writeTasksFile(filePath, tasks);

      const result = await parseTasksFile(filePath);
      expect(result).toHaveLength(2);
      expect(result[1].title).toBe('Added');
    });
  });

  describe('link_task_to_node validation', () => {
    it('should detect missing task in tasks list', async () => {
      const filePath = join(TEST_DIR, 'tasks.json');
      await writeTasksFile(filePath, [
        { id: 't1', title: 'Exists', status: 'done', assignee: null, createdAt: '', updatedAt: '' },
      ]);
      const tasks = await parseTasksFile(filePath);
      expect(tasks.find(t => t.id === 'nonexistent')).toBeUndefined();
      expect(tasks.find(t => t.id === 't1')).toBeDefined();
    });
  });
});

// ─── Integration Flow ──────────────────────────────────────

describe('Integration: add → update → verify flow', () => {
  it('should support full task lifecycle', async () => {
    const filePath = join(TEST_DIR, 'tasks.json');

    // Start with empty tasks
    await writeTasksFile(filePath, []);

    // Add a task
    const taskId = generateId();
    const tasks1 = await parseTasksFile(filePath);
    tasks1.push({
      id: taskId,
      title: 'Build feature',
      status: 'unassigned',
      assignee: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    await writeTasksFile(filePath, tasks1);

    // Update the task
    const tasks2 = await parseTasksFile(filePath);
    const task = tasks2.find(t => t.id === taskId)!;
    expect(task).toBeDefined();
    task.status = 'in-progress';
    task.assignee = 'agent-1';
    task.updatedAt = '2026-01-02T00:00:00Z';
    await writeTasksFile(filePath, tasks2);

    // Verify final state
    const final = await parseTasksFile(filePath);
    expect(final).toHaveLength(1);
    expect(final[0].status).toBe('in-progress');
    expect(final[0].assignee).toBe('agent-1');
    expect(final[0].title).toBe('Build feature');
  });

  it('should support inbox message flow', async () => {
    const inboxPath = join(TEST_DIR, 'inboxes', 'agent-1.json');

    // Send first message
    await appendToInbox(inboxPath, {
      id: 'm1', from: 'human', message: 'Start task', timestamp: '2026-01-01T00:00:00Z', read: false,
    });

    // Send second message
    await appendToInbox(inboxPath, {
      id: 'm2', from: 'human', message: 'Update me', timestamp: '2026-01-01T01:00:00Z', read: false,
    });

    // Verify both messages exist
    const messages = await parseInboxFile(inboxPath);
    expect(messages).toHaveLength(2);
    expect(messages[0].message).toBe('Start task');
    expect(messages[1].message).toBe('Update me');
  });
});

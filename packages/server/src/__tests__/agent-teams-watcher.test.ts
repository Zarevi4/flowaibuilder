import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TeamFileWatcher } from '../agent-teams/watcher.js';

// Mock broadcaster
vi.mock('../api/ws/broadcaster.js', () => ({
  getBroadcaster: vi.fn(() => ({
    broadcast: vi.fn(),
    broadcastToWorkflow: vi.fn(),
  })),
}));

const TEST_DIR = join(tmpdir(), 'flowai-test-watcher-' + process.pid);
const TEAM_NAME = 'test-team';

// Override homedir to use our test directory
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: () => TEST_DIR,
  };
});

beforeEach(async () => {
  const teamDir = join(TEST_DIR, '.claude', 'teams', TEAM_NAME, 'inboxes');
  await mkdir(teamDir, { recursive: true });

  const tasks = [
    { id: 't1', title: 'Task 1', status: 'in-progress', assignee: 'agent-1', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  ];
  await writeFile(
    join(TEST_DIR, '.claude', 'teams', TEAM_NAME, 'tasks.json'),
    JSON.stringify(tasks),
  );
  await writeFile(
    join(TEST_DIR, '.claude', 'teams', TEAM_NAME, 'inboxes', 'agent-1.json'),
    JSON.stringify([]),
  );
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe('TeamFileWatcher', () => {
  let watcher: TeamFileWatcher;

  beforeEach(() => {
    watcher = new TeamFileWatcher();
  });

  afterEach(() => {
    watcher.closeAll();
  });

  it('should watch a team and return snapshot', async () => {
    const snapshot = await watcher.watch(TEAM_NAME);
    expect(snapshot.teamName).toBe(TEAM_NAME);
    expect(snapshot.tasks).toHaveLength(1);
    expect(snapshot.agents).toHaveLength(1);
    expect(snapshot.agents[0].name).toBe('agent-1');
    expect(snapshot.agents[0].status).toBe('active');
    expect(watcher.isWatching(TEAM_NAME)).toBe(true);
  });

  it('should re-watch on duplicate call (re-attaches watchers)', async () => {
    const first = await watcher.watch(TEAM_NAME);
    const second = await watcher.watch(TEAM_NAME);
    expect(first.teamName).toBe(second.teamName);
    expect(watcher.isWatching(TEAM_NAME)).toBe(true);
  });

  it('should throw for non-existent team directory', async () => {
    await expect(watcher.watch('nonexistent-team')).rejects.toThrow('Team directory not found');
  });

  it('should reject path traversal in team name', async () => {
    await expect(watcher.watch('../evil')).rejects.toThrow('Invalid team_name');
    await expect(watcher.watch('foo/bar')).rejects.toThrow('Invalid team_name');
  });

  it('should unwatch and clean up', async () => {
    await watcher.watch(TEAM_NAME);
    expect(watcher.isWatching(TEAM_NAME)).toBe(true);
    watcher.unwatch(TEAM_NAME);
    expect(watcher.isWatching(TEAM_NAME)).toBe(false);
  });

  it('should get snapshot for watched team', async () => {
    await watcher.watch(TEAM_NAME);
    const snapshot = await watcher.getSnapshot(TEAM_NAME);
    expect(snapshot.teamName).toBe(TEAM_NAME);
    expect(snapshot.tasks).toHaveLength(1);
  });

  it('should throw getSnapshot for unwatched team', async () => {
    await expect(watcher.getSnapshot('unwatched')).rejects.toThrow('not being watched');
  });

  it('should close all watchers', async () => {
    await watcher.watch(TEAM_NAME);
    watcher.closeAll();
    expect(watcher.isWatching(TEAM_NAME)).toBe(false);
  });
});

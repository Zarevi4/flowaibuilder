import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { TeamSnapshot, InboxMessage, TeamTask } from '@flowaibuilder/shared';

const mockGetWatchedTeams = vi.fn<() => string[]>();
const mockIsWatching = vi.fn<(name: string) => boolean>();
const mockGetSnapshot = vi.fn<(name: string) => Promise<TeamSnapshot>>();
const mockGetTeamDir = vi.fn<(name: string) => string>();

vi.mock('../agent-teams/index.js', () => ({
  getTeamWatcher: () => ({
    getWatchedTeams: mockGetWatchedTeams,
    isWatching: mockIsWatching,
    getSnapshot: mockGetSnapshot,
    getTeamDir: mockGetTeamDir,
  }),
}));

vi.mock('../agent-teams/watcher.js', () => ({
  validateName: (name: string, label: string) => {
    if (name.includes('..') || name.includes('/') || name.includes('\\')) {
      throw new Error(`Invalid ${label}`);
    }
  },
}));

const mockReaddir = vi.fn<() => Promise<string[]>>();
const mockParseInboxFile = vi.fn<(path: string) => Promise<InboxMessage[]>>();

vi.mock('node:fs/promises', () => ({
  readdir: (...args: unknown[]) => mockReaddir(),
}));

vi.mock('../agent-teams/parser.js', () => ({
  parseInboxFile: (path: string) => mockParseInboxFile(path),
}));

function makeSnapshot(teamName: string): TeamSnapshot {
  return {
    teamName,
    agents: [
      { name: 'agent-1', status: 'active', currentTask: 't1', completedCount: 2, recentMessages: [] },
    ],
    tasks: [
      { id: 't1', title: 'Task 1', status: 'in-progress', assignee: 'agent-1', createdAt: '', updatedAt: '' },
    ],
    progress: 50,
    watchedSince: new Date().toISOString(),
  };
}

describe('Team REST API Routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify();
    const { teamRoutes } = await import('../api/routes/teams.js');
    await teamRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/teams', () => {
    it('returns list of watched teams', async () => {
      mockGetWatchedTeams.mockReturnValue(['alpha', 'beta']);
      const res = await app.inject({ method: 'GET', url: '/api/teams' });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ teams: ['alpha', 'beta'] });
    });

    it('returns empty list when no teams watched', async () => {
      mockGetWatchedTeams.mockReturnValue([]);
      const res = await app.inject({ method: 'GET', url: '/api/teams' });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ teams: [] });
    });
  });

  describe('GET /api/teams/:teamName', () => {
    it('returns snapshot for watched team', async () => {
      const snap = makeSnapshot('alpha');
      mockIsWatching.mockReturnValue(true);
      mockGetSnapshot.mockResolvedValue(snap);

      const res = await app.inject({ method: 'GET', url: '/api/teams/alpha' });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).teamName).toBe('alpha');
    });

    it('returns 404 for unwatched team', async () => {
      mockIsWatching.mockReturnValue(false);
      const res = await app.inject({ method: 'GET', url: '/api/teams/unknown' });
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for invalid team name', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/teams/..%2Fetc' });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/teams/:teamName/messages', () => {
    it('returns aggregated sorted messages with to field', async () => {
      mockIsWatching.mockReturnValue(true);
      mockGetTeamDir.mockReturnValue('/tmp/teams/alpha');
      mockReaddir.mockResolvedValue(['agent-1.json', 'agent-2.json']);
      mockParseInboxFile.mockImplementation(async (path: string) => {
        if (path.includes('agent-1')) {
          return [{ id: 'm1', from: 'agent-2', message: 'Hello', timestamp: '2026-03-28T10:00:00Z', read: false }];
        }
        return [{ id: 'm2', from: 'agent-1', message: 'Hi', timestamp: '2026-03-28T09:00:00Z', read: true }];
      });

      const res = await app.inject({ method: 'GET', url: '/api/teams/alpha/messages' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.messages).toHaveLength(2);
      // Sorted chronologically — m2 (09:00) before m1 (10:00)
      expect(body.messages[0].id).toBe('m2');
      expect(body.messages[0].to).toBe('agent-2');
      expect(body.messages[1].id).toBe('m1');
      expect(body.messages[1].to).toBe('agent-1');
    });

    it('returns 404 for unwatched team', async () => {
      mockIsWatching.mockReturnValue(false);
      const res = await app.inject({ method: 'GET', url: '/api/teams/unknown/messages' });
      expect(res.statusCode).toBe(404);
    });
  });
});

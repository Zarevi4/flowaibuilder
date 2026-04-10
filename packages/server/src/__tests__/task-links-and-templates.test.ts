import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { TeamSnapshot, TeamTask } from '@flowaibuilder/shared';

// ─── Mocks ─────────────────────────────────────────────────

const mockGetWatchedTeams = vi.fn<() => string[]>();
const mockIsWatching = vi.fn<(name: string) => boolean>();
const mockGetSnapshot = vi.fn<(name: string) => Promise<TeamSnapshot>>();
const mockGetTeamDir = vi.fn<(name: string) => string>();
const mockWatch = vi.fn<(name: string) => Promise<TeamSnapshot>>();

vi.mock('../agent-teams/index.js', () => ({
  getTeamWatcher: () => ({
    getWatchedTeams: mockGetWatchedTeams,
    isWatching: mockIsWatching,
    getSnapshot: mockGetSnapshot,
    getTeamDir: mockGetTeamDir,
    watch: mockWatch,
  }),
}));

vi.mock('../agent-teams/watcher.js', () => ({
  validateName: (name: string, label: string) => {
    if (name.includes('..') || name.includes('/') || name.includes('\\')) {
      throw new Error(`Invalid ${label}`);
    }
  },
}));

const mockDbSelect = vi.fn();
const mockDbFrom = vi.fn();
const mockDbWhere = vi.fn();

vi.mock('../db/index.js', () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: (condition: unknown) => mockDbWhere(),
      }),
    }),
  },
}));

vi.mock('../db/schema.js', () => ({
  workflows: {},
  taskNodeLinks: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
}));

vi.mock('nanoid', () => ({
  nanoid: () => 'test-nanoid',
}));

vi.mock('../api/ws/broadcaster.js', () => ({
  getBroadcaster: () => null,
}));

const mockReaddir = vi.fn<() => Promise<string[]>>();
const mockParseInboxFile = vi.fn();
vi.mock('node:fs/promises', () => ({
  readdir: () => mockReaddir(),
  mkdir: vi.fn(),
}));
vi.mock('../agent-teams/parser.js', () => ({
  parseInboxFile: (path: string) => mockParseInboxFile(path),
  writeTasksFile: vi.fn(),
  generateId: () => `task-${Math.random().toString(36).slice(2, 10)}`,
}));

vi.mock('../agent-teams/templates.js', async () => {
  const actual = await vi.importActual<typeof import('../agent-teams/templates.js')>('../agent-teams/templates.js');
  return {
    getTemplates: actual.getTemplates,
    launchTeamFromTemplate: vi.fn(),
  };
});

function makeSnapshot(teamName: string): TeamSnapshot {
  return {
    teamName,
    agents: [{ name: 'agent-1', status: 'active', currentTask: 't1', completedCount: 0, recentMessages: [] }],
    tasks: [{ id: 't1', title: 'Build webhook', status: 'in-progress', assignee: 'agent-1', createdAt: '', updatedAt: '' }],
    progress: 0,
    watchedSince: new Date().toISOString(),
  };
}

describe('Task Links & Templates REST API', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify();
    const { workflowRoutes } = await import('../api/routes/workflows.js');
    const { teamRoutes } = await import('../api/routes/teams.js');
    await workflowRoutes(app);
    await teamRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/workflows/:workflowId/task-links', () => {
    it('returns enriched task links with live data', async () => {
      mockDbWhere.mockResolvedValue([
        { id: 'link-1', teamName: 'alpha', taskId: 't1', workflowId: 'wf-1', nodeId: 'n1', createdAt: new Date() },
      ]);
      mockIsWatching.mockReturnValue(true);
      mockGetSnapshot.mockResolvedValue(makeSnapshot('alpha'));

      const res = await app.inject({ method: 'GET', url: '/api/workflows/wf-1/task-links' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.links).toHaveLength(1);
      expect(body.links[0]).toEqual({
        taskId: 't1',
        nodeId: 'n1',
        teamName: 'alpha',
        assignee: 'agent-1',
        taskStatus: 'in-progress',
        taskTitle: 'Build webhook',
      });
    });

    it('returns unknown status for unwatched team', async () => {
      mockDbWhere.mockResolvedValue([
        { id: 'link-2', teamName: 'orphan', taskId: 't2', workflowId: 'wf-2', nodeId: 'n2', createdAt: new Date() },
      ]);
      mockIsWatching.mockReturnValue(false);

      const res = await app.inject({ method: 'GET', url: '/api/workflows/wf-2/task-links' });
      const body = JSON.parse(res.body);
      expect(body.links[0].taskStatus).toBe('unknown');
      expect(body.links[0].assignee).toBeNull();
    });

    it('returns empty array when no links exist', async () => {
      mockDbWhere.mockResolvedValue([]);

      const res = await app.inject({ method: 'GET', url: '/api/workflows/wf-3/task-links' });
      const body = JSON.parse(res.body);
      expect(body.links).toEqual([]);
    });
  });

  describe('GET /api/teams/templates', () => {
    it('returns 3 templates', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/teams/templates' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.templates).toHaveLength(3);
      expect(body.templates.map((t: { id: string }) => t.id)).toEqual([
        'webhook-pipeline',
        'ai-workflow',
        'full-stack-automation',
      ]);
    });

    it('each template has required fields', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/teams/templates' });
      const body = JSON.parse(res.body);
      for (const t of body.templates) {
        expect(t).toHaveProperty('id');
        expect(t).toHaveProperty('name');
        expect(t).toHaveProperty('description');
        expect(t.agents.length).toBeGreaterThanOrEqual(3);
        expect(t.tasks.length).toBeGreaterThanOrEqual(5);
      }
    });
  });

  describe('POST /api/teams/launch', () => {
    it('creates team from template and returns snapshot', async () => {
      const { launchTeamFromTemplate } = await import('../agent-teams/templates.js');
      const mockLaunch = vi.mocked(launchTeamFromTemplate);
      const snap = makeSnapshot('my-team');
      mockLaunch.mockResolvedValue(snap);

      const res = await app.inject({
        method: 'POST',
        url: '/api/teams/launch',
        payload: { templateId: 'webhook-pipeline', teamName: 'my-team' },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).teamName).toBe('my-team');
      expect(mockLaunch).toHaveBeenCalledWith('webhook-pipeline', 'my-team');
    });

    it('returns 400 for invalid team name', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/teams/launch',
        payload: { templateId: 'webhook-pipeline', teamName: '../evil' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when missing fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/teams/launch',
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });
  });
});

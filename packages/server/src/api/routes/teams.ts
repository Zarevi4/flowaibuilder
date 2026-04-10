import type { FastifyInstance } from 'fastify';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { basename } from 'node:path';
import { getTeamWatcher } from '../../agent-teams/index.js';
import { validateName } from '../../agent-teams/watcher.js';
import { parseInboxFile } from '../../agent-teams/parser.js';
import { getTemplates, launchTeamFromTemplate } from '../../agent-teams/templates.js';

interface DashboardMessage {
  id: string;
  from: string;
  to: string;
  message: string;
  timestamp: string;
  read: boolean;
}

export async function teamRoutes(app: FastifyInstance) {
  // List watched teams
  app.get('/api/teams', async () => {
    const watcher = getTeamWatcher();
    return { teams: watcher.getWatchedTeams() };
  });

  // Get team snapshot
  app.get<{ Params: { teamName: string } }>('/api/teams/:teamName', async (request, reply) => {
    const { teamName } = request.params;
    try {
      validateName(teamName, 'team_name');
    } catch {
      return reply.code(400).send({ error: 'Invalid team name' });
    }

    const watcher = getTeamWatcher();
    if (!watcher.isWatching(teamName)) {
      return reply.code(404).send({ error: `Team "${teamName}" is not being watched` });
    }

    const snapshot = await watcher.getSnapshot(teamName);
    return snapshot;
  });

  // Get all messages for a team (aggregated from all agent inboxes)
  app.get<{ Params: { teamName: string } }>('/api/teams/:teamName/messages', async (request, reply) => {
    const { teamName } = request.params;
    try {
      validateName(teamName, 'team_name');
    } catch {
      return reply.code(400).send({ error: 'Invalid team name' });
    }

    const watcher = getTeamWatcher();
    if (!watcher.isWatching(teamName)) {
      return reply.code(404).send({ error: `Team "${teamName}" is not being watched` });
    }

    const teamDir = watcher.getTeamDir(teamName);
    const inboxesDir = join(teamDir, 'inboxes');

    let inboxFiles: string[] = [];
    try {
      inboxFiles = (await readdir(inboxesDir)).filter(f => f.endsWith('.json'));
    } catch {
      // inboxes dir may not exist
    }

    const allMessages: DashboardMessage[] = [];
    for (const file of inboxFiles) {
      const agentName = basename(file, '.json');
      const messages = await parseInboxFile(join(inboxesDir, file));
      for (const msg of messages) {
        allMessages.push({ ...msg, to: agentName });
      }
    }

    allMessages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    return { messages: allMessages };
  });

  // Watch a team (REST equivalent of MCP watch_team)
  app.post<{ Params: { teamName: string } }>('/api/teams/:teamName/watch', async (request, reply) => {
    const { teamName } = request.params;
    try {
      validateName(teamName, 'team_name');
    } catch {
      return reply.code(400).send({ error: 'Invalid team name' });
    }

    const watcher = getTeamWatcher();
    try {
      const snapshot = await watcher.watch(teamName);
      return snapshot;
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  // Unwatch a team
  app.post<{ Params: { teamName: string } }>('/api/teams/:teamName/unwatch', async (request, reply) => {
    const { teamName } = request.params;
    const watcher = getTeamWatcher();
    watcher.unwatch(teamName);
    return { unwatched: true, team_name: teamName };
  });

  // List team templates
  app.get('/api/teams/templates', async () => {
    return { templates: getTemplates() };
  });

  // Launch team from template
  app.post<{ Body: { templateId: string; teamName: string } }>('/api/teams/launch', async (request, reply) => {
    const { templateId, teamName } = request.body;
    if (!templateId || !teamName) {
      return reply.code(400).send({ error: 'templateId and teamName are required' });
    }
    try {
      validateName(teamName, 'team_name');
    } catch {
      return reply.code(400).send({ error: 'Invalid team name' });
    }
    try {
      const snapshot = await launchTeamFromTemplate(templateId, teamName);
      return snapshot;
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
}

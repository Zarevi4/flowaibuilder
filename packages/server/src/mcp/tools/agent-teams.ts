import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WorkflowNode } from '@flowaibuilder/shared';
import { getTeamWatcher } from '../../agent-teams/index.js';
import { validateName } from '../../agent-teams/watcher.js';
import { parseInboxFile, parseTasksFile, writeTasksFile, appendToInbox, generateId } from '../../agent-teams/parser.js';
import { launchTeamFromTemplate } from '../../agent-teams/templates.js';
import { join } from 'node:path';
import { db } from '../../db/index.js';
import { workflows, taskNodeLinks } from '../../db/schema.js';
import { getBroadcaster } from '../../api/ws/broadcaster.js';

function mcpError(message: string, extra?: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message, ...extra }) }],
    isError: true,
  };
}

function safeValidateName(name: string, label: string): ReturnType<typeof mcpError> | null {
  try {
    validateName(name, label);
    return null;
  } catch (err) {
    return mcpError((err as Error).message);
  }
}

export function registerAgentTeamTools(server: McpServer) {
  server.tool(
    'flowaibuilder.watch_team',
    {
      team_name: z.string().describe('Team name (directory name under ~/.claude/teams/). Idempotent — re-calling re-attaches watchers for late-created files.'),
    },
    async ({ team_name }) => {
      const nameErr = safeValidateName(team_name, 'team_name');
      if (nameErr) return nameErr;
      const watcher = getTeamWatcher();
      const snapshot = await watcher.watch(team_name);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(snapshot, null, 2) }],
      };
    },
  );

  server.tool(
    'flowaibuilder.get_team_state',
    {
      team_name: z.string().describe('Team name to get current state for'),
    },
    async ({ team_name }) => {
      const nameErr = safeValidateName(team_name, 'team_name');
      if (nameErr) return nameErr;
      const watcher = getTeamWatcher();
      const snapshot = await watcher.getSnapshot(team_name);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(snapshot, null, 2) }],
      };
    },
  );

  server.tool(
    'flowaibuilder.get_agent_messages',
    {
      team_name: z.string().describe('Team name'),
      agent_name: z.string().describe('Agent name to get messages for'),
      limit: z.number().int().min(1).max(100).optional().describe('Max messages to return (default 20)'),
    },
    async ({ team_name, agent_name, limit }) => {
      const nameErr = safeValidateName(team_name, 'team_name');
      if (nameErr) return nameErr;
      const agentErr = safeValidateName(agent_name, 'agent_name');
      if (agentErr) return agentErr;
      const watcher = getTeamWatcher();
      if (!watcher.isWatching(team_name)) {
        return mcpError(`Team "${team_name}" is not being watched. Call watch_team first.`);
      }
      const teamDir = watcher.getTeamDir(team_name);
      const inboxPath = join(teamDir, 'inboxes', `${agent_name}.json`);
      const messages = await parseInboxFile(inboxPath);
      const maxResults = limit ?? 20;
      const sliced = messages.slice(-maxResults);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ agent_name, messages: sliced }, null, 2) }],
      };
    },
  );

  // ─── send_team_message ──────────────────────────────────
  server.tool(
    'flowaibuilder.send_team_message',
    {
      team_name: z.string().describe('Team name'),
      to_agent: z.string().describe('Agent name to send message to'),
      message: z.string().describe('Message text'),
    },
    async ({ team_name, to_agent, message }) => {
      const nameErr = safeValidateName(team_name, 'team_name');
      if (nameErr) return nameErr;
      const agentErr = safeValidateName(to_agent, 'agent_name');
      if (agentErr) return agentErr;
      const watcher = getTeamWatcher();
      if (!watcher.isWatching(team_name)) {
        return mcpError(`Team "${team_name}" is not being watched. Call watch_team first.`);
      }
      const teamDir = watcher.getTeamDir(team_name);
      const inboxPath = join(teamDir, 'inboxes', `${to_agent}.json`);
      const msg = {
        id: randomUUID(),
        from: 'human',
        message,
        timestamp: new Date().toISOString(),
        read: false,
      };
      await appendToInbox(inboxPath, msg);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(msg, null, 2) }],
      };
    },
  );

  // ─── update_task ────────────────────────────────────────
  server.tool(
    'flowaibuilder.update_task',
    {
      team_name: z.string().describe('Team name'),
      task_id: z.string().describe('Task ID to update'),
      changes: z.object({
        status: z.enum(['unassigned', 'assigned', 'in-progress', 'blocked', 'done']).optional(),
        assignee: z.string().nullable().optional(),
        blockers: z.array(z.string()).optional(),
      }).describe('Fields to update'),
    },
    async ({ team_name, task_id, changes }) => {
      const nameErr = safeValidateName(team_name, 'team_name');
      if (nameErr) return nameErr;
      const watcher = getTeamWatcher();
      if (!watcher.isWatching(team_name)) {
        return mcpError(`Team "${team_name}" is not being watched. Call watch_team first.`);
      }
      const teamDir = watcher.getTeamDir(team_name);
      const tasksPath = join(teamDir, 'tasks.json');
      const tasks = await parseTasksFile(tasksPath);
      const task = tasks.find(t => t.id === task_id);
      if (!task) {
        return mcpError('Task not found', { task_id });
      }
      if (changes.status !== undefined) task.status = changes.status;
      if (changes.assignee !== undefined) task.assignee = changes.assignee;
      if (changes.blockers !== undefined) task.blockers = changes.blockers;
      task.updatedAt = new Date().toISOString();
      await writeTasksFile(tasksPath, tasks);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(task, null, 2) }],
      };
    },
  );

  // ─── add_task ───────────────────────────────────────────
  server.tool(
    'flowaibuilder.add_task',
    {
      team_name: z.string().describe('Team name'),
      task: z.object({
        title: z.string(),
        assignee: z.string().optional(),
      }).describe('Task to add'),
    },
    async ({ team_name, task: taskInput }) => {
      const nameErr = safeValidateName(team_name, 'team_name');
      if (nameErr) return nameErr;
      const watcher = getTeamWatcher();
      const teamDir = watcher.getTeamDir(team_name);
      // AC3: team must exist (more lenient — doesn't need to be watched)
      try {
        await access(teamDir);
      } catch {
        return mcpError(`Team directory not found: ${teamDir}`);
      }
      const now = new Date().toISOString();
      const newTask = {
        id: generateId(),
        title: taskInput.title,
        status: (taskInput.assignee ? 'assigned' : 'unassigned') as 'assigned' | 'unassigned',
        assignee: taskInput.assignee ?? null,
        createdAt: now,
        updatedAt: now,
      };
      const tasksPath = join(teamDir, 'tasks.json');
      const tasks = await parseTasksFile(tasksPath);
      tasks.push(newTask);
      await writeTasksFile(tasksPath, tasks);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(newTask, null, 2) }],
      };
    },
  );

  // ─── link_task_to_node ──────────────────────────────────
  server.tool(
    'flowaibuilder.link_task_to_node',
    {
      team_name: z.string().describe('Team name'),
      task_id: z.string().describe('Task ID'),
      workflow_id: z.string().uuid().describe('Workflow ID (UUID)'),
      node_id: z.string().describe('Node ID in the workflow'),
    },
    async ({ team_name, task_id, workflow_id, node_id }) => {
      const nameErr = safeValidateName(team_name, 'team_name');
      if (nameErr) return nameErr;
      const watcher = getTeamWatcher();
      if (!watcher.isWatching(team_name)) {
        return mcpError(`Team "${team_name}" is not being watched. Call watch_team first.`);
      }
      // Validate task exists
      const teamDir = watcher.getTeamDir(team_name);
      const tasks = await parseTasksFile(join(teamDir, 'tasks.json'));
      if (!tasks.find(t => t.id === task_id)) {
        return mcpError('Task not found', { task_id });
      }
      // Validate workflow exists
      const [wf] = await db.select().from(workflows).where(eq(workflows.id, workflow_id));
      if (!wf) {
        return mcpError('Workflow not found', { workflow_id });
      }
      // Validate node exists in workflow
      const nodes = (wf.nodes ?? []) as WorkflowNode[];
      if (!nodes.find(n => n.id === node_id)) {
        return mcpError('Node not found in workflow', { node_id, workflow_id });
      }
      // Insert link
      const [link] = await db.insert(taskNodeLinks).values({
        teamName: team_name,
        taskId: task_id,
        workflowId: workflow_id,
        nodeId: node_id,
      }).returning();
      // Broadcast with enriched task data so canvas badge renders immediately
      const linkedTask = tasks.find(t => t.id === task_id);
      getBroadcaster()?.broadcast('task_linked_to_node', workflow_id, {
        teamName: team_name,
        taskId: task_id,
        workflowId: workflow_id,
        nodeId: node_id,
        assignee: linkedTask?.assignee ?? null,
        taskStatus: linkedTask?.status ?? 'unknown',
        taskTitle: linkedTask?.title ?? '',
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          id: link.id,
          teamName: link.teamName,
          taskId: link.taskId,
          workflowId: link.workflowId,
          nodeId: link.nodeId,
          createdAt: link.createdAt?.toISOString(),
        }, null, 2) }],
      };
    },
  );

  // ─── launch_team ───────────────────────────────────────
  server.tool(
    'flowaibuilder.launch_team',
    {
      template_id: z.string().describe('Template ID (webhook-pipeline, ai-workflow, or full-stack-automation)'),
      team_name: z.string().describe('Name for the new team'),
    },
    async ({ template_id, team_name }) => {
      const nameErr = safeValidateName(team_name, 'team_name');
      if (nameErr) return nameErr;
      try {
        const snapshot = await launchTeamFromTemplate(template_id, team_name);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(snapshot, null, 2) }],
        };
      } catch (err) {
        return mcpError((err as Error).message);
      }
    },
  );
}

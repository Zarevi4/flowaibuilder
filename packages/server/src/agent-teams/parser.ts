import { readFile, writeFile, rename, readdir, mkdir } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { TeamTask, InboxMessage, AgentInfo, TeamSnapshot } from '@flowaibuilder/shared';

const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['unassigned', 'assigned', 'in-progress', 'blocked', 'done']),
  assignee: z.string().nullable(),
  blockers: z.array(z.string()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const InboxMessageSchema = z.object({
  id: z.string(),
  from: z.string(),
  message: z.string(),
  timestamp: z.string(),
  read: z.boolean(),
});

export async function parseTasksFile(filePath: string): Promise<TeamTask[]> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) {
      console.warn(`[agent-teams] tasks.json is not an array at ${filePath}`);
      return [];
    }
    const tasks: TeamTask[] = [];
    for (const item of data) {
      const result = TaskSchema.safeParse(item);
      if (result.success) {
        tasks.push(result.data);
      } else {
        console.warn(`[agent-teams] Skipping invalid task:`, result.error.issues[0]?.message);
      }
    }
    return tasks;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    console.warn(`[agent-teams] Failed to parse tasks file: ${(err as Error).message}`);
    return [];
  }
}

export async function parseInboxFile(filePath: string): Promise<InboxMessage[]> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) {
      console.warn(`[agent-teams] Inbox file is not an array at ${filePath}`);
      return [];
    }
    const messages: InboxMessage[] = [];
    for (const item of data) {
      const result = InboxMessageSchema.safeParse(item);
      if (result.success) {
        messages.push(result.data);
      } else {
        console.warn(`[agent-teams] Skipping invalid message:`, result.error.issues[0]?.message);
      }
    }
    return messages;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    console.warn(`[agent-teams] Failed to parse inbox file: ${(err as Error).message}`);
    return [];
  }
}

export function computeProgress(tasks: TeamTask[]): number {
  if (tasks.length === 0) return 0;
  const done = tasks.filter(t => t.status === 'done').length;
  return Math.round((done / tasks.length) * 100);
}

export function inferAgentStatus(agentName: string, tasks: TeamTask[]): 'active' | 'idle' | 'blocked' {
  const assigned = tasks.filter(t => t.assignee === agentName);
  if (assigned.length === 0) return 'idle';
  if (assigned.some(t => t.status === 'blocked')) return 'blocked';
  if (assigned.some(t => t.status === 'in-progress' || t.status === 'assigned')) return 'active';
  return 'idle';
}

export async function buildTeamSnapshot(teamDir: string, teamName: string, watchedSince: string): Promise<TeamSnapshot> {
  const tasksPath = join(teamDir, 'tasks.json');
  const inboxesDir = join(teamDir, 'inboxes');

  const tasks = await parseTasksFile(tasksPath);
  const progress = computeProgress(tasks);

  // Discover agents from inbox files and task assignees
  const agentNames = new Set<string>();
  for (const task of tasks) {
    if (task.assignee) agentNames.add(task.assignee);
  }

  let inboxFiles: string[] = [];
  try {
    inboxFiles = await readdir(inboxesDir);
  } catch {
    // inboxes dir may not exist yet
  }

  for (const file of inboxFiles) {
    if (file.endsWith('.json')) {
      agentNames.add(basename(file, '.json'));
    }
  }

  const agents: AgentInfo[] = [];
  for (const name of agentNames) {
    const inboxPath = join(inboxesDir, `${name}.json`);
    const messages = await parseInboxFile(inboxPath);
    const status = inferAgentStatus(name, tasks);
    const currentTaskObj = tasks.find(
      t => t.assignee === name && (t.status === 'in-progress' || t.status === 'assigned'),
    );
    const completedCount = tasks.filter(t => t.assignee === name && t.status === 'done').length;

    agents.push({
      name,
      status,
      currentTask: currentTaskObj?.id ?? null,
      completedCount,
      recentMessages: messages.slice(-5),
    });
  }

  return { teamName, agents, tasks, progress, watchedSince };
}

async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = filePath + '.tmp';
  await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  await rename(tmpPath, filePath);
}

export async function writeTasksFile(filePath: string, tasks: TeamTask[]): Promise<void> {
  await atomicWriteJson(filePath, tasks);
}

export async function appendToInbox(filePath: string, message: InboxMessage): Promise<void> {
  let existing: InboxMessage[] = [];
  try {
    const raw = await readFile(filePath, 'utf-8');
    const data = JSON.parse(raw);
    if (Array.isArray(data)) {
      existing = data;
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
  existing.push(message);
  await atomicWriteJson(filePath, existing);
}

export function generateId(): string {
  return `task-${randomUUID().slice(0, 8)}`;
}

import { join } from 'node:path';
import { mkdir, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import type { TeamTemplate, TeamSnapshot, TeamTask } from '@flowaibuilder/shared';
import { validateName } from './watcher.js';
import { writeTasksFile, generateId } from './parser.js';
import { getTeamWatcher } from './index.js';

const templates: TeamTemplate[] = [
  {
    id: 'webhook-pipeline',
    name: 'Webhook Pipeline',
    description: 'A 3-agent team for building webhook-driven data pipelines with validation and review.',
    agents: [
      { name: 'api-builder', role: 'Builds webhook endpoints and HTTP integrations' },
      { name: 'logic-builder', role: 'Implements data transformation and routing logic' },
      { name: 'reviewer', role: 'Reviews workflow quality and suggests improvements' },
    ],
    tasks: [
      { title: 'Set up webhook trigger endpoint', assignee: 'api-builder', status: 'unassigned' },
      { title: 'Parse and validate incoming payload', assignee: 'logic-builder', status: 'unassigned' },
      { title: 'Transform data to target format', assignee: 'logic-builder', status: 'unassigned' },
      { title: 'Send processed data via HTTP request', assignee: 'api-builder', status: 'unassigned' },
      { title: 'Add error handling and retry logic', assignee: 'logic-builder', status: 'unassigned' },
      { title: 'Review workflow for edge cases', assignee: 'reviewer', status: 'unassigned' },
    ],
  },
  {
    id: 'ai-workflow',
    name: 'AI Workflow',
    description: 'A 4-agent team for building AI-powered automation workflows with prompt engineering.',
    agents: [
      { name: 'api-builder', role: 'Builds API integrations and data fetching' },
      { name: 'ai-prompt-engineer', role: 'Designs and optimizes AI prompts' },
      { name: 'error-handler', role: 'Implements error handling and fallback paths' },
      { name: 'reviewer', role: 'Reviews workflow quality and AI output handling' },
    ],
    tasks: [
      { title: 'Set up data ingestion trigger', assignee: 'api-builder', status: 'unassigned' },
      { title: 'Fetch context data from external APIs', assignee: 'api-builder', status: 'unassigned' },
      { title: 'Design system prompt for AI processing', assignee: 'ai-prompt-engineer', status: 'unassigned' },
      { title: 'Configure AI agent node with model settings', assignee: 'ai-prompt-engineer', status: 'unassigned' },
      { title: 'Parse and validate AI response', assignee: 'ai-prompt-engineer', status: 'unassigned' },
      { title: 'Add error handling for API failures', assignee: 'error-handler', status: 'unassigned' },
      { title: 'Add fallback path for AI timeout/errors', assignee: 'error-handler', status: 'unassigned' },
      { title: 'Review end-to-end workflow quality', assignee: 'reviewer', status: 'unassigned' },
    ],
  },
  {
    id: 'full-stack-automation',
    name: 'Full-Stack Automation',
    description: 'A 5-agent team for building complex, multi-step automation workflows with testing.',
    agents: [
      { name: 'architect', role: 'Designs workflow structure and data flow' },
      { name: 'api-builder', role: 'Builds API integrations and webhook handlers' },
      { name: 'ai-builder', role: 'Implements AI-powered processing steps' },
      { name: 'tester', role: 'Tests workflow with sample data and edge cases' },
      { name: 'reviewer', role: 'Final review and optimization suggestions' },
    ],
    tasks: [
      { title: 'Design workflow architecture and data flow', assignee: 'architect', status: 'unassigned' },
      { title: 'Define node types and connection map', assignee: 'architect', status: 'unassigned' },
      { title: 'Build trigger and input validation nodes', assignee: 'api-builder', status: 'unassigned' },
      { title: 'Implement external API integrations', assignee: 'api-builder', status: 'unassigned' },
      { title: 'Configure AI processing nodes', assignee: 'ai-builder', status: 'unassigned' },
      { title: 'Build output formatting and response nodes', assignee: 'ai-builder', status: 'unassigned' },
      { title: 'Create test cases with sample data', assignee: 'tester', status: 'unassigned' },
      { title: 'Test error handling and edge cases', assignee: 'tester', status: 'unassigned' },
      { title: 'Run end-to-end integration test', assignee: 'tester', status: 'unassigned' },
      { title: 'Review and optimize workflow performance', assignee: 'reviewer', status: 'unassigned' },
    ],
  },
];

export function getTemplates(): TeamTemplate[] {
  return templates;
}

export function getTemplateById(id: string): TeamTemplate | undefined {
  return templates.find(t => t.id === id);
}

export async function launchTeamFromTemplate(templateId: string, teamName: string): Promise<TeamSnapshot> {
  const template = getTemplateById(templateId);
  if (!template) throw new Error(`Template "${templateId}" not found`);

  validateName(teamName, 'team_name');
  const base = process.env.CLAUDE_TEAMS_DIR || join(homedir(), '.claude', 'teams');
  const teamDir = join(base, teamName);

  // Prevent overwriting an existing team's data
  try {
    await access(teamDir);
    throw new Error(`Team "${teamName}" already exists`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  await mkdir(teamDir, { recursive: true });
  await mkdir(join(teamDir, 'inboxes'), { recursive: true });

  const now = new Date().toISOString();
  const tasks: TeamTask[] = template.tasks.map(t => ({
    id: generateId(),
    title: t.title,
    status: t.assignee ? 'assigned' as const : 'unassigned' as const,
    assignee: t.assignee || null,
    createdAt: now,
    updatedAt: now,
  }));
  await writeTasksFile(join(teamDir, 'tasks.json'), tasks);

  const watcher = getTeamWatcher();
  return watcher.watch(teamName);
}

import { watch, existsSync } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import type { TeamSnapshot } from '@flowaibuilder/shared';
import { getBroadcaster } from '../api/ws/broadcaster.js';
import { buildTeamSnapshot, parseTasksFile, parseInboxFile, computeProgress } from './parser.js';

interface WatcherEntry {
  teamName: string;
  teamDir: string;
  watchers: FSWatcher[];
  watchedSince: string;
  debounceTimers: Map<string, ReturnType<typeof setTimeout>>;
}

export function validateName(name: string, label: string): void {
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw new Error(`Invalid ${label}: must not contain path separators or ".."`);
  }
}

export class TeamFileWatcher {
  private watched = new Map<string, WatcherEntry>();

  getTeamDir(teamName: string): string {
    const base = process.env.CLAUDE_TEAMS_DIR || join(homedir(), '.claude', 'teams');
    return join(base, teamName);
  }

  async watch(teamName: string): Promise<TeamSnapshot> {
    validateName(teamName, 'team_name');

    // Re-watch: tear down existing watchers so we pick up late-created files
    if (this.watched.has(teamName)) {
      this.unwatchSilent(teamName);
    }

    const teamDir = this.getTeamDir(teamName);
    if (!existsSync(teamDir)) {
      throw new Error(`Team directory not found: ${teamDir}`);
    }

    const watchedSince = new Date().toISOString();
    const entry: WatcherEntry = {
      teamName,
      teamDir,
      watchers: [],
      watchedSince,
      debounceTimers: new Map(),
    };

    // Watch tasks.json
    const tasksPath = join(teamDir, 'tasks.json');
    if (existsSync(tasksPath)) {
      try {
        const w = watch(tasksPath, () => this.onTasksChange(entry));
        entry.watchers.push(w);
      } catch (err) {
        console.warn(`[agent-teams] Could not watch tasks.json: ${(err as Error).message}`);
      }
    }

    // Watch inboxes directory
    const inboxesDir = join(teamDir, 'inboxes');
    if (existsSync(inboxesDir)) {
      try {
        const w = watch(inboxesDir, (_event, filename) => {
          if (filename && filename.endsWith('.json')) {
            this.onInboxChange(entry, filename);
          }
        });
        entry.watchers.push(w);
      } catch (err) {
        console.warn(`[agent-teams] Could not watch inboxes: ${(err as Error).message}`);
      }
    }

    this.watched.set(teamName, entry);

    const snapshot = await buildTeamSnapshot(teamDir, teamName, watchedSince);

    getBroadcaster()?.broadcast('team_watch_started', '', { teamName, snapshot });

    return snapshot;
  }

  unwatch(teamName: string): void {
    this.unwatchSilent(teamName);
    getBroadcaster()?.broadcast('team_watch_stopped', '', { teamName });
  }

  private unwatchSilent(teamName: string): void {
    const entry = this.watched.get(teamName);
    if (!entry) return;

    for (const timer of entry.debounceTimers.values()) {
      clearTimeout(timer);
    }
    for (const w of entry.watchers) {
      w.close();
    }
    this.watched.delete(teamName);
  }

  getWatchedTeams(): string[] {
    return Array.from(this.watched.keys());
  }

  isWatching(teamName: string): boolean {
    return this.watched.has(teamName);
  }

  async getSnapshot(teamName: string): Promise<TeamSnapshot> {
    const entry = this.watched.get(teamName);
    if (!entry) {
      throw new Error(`Team "${teamName}" is not being watched. Call watch_team first.`);
    }
    return buildTeamSnapshot(entry.teamDir, teamName, entry.watchedSince);
  }

  closeAll(): void {
    for (const teamName of [...this.watched.keys()]) {
      this.unwatchSilent(teamName);
    }
  }

  private debounce(entry: WatcherEntry, key: string, fn: () => Promise<void>) {
    const existing = entry.debounceTimers.get(key);
    if (existing) clearTimeout(existing);
    entry.debounceTimers.set(key, setTimeout(() => {
      entry.debounceTimers.delete(key);
      fn().catch(err => {
        console.warn(`[agent-teams] Debounced callback error: ${(err as Error).message}`);
      });
    }, 100));
  }

  private onTasksChange(entry: WatcherEntry) {
    this.debounce(entry, 'tasks', async () => {
      const tasks = await parseTasksFile(join(entry.teamDir, 'tasks.json'));
      const progress = computeProgress(tasks);
      getBroadcaster()?.broadcast('team_tasks_updated', '', {
        teamName: entry.teamName,
        tasks,
        progress,
      });
    });
  }

  private onInboxChange(entry: WatcherEntry, filename: string) {
    this.debounce(entry, `inbox:${filename}`, async () => {
      const agentName = basename(filename, '.json');
      const messages = await parseInboxFile(join(entry.teamDir, 'inboxes', filename));
      getBroadcaster()?.broadcast('agent_messages_updated', '', {
        teamName: entry.teamName,
        agentName,
        messages,
      });
    });
  }
}

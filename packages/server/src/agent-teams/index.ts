import { TeamFileWatcher } from './watcher.js';

let instance: TeamFileWatcher | null = null;

export function createTeamWatcher(): TeamFileWatcher {
  if (instance) {
    instance.closeAll();
  }
  instance = new TeamFileWatcher();
  return instance;
}

export function getTeamWatcher(): TeamFileWatcher {
  if (!instance) throw new Error('TeamFileWatcher not initialized — call createTeamWatcher() first');
  return instance;
}

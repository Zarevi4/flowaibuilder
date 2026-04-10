import type { WorkflowNode, Connection } from './workflow.js';

/**
 * Canonical snapshot of a workflow at a point in time. Stored JSON-encoded
 * in workflow_versions.snapshot. Keys are intentionally minimal — only what
 * we need to reconstruct the graph + presentation during a revert.
 */
export interface WorkflowSnapshot {
  id: string;
  name: string;
  description: string;
  nodes: WorkflowNode[];
  connections: Connection[];
  settings: Record<string, unknown>;
  canvas: Record<string, unknown>;
  tags: string[];
  active: boolean;
  version: number;
  environment?: string;
}

/** List-row shape returned by GET /api/workflows/:id/versions (no heavy snapshot). */
export interface WorkflowVersionMeta {
  id: string;
  version: number;
  gitSha: string | null;
  message: string | null;
  createdBy: string;
  createdAt: string;
}

export interface ChangedNodeEntry {
  id: string;
  before: WorkflowNode;
  after: WorkflowNode;
  changedFields: string[];
}

export interface WorkflowDiff {
  from: number;
  to: number;
  nodes: {
    added: WorkflowNode[];
    removed: WorkflowNode[];
    changed: ChangedNodeEntry[];
  };
  connections: {
    added: Connection[];
    removed: Connection[];
  };
  meta: {
    nameChanged: boolean;
    descriptionChanged: boolean;
    settingsChanged: boolean;
  };
}

/** Git sync config as exposed to clients. The token is NEVER serialized. */
export interface GitSyncConfig {
  repoUrl: string | null;
  branch: string;
  authorName: string | null;
  authorEmail: string | null;
  syncEnabled: boolean;
  /** Present as "***" when a token exists, or null when unset. */
  tokenStatus: '***' | null;
}

import type { LogDestination } from './queue.js';

export interface InstanceSettings {
  id: string;
  timezone: string;
  autoReviewEnabled: boolean;
  errorWorkflowId: string | null;
  updatedAt: string;

  // Git sync (Story 5.3). Token is never serialized in responses; presence
  // is indicated via tokenStatus on GitSyncConfig only.
  gitRepoUrl?: string | null;
  gitBranch?: string;
  gitAuthorName?: string | null;
  gitAuthorEmail?: string | null;
  gitSyncEnabled?: boolean;
  /** Write-only on PUT; never returned. Redacted to "***" on GET. */
  gitToken?: string | null;
  gitTokenStatus?: '***' | null;

  // Log streaming (Story 5.5)
  logStreamDestinations?: LogDestination[];
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  changes?: unknown;
  metadata?: unknown;
}

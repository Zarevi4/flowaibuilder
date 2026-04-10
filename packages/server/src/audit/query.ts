import { and, desc, eq, gte, or, sql, type SQL } from 'drizzle-orm';
import { auditLog } from '../db/schema.js';
import { db } from '../db/index.js';
import type { AuditLogEntry } from '@flowaibuilder/shared';

export interface AuditQueryParams {
  workflowId?: string;
  actor?: string;
  action?: string;
  resourceType?: string;
  since?: string; // ISO date
  limit?: number;
}

export class InvalidAuditQueryError extends Error {}

function toEntry(row: typeof auditLog.$inferSelect): AuditLogEntry {
  return {
    id: row.id,
    timestamp: row.timestamp?.toISOString() ?? new Date().toISOString(),
    actor: row.actor,
    action: row.action,
    resourceType: row.resourceType ?? null,
    resourceId: row.resourceId ?? null,
    changes: row.changes ?? undefined,
    metadata: row.metadata ?? undefined,
  };
}

export function buildAuditFilters(params: AuditQueryParams): SQL[] {
  const filters: SQL[] = [];

  if (params.actor) filters.push(eq(auditLog.actor, params.actor));
  if (params.action) filters.push(eq(auditLog.action, params.action));
  if (params.resourceType) filters.push(eq(auditLog.resourceType, params.resourceType));

  if (params.workflowId) {
    // Match either resource_type='workflow' + resource_id=wf
    // OR metadata.workflow_id = wf (JSON lookup).
    const wfMatch = or(
      and(eq(auditLog.resourceType, 'workflow'), eq(auditLog.resourceId, params.workflowId)),
      sql`${auditLog.metadata}->>'workflow_id' = ${params.workflowId}`,
    );
    if (wfMatch) filters.push(wfMatch);
  }

  if (params.since) {
    const dt = new Date(params.since);
    if (Number.isNaN(dt.getTime())) {
      throw new InvalidAuditQueryError(`Invalid 'since' date: ${params.since}`);
    }
    filters.push(gte(auditLog.timestamp, dt));
  }

  return filters;
}

export async function queryAuditLog(params: AuditQueryParams): Promise<AuditLogEntry[]> {
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
  const filters = buildAuditFilters(params);

  const base = db.select().from(auditLog);
  const rows = filters.length
    ? await base.where(and(...filters)).orderBy(desc(auditLog.timestamp)).limit(limit)
    : await base.orderBy(desc(auditLog.timestamp)).limit(limit);

  return rows.map(toEntry);
}

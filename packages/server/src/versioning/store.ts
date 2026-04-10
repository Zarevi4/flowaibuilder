import { eq, and, desc, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { workflows, workflowVersions } from '../db/schema.js';
import type { WorkflowSnapshot } from '@flowaibuilder/shared';
import { snapshotFromWorkflow } from './diff.js';
import { getBroadcaster } from '../api/ws/broadcaster.js';

export interface RecordSnapshotOptions {
  actor: string;
  message?: string;
  /** Optional Fastify app for audit logging. */
  app?: FastifyInstance;
  /** Skip the version bump (e.g. used by internal re-entry paths). */
  skip?: boolean;
}

export interface RecordedSnapshot {
  id: string;
  version: number;
}

/** Maximum retries on unique(workflowId, version) contention. */
const RECORD_SNAPSHOT_MAX_RETRIES = 3;

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  const msg = err instanceof Error ? err.message : String(err ?? '');
  // Postgres SQLSTATE 23505 = unique_violation.
  return code === '23505' || /unique|duplicate key/i.test(msg);
}

/**
 * Atomically bump workflows.version and insert a workflow_versions row.
 *
 * First call for a workflow writes `version=max(workflows.version, 1)` without
 * producing a gap. Every subsequent call increments by one. The transaction +
 * unique(workflow_id, version) constraint are the concurrency guardrails — two
 * concurrent calls cannot produce the same version int. On unique-violation
 * races the insert is retried up to RECORD_SNAPSHOT_MAX_RETRIES times.
 */
export async function recordSnapshot(
  workflowId: string,
  opts: RecordSnapshotOptions,
): Promise<RecordedSnapshot | null> {
  if (opts.skip) return null;

  const maybeTxn = (db as unknown as {
    transaction?: (cb: (tx: typeof db) => Promise<RecordedSnapshot | null>) => Promise<RecordedSnapshot | null>;
  }).transaction;

  const run = async (tx: typeof db): Promise<RecordedSnapshot | null> => {
    // Lock the row for update. If the drizzle stub doesn't support FOR UPDATE
    // we fall back to a plain select — but we intentionally do NOT swallow
    // unrelated errors (permission, syntax, connection): only ignore the
    // "FOR UPDATE not supported" shape we see from the test stub.
    let row: typeof workflows.$inferSelect | undefined;
    try {
      const locked = await tx.execute?.(
        sql`SELECT * FROM workflows WHERE id = ${workflowId} FOR UPDATE`,
      );
      row = (locked as unknown as { rows?: (typeof workflows.$inferSelect)[] } | undefined)?.rows?.[0];
    } catch (err) {
      // Stub DBs or drivers without FOR UPDATE support return undefined execute
      // or throw a "not a function" error — fall through to plain select.
      if (!/not a function|undefined|is not a function/i.test(String(err))) {
        throw err;
      }
      row = undefined;
    }
    if (!row) {
      const [plain] = await tx.select().from(workflows).where(eq(workflows.id, workflowId));
      row = plain;
    }
    if (!row) return null;

    // Determine whether a version row already exists for this workflow.
    const existing = await tx
      .select({ version: workflowVersions.version })
      .from(workflowVersions)
      .where(eq(workflowVersions.workflowId, workflowId))
      .orderBy(desc(workflowVersions.version))
      .limit(1);

    const hasPrior = Array.isArray(existing) && existing.length > 0;
    const priorMax = hasPrior ? (existing[0].version ?? 1) : 0;
    // Reconcile against workflows.version — imports/seeds may start above 1.
    const rowVersion = row.version ?? 1;
    const nextVersion = hasPrior
      ? Math.max(priorMax, rowVersion) + 1
      : Math.max(rowVersion, 1);

    if (hasPrior || nextVersion !== rowVersion) {
      await tx
        .update(workflows)
        .set({ version: nextVersion })
        .where(eq(workflows.id, workflowId));
      row = { ...row, version: nextVersion };
    }

    const snap = snapshotFromWorkflow(row);
    snap.version = nextVersion;

    const [inserted] = await tx
      .insert(workflowVersions)
      .values({
        workflowId,
        version: nextVersion,
        snapshot: snap as unknown,
        gitSha: null,
        message: opts.message ?? null,
        createdBy: opts.actor,
      })
      .returning();

    return { id: inserted.id, version: nextVersion };
  };

  let recorded: RecordedSnapshot | null = null;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < RECORD_SNAPSHOT_MAX_RETRIES; attempt++) {
    try {
      recorded = maybeTxn ? await maybeTxn(async (tx) => run(tx)) : await run(db);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      if (!isUniqueViolation(err)) throw err;
      // Concurrent writer won the race — retry with a fresh max(version).
    }
  }
  if (lastErr) {
    opts.app?.log?.error({ err: lastErr, workflowId }, 'recordSnapshot failed after retries');
    throw lastErr;
  }

  if (!recorded) return null;

  // Side effects: audit + WS broadcast (fire-and-forget, but errors logged).
  opts.app?.audit
    ?.write({
      actor: opts.actor,
      action: 'workflow.version.created',
      resourceType: 'workflow',
      resourceId: workflowId,
      metadata: { version: recorded.version, message: opts.message ?? null },
    })
    .catch((err) => opts.app?.log?.warn({ err, workflowId }, 'audit write failed'));

  try {
    getBroadcaster()?.broadcastToWorkflow(workflowId, 'workflow_version_created', {
      workflow_id: workflowId,
      version: recorded.version,
      message: opts.message ?? null,
      created_by: opts.actor,
    });
  } catch (err) {
    opts.app?.log?.warn({ err, workflowId }, 'workflow_version_created broadcast failed');
  }

  return recorded;
}

/** Load a specific version row by (workflowId, version). */
export async function getVersion(workflowId: string, version: number) {
  const [row] = await db
    .select()
    .from(workflowVersions)
    .where(and(eq(workflowVersions.workflowId, workflowId), eq(workflowVersions.version, version)));
  return row ?? null;
}

/** List version metadata (no snapshot payload) newest-first. */
export async function listVersions(workflowId: string, limit: number) {
  const rows = await db
    .select({
      id: workflowVersions.id,
      version: workflowVersions.version,
      gitSha: workflowVersions.gitSha,
      message: workflowVersions.message,
      createdBy: workflowVersions.createdBy,
      createdAt: workflowVersions.createdAt,
    })
    .from(workflowVersions)
    .where(eq(workflowVersions.workflowId, workflowId))
    .orderBy(desc(workflowVersions.version))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    gitSha: r.gitSha,
    message: r.message,
    createdBy: r.createdBy,
    createdAt: r.createdAt?.toISOString() ?? null,
  }));
}

/**
 * Revert a workflow to the given stored snapshot, then record a NEW version
 * capturing the revert itself. Active flag is intentionally NOT restored
 * (reverts never flip deployment state per AC #6). Restore + record happen
 * inside a single transaction so a recordSnapshot failure rolls back the
 * destructive UPDATE.
 */
export async function revertToVersion(
  workflowId: string,
  version: number,
  opts: { actor: string; message?: string; app?: FastifyInstance },
): Promise<{ version: number } | null> {
  const target = await getVersion(workflowId, version);
  if (!target) return null;
  const snap = target.snapshot as WorkflowSnapshot | null;
  // Validate shape before a destructive UPDATE — legacy/corrupt rows must not
  // wipe the workflow graph.
  if (!snap || !Array.isArray(snap.nodes) || !Array.isArray(snap.connections)) {
    throw new Error(`Stored snapshot for v${version} is malformed`);
  }

  const maybeTxn = (db as unknown as {
    transaction?: (cb: (tx: typeof db) => Promise<{ version: number } | null>) => Promise<{ version: number } | null>;
  }).transaction;

  const run = async (tx: typeof db): Promise<{ version: number } | null> => {
    await tx
      .update(workflows)
      .set({
        name: snap.name,
        description: snap.description ?? '',
        nodes: snap.nodes,
        connections: snap.connections,
        settings: snap.settings,
        canvas: snap.canvas,
        tags: snap.tags,
        updatedAt: new Date(),
      })
      .where(eq(workflows.id, workflowId));

    // recordSnapshot runs its own transaction; if the outer tx is available
    // we rely on the caller's transaction to group them. On stub DBs where
    // transaction is undefined this still sequences correctly.
    const recorded = await recordSnapshot(workflowId, {
      actor: opts.actor,
      message: opts.message ?? `revert to v${version}`,
      app: opts.app,
    });
    if (!recorded) throw new Error('recordSnapshot returned null during revert');
    return { version: recorded.version };
  };

  const result = maybeTxn ? await maybeTxn(async (tx) => run(tx)) : await run(db);
  if (!result) return null;

  opts.app?.audit
    ?.write({
      actor: opts.actor,
      action: 'workflow.reverted',
      resourceType: 'workflow',
      resourceId: workflowId,
      metadata: { fromVersion: version, toVersion: result.version },
    })
    .catch((err) => opts.app?.log?.warn({ err, workflowId }, 'audit write failed'));

  return result;
}

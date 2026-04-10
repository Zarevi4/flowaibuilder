import { z } from 'zod';
import { eq, and, desc, isNotNull, sql } from 'drizzle-orm';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import { workflowVersions, instanceSettings } from '../../db/schema.js';
import {
  listVersions,
  getVersion,
  revertToVersion,
} from '../../versioning/store.js';
import { pushWorkflow, defaultRepoPath, type ResolvedGitConfig } from '../../versioning/git.js';
import { decrypt } from '../../crypto/aes.js';
import { mcpActor } from '../index.js';

type TextResult = { content: [{ type: 'text'; text: string }] };
const text = (o: unknown): TextResult => ({ content: [{ type: 'text' as const, text: JSON.stringify(o) }] });

// Shared input shapes — `workflow_id` must be a non-empty string (a nanoid
// in practice; see the path-traversal guard in versioning/git.ts which also
// enforces `^[A-Za-z0-9_-]{1,64}$`). `version` must be a positive integer.
const workflowIdSchema = z.string().min(1).max(64);
const versionSchema = z.number().int().positive();
const messageSchema = z.string().min(1).max(1000);

async function loadGitConfig(): Promise<ResolvedGitConfig | { error: string }> {
  const [row] = await db.select().from(instanceSettings).where(eq(instanceSettings.id, 'singleton'));
  if (!row || !row.gitSyncEnabled) return { error: 'git_sync_disabled' };
  if (!row.gitRepoUrl || !row.gitTokenEncrypted || !row.gitAuthorEmail) return { error: 'git_sync_misconfigured' };
  let token: string;
  try { token = decrypt(row.gitTokenEncrypted); } catch { return { error: 'git_token_invalid' }; }
  const rawBranch = (row.gitBranch ?? '').trim();
  return {
    repoUrl: row.gitRepoUrl,
    branch: rawBranch || 'main',
    authorName: row.gitAuthorName ?? 'flowAIbuilder',
    authorEmail: row.gitAuthorEmail,
    token,
    localPath: defaultRepoPath(),
  };
}

export function registerVersioningTools(server: McpServer, app?: FastifyInstance): void {
  server.tool(
    'flowaibuilder.list_workflow_versions',
    {
      workflow_id: workflowIdSchema,
      limit: z.number().int().min(1).max(200).optional(),
    },
    async ({ workflow_id, limit }) => {
      const versions = await listVersions(workflow_id, limit ?? 50);
      return text({ versions });
    },
  );

  server.tool(
    'flowaibuilder.get_workflow_version',
    {
      workflow_id: workflowIdSchema,
      version: versionSchema,
    },
    async ({ workflow_id, version }) => {
      const row = await getVersion(workflow_id, version);
      if (!row) throw new Error(`Version ${version} not found for workflow ${workflow_id}`);
      return text({
        version: row.version,
        snapshot: row.snapshot,
        gitSha: row.gitSha,
        message: row.message,
        createdBy: row.createdBy,
        createdAt: row.createdAt?.toISOString() ?? null,
      });
    },
  );

  server.tool(
    'flowaibuilder.revert_workflow',
    {
      workflow_id: workflowIdSchema,
      version: versionSchema,
      message: messageSchema.optional(),
    },
    async ({ workflow_id, version, message }) => {
      const result = await revertToVersion(workflow_id, version, {
        // Use the active MCP user when available (SSE) — falling back to the
        // generic `mcp:claude-code` label only when no context is set (stdio
        // with no user or pre-context calls).
        actor: mcpActor(),
        message,
        app,
      });
      if (!result) throw new Error(`Version ${version} not found for workflow ${workflow_id}`);
      return text({ reverted: true, version: result.version });
    },
  );

  server.tool(
    'flowaibuilder.git_push',
    {
      workflow_id: workflowIdSchema,
      message: messageSchema,
      version_id: z.string().min(1).optional(),
    },
    async ({ workflow_id, message, version_id }) => {
      const cfg = await loadGitConfig();
      if ('error' in cfg) throw new Error(cfg.error);

      let target: typeof workflowVersions.$inferSelect | undefined;
      if (version_id) {
        const [r] = await db
          .select()
          .from(workflowVersions)
          .where(and(eq(workflowVersions.id, version_id), eq(workflowVersions.workflowId, workflow_id)));
        target = r;
        // Distinguish "version_id exists but not in this workflow" from
        // "no versions at all" — the former indicates a caller mistake.
        if (!target) {
          const [any] = await db
            .select({ id: workflowVersions.id })
            .from(workflowVersions)
            .where(eq(workflowVersions.id, version_id));
          if (any) throw new Error('version_id does not belong to this workflow');
        }
      } else {
        const [r] = await db
          .select()
          .from(workflowVersions)
          .where(eq(workflowVersions.workflowId, workflow_id))
          .orderBy(desc(workflowVersions.version))
          .limit(1);
        target = r;
      }
      if (!target) throw new Error('No version to push');

      const actor = mcpActor();

      if (target.gitSha) {
        // Idempotent short-circuit: already pushed. Still emit an audit
        // entry so downstream tooling can observe the retry attempt.
        app?.audit?.write({
          actor,
          action: 'workflow.git.pushed',
          resourceType: 'workflow',
          resourceId: workflow_id,
          metadata: { sha: target.gitSha, version: target.version, branch: cfg.branch, idempotent: true },
        }).catch((err) => app?.log?.warn({ err, workflow_id }, 'mcp audit write failed'));
        return text({ sha: target.gitSha, version: target.version, message, file: `workflows/${workflow_id}.json` });
      }

      let pushed: { sha: string; file: string };
      try {
        pushed = await pushWorkflow(workflow_id, target.snapshot as never, { message, config: cfg });
      } catch (err) {
        // sanitizeGitError already applied inside pushWorkflow — re-throw
        // the cleaned message to the MCP caller.
        throw err instanceof Error ? err : new Error(String(err));
      }
      // Conditional update: only persist gitSha if it is still null, so a
      // concurrent push cannot overwrite each other's sha. Mirrors the REST
      // /git/push TOCTOU fix from Group A.
      const updated = await db
        .update(workflowVersions)
        .set({ gitSha: pushed.sha })
        .where(and(eq(workflowVersions.id, target.id), sql`${workflowVersions.gitSha} IS NULL`))
        .returning();
      if (updated.length === 0) {
        const [r] = await db.select().from(workflowVersions).where(eq(workflowVersions.id, target.id));
        return text({ sha: r?.gitSha ?? pushed.sha, version: target.version, message, file: pushed.file });
      }
      app?.audit?.write({
        actor,
        action: 'workflow.git.pushed',
        resourceType: 'workflow',
        resourceId: workflow_id,
        metadata: { sha: pushed.sha, version: target.version, branch: cfg.branch },
      }).catch((err) => app?.log?.warn({ err, workflow_id }, 'mcp audit write failed'));
      return text({ sha: pushed.sha, version: target.version, message, file: pushed.file });
    },
  );

  server.tool(
    'flowaibuilder.git_history',
    {
      workflow_id: workflowIdSchema,
    },
    async ({ workflow_id }) => {
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
        .where(and(eq(workflowVersions.workflowId, workflow_id), isNotNull(workflowVersions.gitSha)))
        .orderBy(desc(workflowVersions.version));
      return text({
        history: rows.map((r) => ({
          id: r.id,
          version: r.version,
          gitSha: r.gitSha,
          message: r.message,
          createdBy: r.createdBy,
          createdAt: r.createdAt?.toISOString() ?? null,
        })),
      });
    },
  );
}

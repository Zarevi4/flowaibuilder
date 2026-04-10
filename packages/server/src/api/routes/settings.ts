import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { instanceSettings } from '../../db/schema.js';
import type { InstanceSettings, LogDestination } from '@flowaibuilder/shared';
import { encrypt } from '../../crypto/aes.js';

type SettingsRow = typeof instanceSettings.$inferSelect;

function toSettings(row: SettingsRow): InstanceSettings {
  return {
    id: row.id,
    timezone: row.timezone ?? 'UTC',
    autoReviewEnabled: row.autoReviewEnabled ?? false,
    errorWorkflowId: row.errorWorkflowId ?? null,
    updatedAt: row.updatedAt?.toISOString() ?? new Date().toISOString(),
    gitRepoUrl: row.gitRepoUrl ?? null,
    gitBranch: row.gitBranch ?? 'main',
    gitAuthorName: row.gitAuthorName ?? null,
    gitAuthorEmail: row.gitAuthorEmail ?? null,
    gitSyncEnabled: row.gitSyncEnabled ?? false,
    gitTokenStatus: row.gitTokenEncrypted ? '***' : null,
    logStreamDestinations: (row.logStreamDestinations as LogDestination[] | null) ?? [],
  };
}

async function getOrCreateSettings(): Promise<SettingsRow> {
  const [row] = await db.select().from(instanceSettings).where(eq(instanceSettings.id, 'singleton'));
  if (row) return row;
  await db
    .insert(instanceSettings)
    .values({ id: 'singleton' })
    .onConflictDoNothing({ target: instanceSettings.id });
  const [existing] = await db
    .select()
    .from(instanceSettings)
    .where(eq(instanceSettings.id, 'singleton'));
  if (!existing) {
    throw new Error('failed to initialize instance_settings singleton row');
  }
  return existing;
}

/** Per AC #8, only https:// and ssh:// (or scp-style git@host:path) are
 *  allowed — plaintext http:// would exfiltrate the token to MITM or to a
 *  misconfigured internal host. */
function validateRepoUrl(url: string): boolean {
  return /^https:\/\//i.test(url) || /^git@/i.test(url) || /^ssh:\/\//i.test(url);
}

/** Sentinel used by GET responses to indicate a stored token without
 *  disclosing it. Writing the sentinel back must be a no-op. */
const TOKEN_REDACTED = '***';

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/api/settings', async () => {
    const row = await getOrCreateSettings();
    return toSettings(row);
  });

  app.put<{ Body: Partial<InstanceSettings> }>('/api/settings', async (request, reply) => {
    await getOrCreateSettings();
    const body = request.body ?? {};
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.timezone !== undefined) updates.timezone = body.timezone;
    if (body.autoReviewEnabled !== undefined) updates.autoReviewEnabled = body.autoReviewEnabled;
    if (body.errorWorkflowId !== undefined) updates.errorWorkflowId = body.errorWorkflowId;

    // Git sync fields
    if (body.gitRepoUrl !== undefined) {
      // Reject empty strings and non-https/ssh schemes. Use `== null` so
      // the caller can explicitly null the field to clear it.
      if (body.gitRepoUrl != null && (body.gitRepoUrl === '' || !validateRepoUrl(body.gitRepoUrl))) {
        return reply.code(400).send({ error: 'gitRepoUrl must be https:// or ssh://' });
      }
      updates.gitRepoUrl = body.gitRepoUrl;
    }
    if (body.gitBranch !== undefined) {
      // Basic ref-name sanity: reject whitespace, refspec metacharacters,
      // empty string, and the double-dot escape. isomorphic-git uses this
      // as a string argument (not a shell command), so this is hygiene.
      if (body.gitBranch != null && (
        body.gitBranch === '' || /[\s~^:?*\[\\]|\.\./.test(body.gitBranch)
      )) {
        return reply.code(400).send({ error: 'gitBranch contains invalid characters' });
      }
      updates.gitBranch = body.gitBranch;
    }
    if (body.gitAuthorName !== undefined) updates.gitAuthorName = body.gitAuthorName;
    if (body.gitAuthorEmail !== undefined) updates.gitAuthorEmail = body.gitAuthorEmail;
    if (body.gitSyncEnabled !== undefined) updates.gitSyncEnabled = body.gitSyncEnabled;
    if (body.gitToken !== undefined) {
      // Writing back the redaction sentinel from a GET payload must be a
      // no-op, otherwise the UI's "edit settings" flow would clobber the
      // stored token with the literal string "***".
      if (body.gitToken === TOKEN_REDACTED) {
        // leave updates.gitTokenEncrypted unset — preserve whatever is in DB
      } else if (body.gitToken === null || body.gitToken === '') {
        updates.gitTokenEncrypted = null;
      } else {
        try {
          updates.gitTokenEncrypted = encrypt(body.gitToken);
        } catch {
          return reply.code(400).send({ error: 'failed to encrypt git token' });
        }
      }
    }

    // Log stream destinations (Story 5.5)
    if (body.logStreamDestinations !== undefined) {
      const dests = body.logStreamDestinations;
      if (!Array.isArray(dests)) {
        return reply.code(400).send({ error: 'logStreamDestinations must be an array' });
      }
      for (const dest of dests) {
        if (!['stdout', 'webhook', 's3'].includes(dest.type)) {
          return reply.code(400).send({ error: `Invalid destination type: ${dest.type}. Must be stdout, webhook, or s3` });
        }
        if (dest.type === 'webhook' && (!dest.url || !dest.url.startsWith('https://'))) {
          return reply.code(400).send({ error: 'Webhook destination requires an https:// URL' });
        }
        if (dest.type === 's3' && !dest.bucket) {
          return reply.code(400).send({ error: 'S3 destination requires a bucket name' });
        }
      }
      updates.logStreamDestinations = dests;

      // Write granular audit entry for log stream config changes.
      // Set auditSkip so the generic onResponse middleware doesn't also write
      // a duplicate `settings.updated` entry for this same request.
      if ((app as any).audit?.write) {
        await (app as any).audit.write({
          actor: (request as any).user?.email ?? 'system',
          action: 'log_streaming.configured',
          resourceType: 'settings',
          resourceId: 'singleton',
          metadata: { destinations: dests.map((d: LogDestination) => ({ type: d.type, ...(d.url ? { url: d.url } : {}), ...(d.bucket ? { bucket: d.bucket } : {}) })) },
        });
        // Only suppress generic audit if log stream was the sole change
        const bodyKeys = Object.keys(request.body ?? {});
        if (bodyKeys.length === 1 && bodyKeys[0] === 'logStreamDestinations') {
          (request as any).auditSkip = true;
        }
      }
    }

    // Enforce: if enabling git sync, required fields must be present.
    // Use `in`-check rather than `??` so an explicit null-clear in the same
    // request is correctly detected (null ?? existing would silently pass).
    if (body.gitSyncEnabled === true) {
      const [existing] = await db.select().from(instanceSettings).where(eq(instanceSettings.id, 'singleton'));
      const pick = (k: string) =>
        Object.prototype.hasOwnProperty.call(updates, k)
          ? (updates as Record<string, unknown>)[k]
          : (existing as unknown as Record<string, unknown> | undefined)?.[k];
      const finalRepo = pick('gitRepoUrl') as string | null | undefined;
      const finalName = pick('gitAuthorName') as string | null | undefined;
      const finalEmail = pick('gitAuthorEmail') as string | null | undefined;
      const finalToken = pick('gitTokenEncrypted') as string | null | undefined;
      if (!finalRepo || !finalName || !finalEmail || !finalToken) {
        return reply.code(400).send({
          error: 'git_sync_requires_repo_name_email_token',
        });
      }
    }

    const [row] = await db
      .update(instanceSettings)
      .set(updates)
      .where(eq(instanceSettings.id, 'singleton'))
      .returning();
    return toSettings(row);
  });
}

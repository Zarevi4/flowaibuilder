import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { auditLog } from '../db/schema.js';

export interface AuditEntryInput {
  actor: string;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  changes?: { before?: unknown; after?: unknown } | null;
  metadata?: Record<string, unknown> | null;
}

const SECRET_KEY_RE = /(password|secret|api[_-]?key|token|credential|authorization|dataEncrypted|data_encrypted)/i;
const CREDENTIAL_PARENT_RE = /^credentials?$/i;

/**
 * Deep-clone-and-redact any object so that secret-like fields never reach the DB.
 * Rules:
 *  - Keys matching SECRET_KEY_RE -> "[REDACTED]" (covers credentialValue, apiKey, token, etc.)
 *  - A bare `value` key is redacted ONLY when the parent key is `credential(s)` — this targets
 *    the credentials.value column specifically without clobbering every `{ value: ... }` payload
 *    in execution logs, set nodes, or HTTP bodies.
 *  - Date / Buffer / Map / Set instances pass through unchanged (generic object walk would
 *    flatten them to `{}`).
 *  - A WeakSet tracks visited objects so circular references become `"[Circular]"` instead of
 *    stack-overflowing.
 *  - Input object is never mutated.
 */
export function redactSecrets<T>(input: T): T {
  return redactInner(input, undefined, new WeakSet()) as T;
}

function redactInner(input: unknown, parentKey: string | undefined, seen: WeakSet<object>): unknown {
  if (input == null) return input;
  if (typeof input !== 'object') return input;

  // Pass non-plain objects through untouched — Object.entries() would flatten them to {}.
  if (
    input instanceof Date ||
    input instanceof Map ||
    input instanceof Set ||
    input instanceof RegExp ||
    (typeof Buffer !== 'undefined' && Buffer.isBuffer(input))
  ) {
    return input;
  }

  if (seen.has(input as object)) return '[Circular]';
  seen.add(input as object);

  if (Array.isArray(input)) {
    return input.map((v) => redactInner(v, parentKey, seen));
  }

  const redactValueKey = parentKey !== undefined && CREDENTIAL_PARENT_RE.test(parentKey);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    // A bare `credential`/`credentials` key is a CONTAINER, not a secret value — recurse into
    // it so we can redact its `.value` child, rather than clobbering the whole object.
    const isCredentialContainer = CREDENTIAL_PARENT_RE.test(k);
    if (!isCredentialContainer && SECRET_KEY_RE.test(k)) {
      out[k] = '[REDACTED]';
    } else if (redactValueKey && k === 'value') {
      out[k] = '[REDACTED]';
    } else {
      out[k] = redactInner(v, k, seen);
    }
  }
  return out;
}

export class AuditLogger {
  constructor(private readonly log: FastifyBaseLogger) {}

  async log_(entry: AuditEntryInput): Promise<void> {
    try {
      // Redaction runs inside the try so a thrown redaction error (e.g. exotic object graph)
      // is caught here and routed through app.log.error — audit failures must never break
      // the triggering request (AC #7).
      const changes = entry.changes
        ? {
            before: redactSecrets(entry.changes.before ?? null),
            after: redactSecrets(entry.changes.after ?? null),
          }
        : null;
      const metadata = entry.metadata ? redactSecrets(entry.metadata) : null;

      await db.insert(auditLog).values({
        actor: entry.actor,
        action: entry.action,
        resourceType: entry.resourceType ?? null,
        resourceId: entry.resourceId ?? null,
        changes: changes as unknown,
        metadata: metadata as unknown,
      });
    } catch (err) {
      // Audit failures must NEVER break the user-facing request (AC #7).
      this.log.error({ err, entry: { action: entry.action, actor: entry.actor } }, 'audit log write failed');
    }
  }

  // Public method name used throughout the codebase
  async write(entry: AuditEntryInput): Promise<void> {
    return this.log_(entry);
  }
}

export function registerAuditLogger(app: FastifyInstance): AuditLogger {
  const logger = new AuditLogger(app.log);
  app.decorate('audit', logger);
  return logger;
}

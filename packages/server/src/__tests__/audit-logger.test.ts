import { describe, it, expect, vi } from 'vitest';

// Track audit_log inserts
const inserted: Array<Record<string, unknown>> = [];

vi.mock('../db/index.js', () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn((v: Record<string, unknown>) => {
        inserted.push(v);
        return Promise.resolve();
      }),
    })),
  },
}));

vi.mock('../db/schema.js', () => ({
  auditLog: { _: { name: 'audit_log' } },
}));

import { AuditLogger, redactSecrets } from '../audit/logger.js';

describe('redactSecrets', () => {
  it('redacts keys matching password/secret/token/api_key/credential/authorization', () => {
    const input = {
      username: 'alice',
      password: 'hunter2',
      nested: { api_key: 'abc', token: 'xyz' },
      headers: { Authorization: 'Bearer abc' },
      ok: 1,
    };
    const out = redactSecrets(input);
    expect(out.password).toBe('[REDACTED]');
    expect((out.nested as Record<string, unknown>).api_key).toBe('[REDACTED]');
    expect((out.nested as Record<string, unknown>).token).toBe('[REDACTED]');
    expect((out.headers as Record<string, unknown>).Authorization).toBe('[REDACTED]');
    expect(out.username).toBe('alice');
    expect(out.ok).toBe(1);
  });

  it('redacts `value` only when parent key is credentials (targets credentials.value column)', () => {
    const out = redactSecrets({
      credentials: { name: 'cred', value: 'sk-123' },
      setNode: { field: 'x', value: 42 },
    }) as Record<string, Record<string, unknown>>;
    expect(out.credentials.value).toBe('[REDACTED]');
    expect(out.credentials.name).toBe('cred');
    // Bare `value` outside a credentials parent must NOT be redacted — otherwise execution
    // logs, set-node configs, and HTTP payloads get mangled.
    expect(out.setNode.value).toBe(42);
    expect(out.setNode.field).toBe('x');
  });

  it('handles circular references without stack overflow', () => {
    const obj: Record<string, unknown> = { name: 'x' };
    obj.self = obj;
    const out = redactSecrets(obj) as Record<string, unknown>;
    expect(out.name).toBe('x');
    expect(out.self).toBe('[Circular]');
  });

  it('passes Date / Buffer / Map / Set through unchanged', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    const b = Buffer.from('hello');
    const m = new Map([['k', 'v']]);
    const s = new Set(['a']);
    const out = redactSecrets({ d, b, m, s }) as Record<string, unknown>;
    expect(out.d).toBe(d);
    expect(out.b).toBe(b);
    expect(out.m).toBe(m);
    expect(out.s).toBe(s);
  });

  it('walks arrays', () => {
    const out = redactSecrets([{ password: 'a' }, { ok: 1 }]) as Array<Record<string, unknown>>;
    expect(out[0].password).toBe('[REDACTED]');
    expect(out[1].ok).toBe(1);
  });

  it('does not mutate the input', () => {
    const input = { password: 'plain', nested: { token: 't' } };
    redactSecrets(input);
    expect(input.password).toBe('plain');
    expect(input.nested.token).toBe('t');
  });

  it('is case-insensitive on key match', () => {
    const out = redactSecrets({ PassWord: 'x', API_KEY: 'y' });
    expect(out.PassWord).toBe('[REDACTED]');
    expect(out.API_KEY).toBe('[REDACTED]');
  });

  it('handles null/primitives', () => {
    expect(redactSecrets(null)).toBe(null);
    expect(redactSecrets('hi')).toBe('hi');
    expect(redactSecrets(42)).toBe(42);
  });
});

describe('AuditLogger', () => {
  it('inserts a redacted audit entry', async () => {
    inserted.length = 0;
    const logger = new AuditLogger({
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn(),
      level: 'info',
      silent: vi.fn(),
    } as unknown as Parameters<typeof AuditLogger>[0] extends never
      ? never
      : Parameters<ConstructorParameters<typeof AuditLogger>[0] extends infer T ? never : never>[0] extends never
        ? never
        : Parameters<typeof AuditLogger>[0]);
    await logger.write({
      actor: 'alice@example.com',
      action: 'workflow.created',
      resourceType: 'workflow',
      resourceId: 'wf-1',
      changes: { after: { name: 'x', password: 'secret' } },
      metadata: { ip: '127.0.0.1' },
    });
    expect(inserted).toHaveLength(1);
    const entry = inserted[0] as Record<string, unknown>;
    expect(entry.action).toBe('workflow.created');
    expect(entry.resourceId).toBe('wf-1');
    const changes = entry.changes as { after: Record<string, unknown> };
    expect(changes.after.password).toBe('[REDACTED]');
    expect(changes.after.name).toBe('x');
  });

  it('swallows DB errors and logs via app.log.error (AC #7)', async () => {
    inserted.length = 0;
    const { db } = await import('../db/index.js');
    const boom = vi.fn(() => {
      throw new Error('DB down');
    });
    (db.insert as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      values: boom,
    }));

    const errorFn = vi.fn();
    const logger = new AuditLogger({
      error: errorFn,
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn(),
      level: 'info',
      silent: vi.fn(),
    } as never);

    // Must not throw
    await expect(
      logger.write({ actor: 'a', action: 'x' }),
    ).resolves.toBeUndefined();
    expect(errorFn).toHaveBeenCalled();
  });
});

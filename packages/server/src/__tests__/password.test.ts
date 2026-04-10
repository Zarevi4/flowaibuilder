import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../auth/password.js';

describe('password hashing (AC #1, #2)', () => {
  it('round-trip hash/verify succeeds', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('wrong password fails', async () => {
    const hash = await hashPassword('s3cret!!');
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('hash format matches scrypt$N$r$p$salt$key', async () => {
    const hash = await hashPassword('anything');
    expect(hash).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  });

  it('empty password throws', async () => {
    await expect(hashPassword('')).rejects.toThrow();
  });

  it('malformed stored hash verifies to false', async () => {
    expect(await verifyPassword('x', 'not-a-valid-hash')).toBe(false);
  });
});

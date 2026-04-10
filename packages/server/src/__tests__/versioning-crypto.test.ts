import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, _resetKeyCacheForTests } from '../crypto/aes.js';

describe('AES-256-GCM helper', () => {
  it('round-trips plaintext', () => {
    _resetKeyCacheForTests();
    const cipher = encrypt('ghp_secret_token_xyz');
    expect(cipher).not.toContain('ghp_secret_token_xyz');
    expect(decrypt(cipher)).toBe('ghp_secret_token_xyz');
  });

  it('produces different ciphertext each call (random IV)', () => {
    const a = encrypt('same');
    const b = encrypt('same');
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe('same');
    expect(decrypt(b)).toBe('same');
  });

  it('rejects tampered ciphertext', () => {
    const c = encrypt('secret');
    const parts = c.split('$');
    // flip last byte of ciphertext portion
    const buf = Buffer.from(parts[4], 'base64');
    buf[buf.length - 1] ^= 0xff;
    parts[4] = buf.toString('base64');
    expect(() => decrypt(parts.join('$'))).toThrow();
  });
});

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Password hashing using node's built-in scrypt (stdlib — no dependency).
 *
 * Hash format: `scrypt$N$r$p$saltB64$keyB64`
 *
 * The versioned prefix lets us migrate to argon2id later without any
 * schema change — verifyPassword dispatches on the prefix.
 *
 * TODO(future): upgrade to argon2id once we accept a native dependency.
 */

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem?: number },
) => Promise<Buffer>;

const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;

export async function hashPassword(plain: string): Promise<string> {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new Error('password must be a non-empty string');
  }
  const salt = randomBytes(SALT_LEN);
  const key = await scrypt(plain, salt, KEY_LEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (typeof plain !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = parseInt(parts[1], 10);
  const r = parseInt(parts[2], 10);
  const p = parseInt(parts[3], 10);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  let salt: Buffer;
  let key: Buffer;
  try {
    salt = Buffer.from(parts[4], 'base64');
    key = Buffer.from(parts[5], 'base64');
  } catch {
    return false;
  }
  let derived: Buffer;
  try {
    derived = await scrypt(plain, salt, key.length, { N: n, r, p, maxmem: 128 * 1024 * 1024 });
  } catch {
    return false;
  }
  if (derived.length !== key.length) return false;
  return timingSafeEqual(derived, key);
}

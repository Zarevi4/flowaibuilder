import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * AES-256-GCM symmetric encryption helper (Story 5.3).
 *
 * Wire format: `aesgcm$v1$<ivB64>$<tagB64>$<ciphertextB64>`. The key is
 * derived from the FLOWAI_ENCRYPTION_KEY env var — accepted as either a
 * 32-byte base64 value (preferred) or any ASCII string (passed through
 * scrypt to a deterministic 32-byte key).
 *
 * This helper is INTENTIONALLY self-contained — no external deps, no
 * shared state. Story 5.4 (credentials) will adopt it.
 */

const VERSION = 'v1';
const PREFIX = 'aesgcm';
const ALGO = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 12;

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.FLOWAI_ENCRYPTION_KEY;
  if (!raw || raw.length === 0) {
    // Fail closed in production — a missing env var in prod would otherwise
    // encrypt every git token with a globally-known key derived from a
    // public hardcoded string. Dev still boots, but with a loud warning.
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'FLOWAI_ENCRYPTION_KEY is required in production. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
      );
    }
    // eslint-disable-next-line no-console
    console.warn(
      '[aes] FLOWAI_ENCRYPTION_KEY is not set — falling back to an insecure dev key. Do NOT use this in production.',
    );
    cachedKey = scryptSync('flowai-dev-insecure-key', 'flowai-salt', KEY_LEN);
    return cachedKey;
  }
  try {
    const buf = Buffer.from(raw, 'base64');
    if (buf.length === KEY_LEN) {
      cachedKey = buf;
      return cachedKey;
    }
  } catch {
    // fall through to scrypt
  }
  cachedKey = scryptSync(raw, 'flowai-salt', KEY_LEN);
  return cachedKey;
}

export function encrypt(plain: string): string {
  if (typeof plain !== 'string') throw new Error('encrypt: plain must be string');
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}$${VERSION}$${iv.toString('base64')}$${tag.toString('base64')}$${ct.toString('base64')}`;
}

export function decrypt(stored: string): string {
  if (typeof stored !== 'string') throw new Error('decrypt: stored must be string');
  const parts = stored.split('$');
  if (parts.length !== 5 || parts[0] !== PREFIX || parts[1] !== VERSION) {
    throw new Error('decrypt: invalid format');
  }
  const iv = Buffer.from(parts[2], 'base64');
  const tag = Buffer.from(parts[3], 'base64');
  const ct = Buffer.from(parts[4], 'base64');
  const key = getKey();
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

/** For tests: reset the cached key so changes to FLOWAI_ENCRYPTION_KEY take effect. */
export function _resetKeyCacheForTests(): void {
  cachedKey = null;
}

import fs from 'node:fs';
import path from 'node:path';
import { serializeSnapshot } from './diff.js';
import type { WorkflowSnapshot } from '@flowaibuilder/shared';

/**
 * Thin isomorphic-git wrapper (Story 5.3). The library is loaded lazily so
 * tests can mock it via `vi.mock('isomorphic-git', ...)` before the first
 * call. We intentionally do NOT shell out to a system `git` binary — the
 * Docker image ships without one.
 */

export interface ResolvedGitConfig {
  repoUrl: string;
  branch: string;
  authorName: string;
  authorEmail: string;
  token: string;
  localPath: string;
}

// We intentionally type isomorphic-git as `any` and load it via dynamic
// import — the package may not be installed during type-check runs in CI
// before `npm install` runs, and the git surface we touch is tiny.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GitModule = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HttpModule = any;

let _git: GitModule | null = null;
let _http: HttpModule | null = null;

async function loadGit(): Promise<{ git: GitModule; http: HttpModule }> {
  if (_git && _http) return { git: _git, http: _http };
  // @ts-expect-error — optional runtime dep, loaded lazily.
  const git = await import('isomorphic-git');
  // @ts-expect-error — optional runtime dep, loaded lazily.
  const http = await import('isomorphic-git/http/node/index.js');
  _git = git;
  _http = http;
  return { git, http };
}

/** For tests: inject mocks without importing the real package. */
export function __setGitModulesForTests(git: unknown, http: unknown): void {
  _git = git as GitModule;
  _http = http as HttpModule;
}

export function defaultRepoPath(): string {
  const dataDir = process.env.FLOWAI_DATA_DIR ?? './.flowai';
  return path.join(dataDir, 'git');
}

async function ensureDir(p: string): Promise<void> {
  await fs.promises.mkdir(p, { recursive: true });
}

function onAuth(token: string) {
  return () => ({ username: token, password: 'x-oauth-basic' });
}

/** Strip URL + token patterns from git error messages before surfacing
 *  them to callers or logs. isomorphic-git errors often echo the remote
 *  URL including basic-auth credentials. */
export function sanitizeGitError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err);
  const clean = raw
    .replace(/https?:\/\/[^\s]+/gi, '[redacted-url]')
    .replace(/(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, '[redacted-token]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]');
  const out = new Error(clean);
  // Preserve stack for logging but with scrubbed message up top.
  if (err instanceof Error && err.stack) {
    out.stack = clean + '\n' + err.stack.split('\n').slice(1).join('\n');
  }
  return out;
}

/** Reject workflow ids that could escape the `workflows/` subtree when
 *  used as a file path inside the git repo. The DB column is a nanoid
 *  so this is defense-in-depth against a future loosening / custom id. */
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
function assertSafeWorkflowId(id: string): void {
  if (typeof id !== 'string' || !SAFE_ID_RE.test(id)) {
    throw new Error(`unsafe workflow id for git path: ${JSON.stringify(id)}`);
  }
}

/** Serialize access to the shared git working tree — two concurrent
 *  pushWorkflow calls must not interleave writeFile/add/commit/push or
 *  they can corrupt .git/index or produce commits with the wrong file.
 *  A simple per-process promise chain is sufficient for the single-node
 *  deployment model; multi-node would need a filesystem lock or DB lock. */
let _repoLock: Promise<unknown> = Promise.resolve();
function withRepoLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = _repoLock.then(fn, fn);
  // Swallow errors from the previous holder so the chain keeps moving.
  _repoLock = next.catch(() => undefined);
  return next;
}

export async function initRepo(config: ResolvedGitConfig): Promise<void> {
  const { git, http } = await loadGit();
  await ensureDir(config.localPath);
  const gitDir = path.join(config.localPath, '.git');
  if (!fs.existsSync(gitDir)) {
    try {
      await git.clone({
        fs,
        http,
        dir: config.localPath,
        url: config.repoUrl,
        ref: config.branch,
        singleBranch: true,
        depth: 1,
        onAuth: onAuth(config.token),
      });
    } catch (err) {
      throw sanitizeGitError(err);
    }
    return;
  }
  // Fast-forward existing checkout.
  try {
    await git.fetch({
      fs,
      http,
      dir: config.localPath,
      remote: 'origin',
      ref: config.branch,
      onAuth: onAuth(config.token),
    });
    await git.pull({
      fs,
      http,
      dir: config.localPath,
      ref: config.branch,
      fastForwardOnly: true,
      author: { name: config.authorName, email: config.authorEmail },
      onAuth: onAuth(config.token),
    });
  } catch (err) {
    // Non-fatal: the subsequent push will surface the real error. But log
    // the scrubbed message so the operator can debug divergence instead of
    // silently hitting a non-fast-forward push failure later.
    // eslint-disable-next-line no-console
    console.warn('[git] fetch/pull failed during initRepo:', sanitizeGitError(err).message);
  }
}

export interface PushResult {
  sha: string;
  file: string;
}

export async function pushWorkflow(
  workflowId: string,
  snapshot: WorkflowSnapshot,
  opts: { message: string; config: ResolvedGitConfig },
): Promise<PushResult> {
  assertSafeWorkflowId(workflowId);
  return withRepoLock(async () => {
    const { git, http } = await loadGit();
    try {
      await initRepo(opts.config);
      const filepath = `workflows/${workflowId}.json`;
      const absFile = path.join(opts.config.localPath, filepath);
      // Defense-in-depth: verify the resolved absolute path is still inside
      // the configured localPath after all normalization.
      const resolvedRoot = path.resolve(opts.config.localPath);
      const resolvedFile = path.resolve(absFile);
      if (!resolvedFile.startsWith(resolvedRoot + path.sep)) {
        throw new Error('workflow path escapes repo root');
      }
      await ensureDir(path.dirname(absFile));
      await fs.promises.writeFile(absFile, serializeSnapshot(snapshot), 'utf8');

      await git.add({ fs, dir: opts.config.localPath, filepath });
      const sha = await git.commit({
        fs,
        dir: opts.config.localPath,
        message: opts.message,
        author: {
          name: opts.config.authorName || opts.config.authorEmail,
          email: opts.config.authorEmail,
        },
      });
      await git.push({
        fs,
        http,
        dir: opts.config.localPath,
        remote: 'origin',
        ref: opts.config.branch,
        onAuth: onAuth(opts.config.token),
      });

      return { sha, file: filepath };
    } catch (err) {
      // Re-throw with any token/URL stripped so callers that surface this
      // message to clients or audit logs cannot leak credentials.
      throw sanitizeGitError(err);
    }
  });
}

export async function getHeadSha(localPath: string): Promise<string | null> {
  try {
    const { git } = await loadGit();
    return await git.resolveRef({ fs, dir: localPath, ref: 'HEAD' });
  } catch {
    return null;
  }
}

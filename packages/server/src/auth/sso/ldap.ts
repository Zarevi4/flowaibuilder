/**
 * LDAP SSO adapter — wraps ldapts.
 *
 * Config via env:
 *   LDAP_URL             — ldap://host:port
 *   LDAP_BIND_DN         — service account DN used to search for the user
 *   LDAP_BIND_PASSWORD
 *   LDAP_SEARCH_BASE
 *   LDAP_SEARCH_FILTER   — default (uid={{username}})
 *
 * LDAP does NOT use a redirect flow — the user POSTs { username, password }
 * directly to /api/auth/sso/login and we bind as them.
 *
 * NOT using Lucia Auth (deprecated March 2025) — see sso/index.ts.
 */

interface LdapEntry {
  dn: string;
  mail?: string | string[];
  cn?: string | string[];
  displayName?: string | string[];
  uid?: string | string[];
  [k: string]: unknown;
}

type LdapClient = {
  bind(dn: string, password: string): Promise<void>;
  search(
    base: string,
    options: { scope: string; filter: string },
  ): Promise<{ searchEntries: LdapEntry[] }>;
  unbind(): Promise<void>;
};

function one(val: string | string[] | undefined): string | undefined {
  if (!val) return undefined;
  return Array.isArray(val) ? val[0] : val;
}

/**
 * RFC 4515 filter value escaping. Without this, an attacker-supplied
 * username like `*)(uid=*` injects into the search filter and matches
 * arbitrary entries. Escape: `\` → `\5c`, `*` → `\2a`, `(` → `\28`,
 * `)` → `\29`, NUL → `\00`.
 */
function escapeLdapFilter(value: string): string {
  return value.replace(/[\\*()\0]/g, (c) => {
    switch (c) {
      case '\\': return '\\5c';
      case '*': return '\\2a';
      case '(': return '\\28';
      case ')': return '\\29';
      case '\0': return '\\00';
      default: return c;
    }
  });
}

async function newClient(url: string): Promise<LdapClient> {
  const mod = (await import('ldapts')) as unknown as {
    Client?: new (opts: { url: string }) => LdapClient;
  };
  const Client = mod.Client as new (opts: { url: string }) => LdapClient;
  return new Client({ url });
}

export const ldapAdapter = {
  async generateLoginUrl(): Promise<never> {
    throw new Error('ldap_uses_direct_bind');
  },
  async validateResponse(): Promise<never> {
    throw new Error('ldap_uses_direct_bind');
  },
  async authenticate(payload: unknown): Promise<{
    provider: 'ldap';
    ssoId: string;
    email: string;
    name?: string;
  }> {
    const url = process.env.LDAP_URL;
    const bindDn = process.env.LDAP_BIND_DN;
    const bindPw = process.env.LDAP_BIND_PASSWORD;
    const base = process.env.LDAP_SEARCH_BASE;
    const filterTpl = process.env.LDAP_SEARCH_FILTER ?? '(uid={{username}})';
    if (!url || !bindDn || !bindPw || !base) throw new Error('sso_not_configured');

    const body = (payload ?? {}) as { username?: string; password?: string };
    if (!body.username || !body.password) throw new Error('missing_credentials');
    if (body.password.trim().length === 0) throw new Error('missing_credentials');

    const filter = filterTpl.replace('{{username}}', escapeLdapFilter(body.username));

    // Service bind → search → user bind
    const serviceClient = await newClient(url);
    try {
      await serviceClient.bind(bindDn, bindPw);
      const { searchEntries } = await serviceClient.search(base, { scope: 'sub', filter });
      if (searchEntries.length === 0) throw new Error('user_not_found');
      const entry = searchEntries[0];

      const userClient = await newClient(url);
      try {
        await userClient.bind(entry.dn, body.password);
      } finally {
        await userClient.unbind().catch(() => undefined);
      }

      // Require a real mail attribute — synthetic `${username}@local` collides
      // with the `users.email` unique constraint and creates account ambiguity.
      const email = one(entry.mail);
      if (!email) throw new Error('ldap_missing_mail');
      const name = one(entry.displayName) ?? one(entry.cn);
      return { provider: 'ldap', ssoId: entry.dn, email, name };
    } finally {
      await serviceClient.unbind().catch(() => undefined);
    }
  },
};

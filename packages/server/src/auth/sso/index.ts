/**
 * SSO provider dispatch.
 *
 * DESIGN NOTE — We intentionally do NOT use Lucia Auth despite the
 * architecture doc referencing it. Lucia v3 was deprecated in March 2025.
 * flowAIbuilder uses node:crypto.scrypt + a thin sessions table instead
 * (see auth/password.ts, auth/sessions.ts). This decision is documented
 * in code rather than a changelog so future readers understand why the
 * architecture doc and source disagree.
 *
 * Providers are loaded lazily so that unconfigured instances don't need
 * the heavy SAML/LDAP deps at boot.
 */

export type SsoOp = 'generateLoginUrl' | 'authenticate' | 'validateResponse';

export function ssoProviderConfigured(): boolean {
  const p = process.env.SSO_PROVIDER;
  return p === 'saml' || p === 'ldap';
}

export async function dispatchSso(op: SsoOp, payload: unknown): Promise<unknown> {
  const provider = process.env.SSO_PROVIDER;
  if (provider === 'saml') {
    const { samlAdapter } = await import('./saml.js');
    return samlAdapter[op](payload);
  }
  if (provider === 'ldap') {
    const { ldapAdapter } = await import('./ldap.js');
    return ldapAdapter[op](payload);
  }
  throw new Error('sso_not_configured');
}

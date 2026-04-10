/**
 * SAML SSO adapter — wraps @node-saml/node-saml.
 *
 * Config via env:
 *   SAML_ENTRY_POINT    — IdP SSO URL
 *   SAML_ISSUER         — SP entity ID
 *   SAML_CERT           — IdP signing cert (PEM)
 *   SAML_CALLBACK_URL   — our /api/auth/sso/callback absolute URL
 *
 * NOT using Lucia Auth (deprecated March 2025) — see sso/index.ts.
 */
import { randomBytes } from 'node:crypto';

interface SamlProfile {
  nameID: string;
  email?: string;
  mail?: string;
  displayName?: string;
  cn?: string;
  [k: string]: unknown;
}

type SamlInstance = {
  getAuthorizeUrlAsync: (relayState: string, host: string, options: unknown) => Promise<string>;
  validatePostResponseAsync: (body: { SAMLResponse: string }) => Promise<{
    profile: SamlProfile | null;
    loggedOut: boolean;
  }>;
};

let cached: SamlInstance | null = null;

async function getInstance(): Promise<SamlInstance> {
  if (cached) return cached;
  const entryPoint = process.env.SAML_ENTRY_POINT;
  const issuer = process.env.SAML_ISSUER;
  const cert = process.env.SAML_CERT;
  const callbackUrl = process.env.SAML_CALLBACK_URL;
  if (!entryPoint || !issuer || !cert || !callbackUrl) {
    throw new Error('sso_not_configured');
  }
  const mod = (await import('@node-saml/node-saml')) as unknown as {
    SAML?: new (opts: unknown) => SamlInstance;
    default?: { SAML?: new (opts: unknown) => SamlInstance };
  };
  const SAML = (mod.SAML ?? mod.default?.SAML) as new (opts: unknown) => SamlInstance;
  cached = new SAML({
    entryPoint,
    issuer,
    idpCert: cert,
    callbackUrl,
    wantAssertionsSigned: true,
    // Reject replay: only accept a SAMLResponse whose InResponseTo matches
    // a request ID we issued. Combined with the relayState nonce below,
    // this binds each callback to the corresponding /sso/login redirect.
    validateInResponseTo: 'always',
    requestIdExpirationPeriodMs: 10 * 60 * 1000,
  });
  return cached;
}

// In-memory relayState nonce cache. Not persistent — a server restart
// invalidates in-flight SSO flows, which is acceptable for this feature.
const relayStates = new Map<string, number>();
const RELAY_TTL_MS = 10 * 60 * 1000;

function issueRelayState(): string {
  // Evict expired entries opportunistically.
  const now = Date.now();
  for (const [k, exp] of relayStates) {
    if (exp < now) relayStates.delete(k);
  }
  const nonce = randomBytes(16).toString('base64url');
  relayStates.set(nonce, now + RELAY_TTL_MS);
  return nonce;
}

function consumeRelayState(nonce: string | undefined): boolean {
  if (!nonce) return false;
  const exp = relayStates.get(nonce);
  if (!exp) return false;
  relayStates.delete(nonce);
  return exp >= Date.now();
}

export const samlAdapter = {
  async generateLoginUrl(): Promise<{ url: string }> {
    const saml = await getInstance();
    const relayState = issueRelayState();
    const url = await saml.getAuthorizeUrlAsync(relayState, '', {});
    return { url };
  },
  async validateResponse(payload: unknown): Promise<{
    provider: 'saml';
    ssoId: string;
    email: string;
    name?: string;
  }> {
    const saml = await getInstance();
    const body = (payload ?? {}) as { SAMLResponse?: string; RelayState?: string };
    if (!body.SAMLResponse) throw new Error('missing_saml_response');
    // Validate relayState nonce to bind callback to an in-flight login.
    if (!consumeRelayState(body.RelayState)) {
      throw new Error('invalid_relay_state');
    }
    const { profile } = await saml.validatePostResponseAsync({ SAMLResponse: body.SAMLResponse });
    if (!profile) throw new Error('invalid_saml_response');
    if (!profile.nameID || typeof profile.nameID !== 'string') {
      throw new Error('saml_missing_nameid');
    }
    const email = (profile.email ?? profile.mail ?? '').toString();
    const name = (profile.displayName ?? profile.cn ?? '').toString() || undefined;
    if (!email) throw new Error('saml_missing_email');
    return { provider: 'saml', ssoId: profile.nameID, email, name };
  },
  async authenticate(): Promise<never> {
    throw new Error('saml_uses_redirect_flow');
  },
};

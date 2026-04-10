// Re-export the Credential list-row shape from user.ts where it was originally defined.
export type { Credential } from './user.js';

export type CredentialType = 'api_key' | 'oauth2' | 'basic' | 'custom';

export interface CreateSecretInput {
  name: string;
  type: CredentialType;
  value: string;
}

export interface UpdateSecretInput {
  value: string;
}

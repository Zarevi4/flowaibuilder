export type UserRole = 'admin' | 'editor' | 'viewer';

export interface User {
  id: string;
  email: string;
  name?: string;
  role: UserRole;
  ssoProvider?: string;
  ssoId?: string;
  createdAt: string;
}

export interface Credential {
  id: string;
  name: string;
  type: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

import type { UserRole } from './user.js';

export interface AuthUser {
  id: string;
  email: string;
  name?: string | null;
  role: UserRole;
}

export interface AuthSession {
  token: string;
  expiresAt: string;
}

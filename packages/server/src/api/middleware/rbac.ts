import type { FastifyRequest, FastifyReply } from 'fastify';
import type { UserRole } from '@flowaibuilder/shared';

const RANK: Record<UserRole, number> = { viewer: 1, editor: 2, admin: 3 };

export function rolePermits(userRole: UserRole | undefined, minRole: UserRole): boolean {
  if (!userRole) return false;
  return (RANK[userRole] ?? 0) >= RANK[minRole];
}

/**
 * Fastify preHandler factory — returns a hook that rejects
 * any caller whose role is below `minRole`.
 */
export function requireRole(minRole: UserRole) {
  return async function rbacGuard(request: FastifyRequest, reply: FastifyReply) {
    const user = request.user;
    if (!user) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    if (!rolePermits(user.role, minRole)) {
      return reply.code(403).send({ error: 'forbidden', required_role: minRole });
    }
  };
}

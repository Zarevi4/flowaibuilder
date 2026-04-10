import 'fastify';
import type { AuditLogger } from '../audit/logger.js';
import type { AuthUser } from '@flowaibuilder/shared';

declare module 'fastify' {
  interface FastifyInstance {
    audit: AuditLogger;
  }

  interface FastifyRequest {
    auditBefore?: unknown;
    auditSkip?: boolean;
    auditMeta?: { resourceType?: string; resourceId?: string };
    user?: AuthUser;
  }
}

import type { UserRole, AuthUser } from '@flowaibuilder/shared';
import { rolePermits } from '../api/middleware/rbac.js';

/**
 * RBAC for MCP tool invocations (Story 5.2).
 *
 * Stdio transport is local Claude Code — already inside the user's
 * security boundary — so it bypasses RBAC as an effective admin.
 * SSE transport carries an authenticated session.
 */

export const MCP_STDIO_USER: AuthUser = {
  id: 'mcp:claude-code',
  email: 'mcp:claude-code',
  name: 'Claude Code (stdio)',
  role: 'admin',
};

export interface McpInvocationContext {
  user?: AuthUser;
  transport: 'stdio' | 'sse';
}

export function assertMcpPermitted(
  toolName: string,
  minRole: UserRole,
  ctx: McpInvocationContext,
): void {
  // Stdio is trusted local.
  if (ctx.transport === 'stdio') return;
  const user = ctx.user;
  if (!user) {
    const err = new Error(`mcp_unauthenticated: ${toolName}`);
    (err as Error & { code?: string }).code = 'mcp_unauthenticated';
    throw err;
  }
  if (!rolePermits(user.role, minRole)) {
    const err = new Error(`mcp_forbidden: ${toolName} requires ${minRole}`);
    (err as Error & { code?: string; required_role?: string }).code = 'mcp_forbidden';
    (err as Error & { required_role?: string }).required_role = minRole;
    throw err;
  }
}

/** Tool → minimum role lookup (Story 5.2 AC #6). */
export function minRoleForMcpTool(toolName: string): UserRole {
  const readOnly = new Set([
    'flowaibuilder.list_workflows',
    'flowaibuilder.get_workflow',
    'flowaibuilder.get_annotations',
    'flowaibuilder.get_audit_log',
    'flowaibuilder.get_execution_log',
    'flowaibuilder.get_execution',
    'flowaibuilder.list_executions',
    'flowaibuilder.get_team_state',
    'flowaibuilder.get_zones',
    'flowaibuilder.validate_workflow',
    'flowaibuilder.export_workflow',
    'flowaibuilder.get_review_context',
    'flowaibuilder.get_health_score',
    // Story 5.3 — versioning reads
    'flowaibuilder.list_workflow_versions',
    'flowaibuilder.get_workflow_version',
    'flowaibuilder.git_history',
    // Story 5.4 — manage_secrets includes list; set/delete guard at handler level
    'flowaibuilder.manage_secrets',
    // Story 5.5 — queue status is read-only
    'flowaibuilder.get_queue_status',
  ]);
  return readOnly.has(toolName) ? 'viewer' : 'editor';
}

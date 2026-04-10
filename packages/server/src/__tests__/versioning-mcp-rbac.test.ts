import { describe, it, expect } from 'vitest';
import { minRoleForMcpTool, assertMcpPermitted } from '../mcp/rbac.js';

describe('Story 5.3: MCP RBAC for versioning tools', () => {
  it('list_workflow_versions → viewer', () => {
    expect(minRoleForMcpTool('flowaibuilder.list_workflow_versions')).toBe('viewer');
  });
  it('get_workflow_version → viewer', () => {
    expect(minRoleForMcpTool('flowaibuilder.get_workflow_version')).toBe('viewer');
  });
  it('git_history → viewer', () => {
    expect(minRoleForMcpTool('flowaibuilder.git_history')).toBe('viewer');
  });
  it('git_push → editor', () => {
    expect(minRoleForMcpTool('flowaibuilder.git_push')).toBe('editor');
  });
  it('revert_workflow → editor', () => {
    expect(minRoleForMcpTool('flowaibuilder.revert_workflow')).toBe('editor');
  });

  it('viewer over SSE may list versions but not push', () => {
    const viewer = { id: 'u', email: 'v@x.com', name: null, role: 'viewer' as const };
    expect(() =>
      assertMcpPermitted('flowaibuilder.list_workflow_versions', 'viewer', { transport: 'sse', user: viewer }),
    ).not.toThrow();
    expect(() =>
      assertMcpPermitted('flowaibuilder.git_push', 'editor', { transport: 'sse', user: viewer }),
    ).toThrow(/forbidden/);
  });

  it('stdio bypasses all RBAC', () => {
    expect(() =>
      assertMcpPermitted('flowaibuilder.git_push', 'editor', { transport: 'stdio' }),
    ).not.toThrow();
  });
});

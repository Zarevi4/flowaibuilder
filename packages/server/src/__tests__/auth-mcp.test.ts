import { describe, it, expect } from 'vitest';
import {
  assertMcpPermitted,
  minRoleForMcpTool,
  MCP_STDIO_USER,
} from '../mcp/rbac.js';

describe('AC #5, #6: MCP RBAC', () => {
  it('read-only tools → viewer', () => {
    expect(minRoleForMcpTool('flowaibuilder.list_workflows')).toBe('viewer');
    expect(minRoleForMcpTool('flowaibuilder.get_workflow')).toBe('viewer');
    expect(minRoleForMcpTool('flowaibuilder.get_review_context')).toBe('viewer');
  });
  it('mutating tools → editor', () => {
    expect(minRoleForMcpTool('flowaibuilder.add_node')).toBe('editor');
    expect(minRoleForMcpTool('flowaibuilder.create_workflow')).toBe('editor');
  });

  it('viewer may call read-only tools over SSE', () => {
    expect(() =>
      assertMcpPermitted('flowaibuilder.get_workflow', 'viewer', {
        transport: 'sse',
        user: { id: 'u', email: 'v@x.com', name: null, role: 'viewer' },
      }),
    ).not.toThrow();
  });

  it('viewer cannot call mutating tools over SSE', () => {
    expect(() =>
      assertMcpPermitted('flowaibuilder.add_node', 'editor', {
        transport: 'sse',
        user: { id: 'u', email: 'v@x.com', name: null, role: 'viewer' },
      }),
    ).toThrow(/forbidden/);
  });

  it('stdio transport bypasses RBAC (AC #5)', () => {
    expect(() =>
      assertMcpPermitted('flowaibuilder.delete_workflow', 'editor', {
        transport: 'stdio',
      }),
    ).not.toThrow();
    expect(MCP_STDIO_USER.role).toBe('admin');
  });

  it('sse without user → 401-style error', () => {
    expect(() =>
      assertMcpPermitted('flowaibuilder.add_node', 'editor', { transport: 'sse' }),
    ).toThrow(/unauthenticated/);
  });
});

import { describe, it, expect } from 'vitest';
import { importN8nWorkflow, ImportError } from '../import/index.js';

describe('importN8nWorkflow', () => {
  it('fixture 1: minimal webhook + function + connection', () => {
    const json = {
      name: 'Minimal',
      nodes: [
        {
          id: 'abc-123',
          name: 'Webhook',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 1,
          position: [100, 200],
          parameters: { path: 'hook', httpMethod: 'POST' },
        },
        {
          id: 'def-456',
          name: 'Function',
          type: 'n8n-nodes-base.function',
          typeVersion: 1,
          position: [400, 200],
          parameters: { code: 'return items;' },
        },
      ],
      connections: {
        Webhook: {
          main: [[{ node: 'Function', type: 'main', index: 0 }]],
        },
      },
    };
    const result = importN8nWorkflow(json);
    expect(result.warnings).toEqual([]);
    expect(result.workflow.nodes.map((n) => n.type)).toEqual(['webhook', 'code-js']);
    expect(result.workflow.connections).toHaveLength(1);
    const conn = result.workflow.connections[0];
    expect(conn.sourceNodeId).toBe('abc-123');
    expect(conn.targetNodeId).toBe('def-456');
    expect(conn.sourceHandle).toBeUndefined();
    expect(conn.targetHandle).toBeUndefined();
  });

  it('fixture 2: unsupported type becomes code-js placeholder', () => {
    const json = {
      nodes: [
        {
          id: 'slack-1',
          name: 'Slack',
          type: 'n8n-nodes-base.slack',
          typeVersion: 2,
          position: [0, 0],
          parameters: { channel: '#general', text: 'hi' },
        },
      ],
      connections: {},
    };
    const result = importN8nWorkflow(json);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].mappedTo).toBe('code-js');
    expect(result.warnings[0].n8nType).toBe('n8n-nodes-base.slack');
    const node = result.workflow.nodes[0];
    expect(node.type).toBe('code-js');
    const code = (node.data.config as { code: string }).code;
    expect(code).toContain('Original type: n8n-nodes-base.slack');
    expect(code).toContain('#general');
    expect(code).toContain('return $input.all();');
  });

  it('fixture 3: output index > 0 → sourceHandle out-N', () => {
    const json = {
      nodes: [
        { id: 'a', name: 'A', type: 'n8n-nodes-base.if', position: [0, 0], parameters: {} },
        { id: 'b', name: 'B', type: 'n8n-nodes-base.function', position: [1, 1], parameters: {} },
      ],
      connections: {
        A: {
          main: [
            [],
            [{ node: 'B', type: 'main', index: 2 }],
          ],
        },
      },
    };
    const result = importN8nWorkflow(json);
    expect(result.workflow.connections).toHaveLength(1);
    expect(result.workflow.connections[0].sourceHandle).toBe('out-1');
    expect(result.workflow.connections[0].targetHandle).toBe('in-2');
  });

  it('fixture 4: empty object throws ImportError', () => {
    expect(() => importN8nWorkflow({})).toThrow(ImportError);
  });

  it('fixture 5: null throws ImportError', () => {
    expect(() => importN8nWorkflow(null)).toThrow(ImportError);
  });

  it('fixture 6: illegal id chars are remapped, connections still resolve', () => {
    const json = {
      nodes: [
        { id: 'illegal id!!', name: 'A', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: { path: 'p' } },
        { id: 'also bad$$', name: 'B', type: 'n8n-nodes-base.function', position: [0, 0], parameters: {} },
      ],
      connections: {
        A: { main: [[{ node: 'B', type: 'main', index: 0 }]] },
      },
    };
    const result = importN8nWorkflow(json);
    const ids = result.workflow.nodes.map((n) => n.id);
    expect(ids[0]).not.toBe('illegal id!!');
    expect(ids[1]).not.toBe('also bad$$');
    expect(result.workflow.connections).toHaveLength(1);
    expect(result.workflow.connections[0].sourceNodeId).toBe(ids[0]);
    expect(result.workflow.connections[0].targetNodeId).toBe(ids[1]);
  });

  it('defaults name from opts > json.name > fallback', () => {
    const base = {
      nodes: [],
      connections: {},
    };
    expect(importN8nWorkflow(base).workflow.name).toBe('Imported from n8n');
    expect(importN8nWorkflow({ ...base, name: 'FromJson' }).workflow.name).toBe('FromJson');
    expect(importN8nWorkflow(base, { name: 'FromOpts' }).workflow.name).toBe('FromOpts');
  });
});

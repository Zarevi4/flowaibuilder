import { describe, it, expect } from 'vitest';
import { toReactFlowNode, toReactFlowEdge, toReactFlowNodes, toReactFlowEdges } from '../lib/mappers';
import type { WorkflowNode, Connection } from '@flowaibuilder/shared';

describe('mappers', () => {
  describe('toReactFlowNode', () => {
    it('maps a WorkflowNode to a React Flow Node', () => {
      const wn: WorkflowNode = {
        id: 'n1',
        type: 'webhook',
        name: 'My Webhook',
        position: { x: 100, y: 200 },
        data: { label: 'Webhook', config: { path: '/hook' } },
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      };

      const result = toReactFlowNode(wn);

      expect(result.id).toBe('n1');
      expect(result.type).toBe('webhook');
      expect(result.position).toEqual({ x: 100, y: 200 });
      expect(result.data.name).toBe('My Webhook');
      expect(result.data.nodeType).toBe('webhook');
      expect(result.data.config).toEqual({ path: '/hook' });
    });
  });

  describe('toReactFlowEdge', () => {
    it('maps a Connection to a React Flow Edge', () => {
      const conn: Connection = {
        id: 'e1',
        sourceNodeId: 'n1',
        targetNodeId: 'n2',
        sourceHandle: 'output-0',
        targetHandle: undefined,
      };

      const result = toReactFlowEdge(conn);

      expect(result.id).toBe('e1');
      expect(result.source).toBe('n1');
      expect(result.target).toBe('n2');
      expect(result.sourceHandle).toBe('output-0');
    });
  });

  describe('toReactFlowNodes', () => {
    it('maps an array of WorkflowNodes', () => {
      const nodes: WorkflowNode[] = [
        {
          id: 'n1', type: 'webhook', name: 'W1',
          position: { x: 0, y: 0 },
          data: { label: 'W1', config: {} },
          createdAt: '', updatedAt: '',
        },
        {
          id: 'n2', type: 'code-js', name: 'Code',
          position: { x: 200, y: 0 },
          data: { label: 'Code', config: { code: 'return {}' } },
          createdAt: '', updatedAt: '',
        },
      ];

      const result = toReactFlowNodes(nodes);
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('webhook');
      expect(result[1].type).toBe('code-js');
    });
  });

  describe('toReactFlowEdges', () => {
    it('maps an array of Connections', () => {
      const connections: Connection[] = [
        { id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2' },
      ];

      const result = toReactFlowEdges(connections);
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('n1');
    });
  });
});

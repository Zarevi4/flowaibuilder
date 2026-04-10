import { describe, it, expect } from 'vitest';
import { nodeTypeMap } from '../lib/node-registry';
import { NODE_TYPES } from '@flowaibuilder/shared';

describe('nodeTypeMap', () => {
  it('has an entry for every node type in NODE_TYPES', () => {
    for (const type of Object.keys(NODE_TYPES)) {
      expect(nodeTypeMap[type]).toBeDefined();
    }
  });

  it('maps trigger types to TriggerNode', () => {
    // All trigger types should map to the same component
    expect(nodeTypeMap['webhook']).toBe(nodeTypeMap['schedule']);
    expect(nodeTypeMap['webhook']).toBe(nodeTypeMap['manual']);
  });

  it('maps code types to CodeNode', () => {
    expect(nodeTypeMap['code-js']).toBe(nodeTypeMap['code-python']);
    expect(nodeTypeMap['code-js']).toBe(nodeTypeMap['set']);
  });

  it('maps logic types to LogicNode', () => {
    expect(nodeTypeMap['if']).toBe(nodeTypeMap['switch']);
    expect(nodeTypeMap['if']).toBe(nodeTypeMap['merge']);
    expect(nodeTypeMap['if']).toBe(nodeTypeMap['loop']);
  });

  it('maps http-request to HttpNode', () => {
    expect(nodeTypeMap['http-request']).toBeDefined();
    // HttpNode is different from LogicNode
    expect(nodeTypeMap['http-request']).not.toBe(nodeTypeMap['if']);
  });

  it('maps ai-agent to AiNode', () => {
    expect(nodeTypeMap['ai-agent']).toBeDefined();
    expect(nodeTypeMap['ai-agent']).not.toBe(nodeTypeMap['http-request']);
  });

  it('maps respond-webhook to OutputNode', () => {
    expect(nodeTypeMap['respond-webhook']).toBeDefined();
    expect(nodeTypeMap['respond-webhook']).not.toBe(nodeTypeMap['webhook']);
  });
});

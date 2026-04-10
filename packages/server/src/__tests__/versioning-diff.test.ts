import { describe, it, expect } from 'vitest';
import { diffSnapshots, serializeSnapshot, shouldVersion } from '../versioning/diff.js';
import type { WorkflowSnapshot, WorkflowNode } from '@flowaibuilder/shared';

function makeNode(id: string, over: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id,
    type: 'code-js',
    name: id,
    position: { x: 0, y: 0 },
    data: { label: id, config: {} },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function snap(over: Partial<WorkflowSnapshot> = {}): WorkflowSnapshot {
  return {
    id: 'wf',
    name: 'w',
    description: '',
    nodes: [],
    connections: [],
    settings: {},
    canvas: {},
    tags: [],
    active: false,
    version: 1,
    ...over,
  };
}

describe('diffSnapshots', () => {
  it('detects added nodes', () => {
    const a = snap({ nodes: [] });
    const b = snap({ nodes: [makeNode('n1')] });
    const d = diffSnapshots(a, b);
    expect(d.nodes.added).toHaveLength(1);
    expect(d.nodes.removed).toHaveLength(0);
    expect(d.nodes.changed).toHaveLength(0);
  });

  it('detects removed nodes', () => {
    const a = snap({ nodes: [makeNode('n1')] });
    const b = snap({ nodes: [] });
    expect(diffSnapshots(a, b).nodes.removed).toHaveLength(1);
  });

  it('detects changed config', () => {
    const a = snap({ nodes: [makeNode('n1', { data: { label: 'a', config: { x: 1 } } })] });
    const b = snap({ nodes: [makeNode('n1', { data: { label: 'a', config: { x: 2 } } })] });
    const d = diffSnapshots(a, b);
    expect(d.nodes.changed).toHaveLength(1);
    expect(d.nodes.changed[0].changedFields).toContain('data.config');
  });

  it('is order-independent', () => {
    const a = snap({ nodes: [makeNode('n1'), makeNode('n2')] });
    const b = snap({ nodes: [makeNode('n2'), makeNode('n1')] });
    const d = diffSnapshots(a, b);
    expect(d.nodes.added).toHaveLength(0);
    expect(d.nodes.removed).toHaveLength(0);
    expect(d.nodes.changed).toHaveLength(0);
  });

  it('detects meta flags', () => {
    const a = snap();
    const b = snap({ name: 'x', description: 'd', settings: { k: 1 } });
    const d = diffSnapshots(a, b);
    expect(d.meta.nameChanged).toBe(true);
    expect(d.meta.descriptionChanged).toBe(true);
    expect(d.meta.settingsChanged).toBe(true);
  });
});

describe('serializeSnapshot', () => {
  it('is deterministic regardless of key order', () => {
    const a = { b: 1, a: 2, c: { y: 1, x: 2 } };
    const b = { c: { x: 2, y: 1 }, a: 2, b: 1 };
    expect(serializeSnapshot(a)).toBe(serializeSnapshot(b));
  });
  it('adds trailing newline', () => {
    expect(serializeSnapshot({ a: 1 }).endsWith('\n')).toBe(true);
  });
});

describe('shouldVersion', () => {
  it('returns true when nodes differ', () => {
    expect(shouldVersion({ nodes: [] }, { nodes: [{ id: 'x' }] })).toBe(true);
  });
  it('returns false for updatedAt-only touch', () => {
    expect(shouldVersion({ nodes: [], updatedAt: 1 }, { nodes: [], updatedAt: 2 })).toBe(false);
  });
  it('returns true when active flag flips', () => {
    expect(shouldVersion({ nodes: [], active: false }, { nodes: [], active: true })).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import type { Workflow, WorkflowNode, Connection } from '@flowaibuilder/shared';
import { validateWorkflow } from '../validation/index.js';

function node(id: string, type: WorkflowNode['type'], config: Record<string, unknown> = {}): WorkflowNode {
  return {
    id,
    type,
    name: id,
    position: { x: 0, y: 0 },
    data: { label: id, config },
    createdAt: 't',
    updatedAt: 't',
  };
}

function wf(nodes: WorkflowNode[], connections: Connection[]): Workflow {
  return {
    id: 'wf',
    name: 'wf',
    nodes,
    connections,
    active: false,
    version: 1,
    createdBy: 't',
    updatedBy: 't',
    createdAt: 't',
    updatedAt: 't',
  };
}

function conn(id: string, src: string, tgt: string): Connection {
  return { id, sourceNodeId: src, targetNodeId: tgt };
}

describe('validateWorkflow', () => {
  it('happy path: webhook → code-js → respond-webhook', () => {
    const w = wf(
      [
        node('a', 'webhook', { path: 'hook' }),
        node('b', 'code-js', { code: 'return $input.all();' }),
        node('c', 'respond-webhook'),
      ],
      [conn('1', 'a', 'b'), conn('2', 'b', 'c')],
    );
    const r = validateWorkflow(w);
    expect(r.valid).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('orphan: standalone code-js', () => {
    const w = wf([node('x', 'code-js', { code: 'x' })], []);
    const r = validateWorkflow(w);
    expect(r.issues.find((i) => i.code === 'orphan-node')).toBeDefined();
  });

  it('trigger-only: lone webhook NOT orphan', () => {
    const w = wf([node('t', 'webhook', { path: 'p' })], []);
    const r = validateWorkflow(w);
    expect(r.issues.find((i) => i.code === 'orphan-node')).toBeUndefined();
  });

  it('cycle A→B→C→A', () => {
    const w = wf(
      [
        node('a', 'code-js', { code: 'x' }),
        node('b', 'code-js', { code: 'x' }),
        node('c', 'code-js', { code: 'x' }),
      ],
      [conn('1', 'a', 'b'), conn('2', 'b', 'c'), conn('3', 'c', 'a')],
    );
    const r = validateWorkflow(w);
    const cycle = r.issues.find((i) => i.code === 'circular-dependency');
    expect(cycle).toBeDefined();
    expect(cycle!.severity).toBe('error');
    expect(cycle!.message).toContain('a');
    expect(cycle!.message).toContain('b');
    expect(cycle!.message).toContain('c');
    expect(r.valid).toBe(false);
  });

  it('missing required: http-request with empty url', () => {
    const w = wf(
      [
        node('t', 'webhook', { path: 'p' }),
        node('h', 'http-request', { url: '' }),
      ],
      [conn('1', 't', 'h')],
    );
    const r = validateWorkflow(w);
    const miss = r.issues.find((i) => i.code === 'missing-required-config');
    expect(miss).toBeDefined();
    expect(miss!.severity).toBe('error');
    expect(r.valid).toBe(false);
  });

  it('expression balanced → no issue', () => {
    const w = wf(
      [
        node('t', 'webhook', { path: 'p' }),
        node('c', 'code-js', { code: 'return {{ $json.foo }}' }),
      ],
      [conn('1', 't', 'c')],
    );
    const r = validateWorkflow(w);
    expect(r.issues.find((i) => i.code === 'expression-syntax-error')).toBeUndefined();
  });

  it('expression unbalanced → warning', () => {
    const w = wf(
      [
        node('t', 'webhook', { path: 'p' }),
        node('c', 'code-js', { code: 'return {{ $json.foo' }),
      ],
      [conn('1', 't', 'c')],
    );
    const r = validateWorkflow(w);
    const issue = r.issues.find((i) => i.code === 'expression-syntax-error');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('warning');
  });

  it('dead-end branch: code-js with no path to respond-webhook', () => {
    const w = wf(
      [
        node('t', 'webhook', { path: 'p' }),
        node('c', 'code-js', { code: 'x' }),
        node('r', 'respond-webhook'),
      ],
      [conn('1', 't', 'c')],
    );
    const r = validateWorkflow(w);
    const issue = r.issues.find((i) => i.code === 'dead-end-branch' && i.nodeId === 'c');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('warning');
  });

  it('warnings alone do not invalidate', () => {
    const w = wf(
      [
        node('t', 'webhook', { path: 'p' }),
        node('c', 'code-js', { code: 'return {{ bad' }),
        node('r', 'respond-webhook'),
      ],
      [conn('1', 't', 'c'), conn('2', 'c', 'r')],
    );
    const r = validateWorkflow(w);
    expect(r.issues.some((i) => i.severity === 'warning')).toBe(true);
    expect(r.valid).toBe(true);
  });
});

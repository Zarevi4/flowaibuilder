import { describe, it, expect } from 'vitest';
import type { Workflow } from '@flowaibuilder/shared';
import { compileWorkflow, ExportError } from '../export/index.js';

function makeWorkflow(): Workflow {
  return {
    id: 'wf-test',
    name: 'Test Flow',
    description: 'A small test workflow',
    nodes: [
      {
        id: 'n1',
        type: 'webhook',
        name: 'Webhook In',
        position: { x: 0, y: 0 },
        data: { label: 'Webhook In', config: { path: '/in', method: 'POST' } },
        createdAt: 't',
        updatedAt: 't',
      },
      {
        id: 'n2',
        type: 'code-js',
        name: 'Transform',
        position: { x: 100, y: 0 },
        data: { label: 'Transform', config: { code: 'return $input;' } },
        createdAt: 't',
        updatedAt: 't',
      },
      {
        id: 'n3',
        type: 'respond-webhook',
        name: 'Respond',
        position: { x: 200, y: 0 },
        data: { label: 'Respond', config: {} },
        createdAt: 't',
        updatedAt: 't',
      },
    ],
    connections: [
      { id: 'c1', sourceNodeId: 'n1', targetNodeId: 'n2' },
      { id: 'c2', sourceNodeId: 'n2', targetNodeId: 'n3' },
    ],
    active: false,
    version: 1,
    environment: 'dev',
    createdBy: 'test',
    updatedBy: 'test',
    createdAt: 't',
    updatedAt: 't',
  };
}

describe('export compilers', () => {
  const wf = makeWorkflow();

  it('prompt format includes header, node names and arrows', () => {
    const r = compileWorkflow(wf, 'prompt');
    expect(r.content).toContain('# Workflow:');
    expect(r.content).toContain('Webhook In');
    expect(r.content).toContain('Transform');
    expect(r.content).toContain('Respond');
    expect(r.content).toContain('→');
    expect(r.filename).toBe('test-flow.md');
  });

  it('typescript format produces defineWorkflow with unquoted keys', () => {
    const r = compileWorkflow(wf, 'typescript');
    expect(r.content).toContain('defineWorkflow({');
    expect(r.content).toContain('n1');
    expect(r.content).toContain('n2');
    expect(r.content).toContain('n3');
    // Object literal keys should be unquoted (no `"id":` inside literals)
    expect(r.content).not.toMatch(/"id":/);
    expect(r.filename).toBe('test-flow.ts');
  });

  it('python format uses define_workflow and Python literals', () => {
    const r = compileWorkflow(wf, 'python');
    expect(r.content).toContain('define_workflow(');
    expect(r.content).not.toContain('true');
    expect(r.content).not.toContain('null');
    expect(r.filename).toBe('test-flow.py');
  });

  it('mermaid format starts with flowchart LR and emits 3 nodes + 2 edges', () => {
    const r = compileWorkflow(wf, 'mermaid');
    expect(r.content.startsWith('flowchart LR')).toBe(true);
    const nodeLines = r.content.split('\n').filter((l) => /\["/.test(l));
    const edgeLines = r.content.split('\n').filter((l) => l.includes('-->'));
    expect(nodeLines.length).toBe(3);
    expect(edgeLines.length).toBe(2);
    expect(r.filename).toBe('test-flow.mmd');
  });

  it('json format round-trips', () => {
    const r = compileWorkflow(wf, 'json');
    const parsed = JSON.parse(r.content);
    expect(parsed.id).toBe(wf.id);
    expect(parsed.nodes.length).toBe(3);
    expect(r.filename).toBe('test-flow.json');
  });

  it('unknown format throws ExportError listing valid formats', () => {
    expect(() => compileWorkflow(wf, 'bogus' as never)).toThrow(ExportError);
    try {
      compileWorkflow(wf, 'bogus' as never);
    } catch (err) {
      expect((err as Error).message).toContain('Valid: prompt, typescript, python, mermaid, json');
    }
  });

  it('cycle fixture: TS/Python prepend cycle warning, no throw', () => {
    const cyclic = makeWorkflow();
    cyclic.connections.push({ id: 'c3', sourceNodeId: 'n3', targetNodeId: 'n1' });
    const ts = compileWorkflow(cyclic, 'typescript');
    const py = compileWorkflow(cyclic, 'python');
    expect(ts.content.startsWith('// cycle detected')).toBe(true);
    expect(py.content.startsWith('# cycle detected')).toBe(true);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { NodeConfigSidebar } from '../components/sidebar/NodeConfigSidebar';
import { useExecutionStore } from '../store/execution';

// Mock ui store
vi.mock('../store/ui', () => ({
  useUiStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ selectedNodeId: 'n1', selectNode: vi.fn() }),
  ),
}));

// Mock workflow store
vi.mock('../store/workflow', () => ({
  useWorkflowStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      workflow: {
        id: 'w1',
        nodes: [
          {
            id: 'n1',
            type: 'http-request',
            name: 'HTTP Request',
            data: { config: { url: 'https://example.com' } },
          },
        ],
      },
      updateNodeConfig: vi.fn(),
      removeNode: vi.fn(),
    }),
  ),
}));

// Mock execution store - real implementation
vi.mock('../store/execution', async () => {
  const actual = await vi.importActual('../store/execution');
  return actual;
});

// Mock shared
vi.mock('@flowaibuilder/shared', () => ({
  NODE_TYPES: {
    'http-request': {
      label: 'HTTP Request',
      icon: 'Globe',
      color: '#D85A30',
      category: 'integration',
      inputs: 1,
      outputs: 1,
    },
  },
}));

// Mock form components
vi.mock('../components/sidebar/forms/HttpRequestForm', () => ({
  HttpRequestForm: () => createElement('div', { 'data-testid': 'http-form' }),
}));
vi.mock('../components/sidebar/forms/IfForm', () => ({
  IfForm: () => createElement('div'),
}));
vi.mock('../components/sidebar/forms/WebhookForm', () => ({
  WebhookForm: () => createElement('div'),
}));
vi.mock('../components/sidebar/forms/ScheduleForm', () => ({
  ScheduleForm: () => createElement('div'),
}));
vi.mock('../components/sidebar/forms/SetForm', () => ({
  SetForm: () => createElement('div'),
}));
vi.mock('../components/sidebar/forms/CodeForm', () => ({
  CodeForm: () => createElement('div'),
}));
vi.mock('../components/sidebar/forms/DefaultForm', () => ({
  DefaultForm: () => createElement('div'),
}));

describe('NodeConfigSidebar execution results', () => {
  beforeEach(() => {
    useExecutionStore.getState().clearExecution();
  });

  it('does not show execution section when no execution data exists', () => {
    render(createElement(NodeConfigSidebar));
    expect(screen.queryByTestId('execution-section')).toBeNull();
  });

  it('shows execution section when node has execution data', () => {
    useExecutionStore.getState().startExecution('exec-1');
    useExecutionStore.getState().setFullExecutionData('exec-1', [
      {
        nodeId: 'n1',
        nodeName: 'HTTP Request',
        nodeType: 'http-request',
        status: 'success',
        duration: 250,
        input: { url: 'https://example.com' },
        output: { statusCode: 200 },
      },
    ]);

    render(createElement(NodeConfigSidebar));
    expect(screen.getByTestId('execution-section')).toBeDefined();
    expect(screen.getByText('success')).toBeDefined();
    expect(screen.getByText('250ms')).toBeDefined();
  });

  it('shows error message when node has error', () => {
    useExecutionStore.getState().startExecution('exec-1');
    useExecutionStore.getState().setFullExecutionData('exec-1', [
      {
        nodeId: 'n1',
        nodeName: 'HTTP Request',
        nodeType: 'http-request',
        status: 'error',
        duration: 50,
        error: 'Connection refused',
      },
    ]);

    render(createElement(NodeConfigSidebar));
    expect(screen.getByText('Connection refused')).toBeDefined();
    expect(screen.getByText('error')).toBeDefined();
  });

  it('shows input/output JSON viewers', () => {
    useExecutionStore.getState().startExecution('exec-1');
    useExecutionStore.getState().setFullExecutionData('exec-1', [
      {
        nodeId: 'n1',
        nodeName: 'HTTP Request',
        nodeType: 'http-request',
        status: 'success',
        duration: 100,
        input: { url: 'https://example.com' },
        output: { body: 'ok' },
      },
    ]);

    render(createElement(NodeConfigSidebar));
    expect(screen.getByText('Input')).toBeDefined();
    expect(screen.getByText('Output')).toBeDefined();
  });
});

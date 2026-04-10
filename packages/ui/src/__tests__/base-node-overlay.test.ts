import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { BaseNode } from '../components/canvas/nodes/BaseNode';

// Mock @xyflow/react Handle component
vi.mock('@xyflow/react', () => ({
  Handle: function MockHandle(props: Record<string, unknown>) {
    return createElement('div', { 'data-testid': `handle-${props.type}-${props.id}`, ...props });
  },
  Position: { Left: 'left', Right: 'right' },
}));

// Mock shared constants
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

// Mock icons
vi.mock('../../../lib/icons', () => ({
  resolveIcon: vi.fn(() => null),
}));

describe('BaseNode execution status overlay', () => {
  const defaultProps = {
    nodeType: 'http-request',
    name: 'My HTTP Node',
  };

  it('renders without execution status (no overlay)', () => {
    const { container } = render(createElement(BaseNode, defaultProps));
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).not.toContain('ring-blue');
    expect(wrapper.className).not.toContain('ring-green');
    expect(wrapper.className).not.toContain('ring-red');
  });

  it('renders running status with blue pulsing ring', () => {
    const { container } = render(
      createElement(BaseNode, { ...defaultProps, executionStatus: 'running' }),
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('ring-blue-400');
    expect(wrapper.className).toContain('animate-pulse');
  });

  it('renders success status with green ring', () => {
    const { container } = render(
      createElement(BaseNode, { ...defaultProps, executionStatus: 'success' }),
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('ring-green-400');
  });

  it('renders error status with red ring and error icon', () => {
    const { container } = render(
      createElement(BaseNode, { ...defaultProps, executionStatus: 'error' }),
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('ring-red-400');
    // Error icon badge should be present
    const badge = wrapper.querySelector('.absolute.-top-2.-right-2');
    // Check the error icon exists (XCircle renders an svg)
    const svgs = wrapper.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThan(0);
  });

  it('renders cancelled status with gray dashed ring', () => {
    const { container } = render(
      createElement(BaseNode, { ...defaultProps, executionStatus: 'cancelled' }),
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('border-dashed');
    expect(wrapper.className).toContain('border-gray-500');
  });

  it('does not apply execution ring when node is selected (selection ring takes priority)', () => {
    const { container } = render(
      createElement(BaseNode, { ...defaultProps, executionStatus: 'success', selected: true }),
    );
    const wrapper = container.firstChild as HTMLElement;
    // Selected ring should be present
    expect(wrapper.className).toContain('ring-blue-500/50');
    // Execution ring should NOT be applied when selected
    expect(wrapper.className).not.toContain('ring-green-400');
  });

  it('renders null execution status same as no execution status', () => {
    const { container } = render(
      createElement(BaseNode, { ...defaultProps, executionStatus: null }),
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).not.toContain('ring-blue');
    expect(wrapper.className).not.toContain('ring-green');
    expect(wrapper.className).not.toContain('ring-red');
  });
});

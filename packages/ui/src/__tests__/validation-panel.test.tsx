import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createElement } from 'react';
import type { ValidationResult } from '@flowaibuilder/shared';
import { ValidationResultsPanel } from '../components/editor/ValidationResultsPanel';

const setCenter = vi.fn();

vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({
    setCenter,
    getNode: (id: string) => ({ id, position: { x: 10, y: 20 } }),
  }),
}));

describe('ValidationResultsPanel', () => {
  it('renders errors before warnings', () => {
    const result: ValidationResult = {
      valid: false,
      issues: [
        { severity: 'warning', code: 'orphan-node', message: 'W1', nodeId: 'n1' },
        { severity: 'error', code: 'circular-dependency', message: 'E1', nodeId: 'n2' },
      ],
    };
    render(createElement(ValidationResultsPanel, { result, onClose: vi.fn() }));
    const issuesContainer = screen.getByTestId('validation-issues');
    const rows = issuesContainer.querySelectorAll('[data-testid^="validation-issue-"]');
    expect(rows[0].getAttribute('data-testid')).toBe('validation-issue-error');
    expect(rows[1].getAttribute('data-testid')).toBe('validation-issue-warning');
  });

  it('clicking a node chip calls setCenter via getNodePosition', () => {
    setCenter.mockClear();
    const result: ValidationResult = {
      valid: false,
      issues: [
        { severity: 'error', code: 'missing-required-config', message: 'E', nodeId: 'nX' },
      ],
    };
    render(
      createElement(ValidationResultsPanel, {
        result,
        onClose: vi.fn(),
        getNodePosition: (id: string) => (id === 'nX' ? { x: 100, y: 200 } : null),
      }),
    );
    fireEvent.click(screen.getByTestId('validation-node-chip'));
    expect(setCenter).toHaveBeenCalledWith(100, 200, expect.objectContaining({ zoom: 1.5 }));
  });

  it('valid result shows success message', () => {
    const result: ValidationResult = { valid: true, issues: [] };
    render(createElement(ValidationResultsPanel, { result, onClose: vi.fn() }));
    expect(screen.getByText('Workflow is valid')).toBeDefined();
  });
});

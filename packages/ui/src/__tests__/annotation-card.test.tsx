import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Annotation } from '@flowaibuilder/shared';
import { AnnotationCard } from '../components/canvas/review/AnnotationCard';

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'a1',
    workflowId: 'wf-1',
    nodeId: 'n1',
    severity: 'error',
    title: 'Missing credential',
    description: 'This node has no credential configured.',
    status: 'active',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('<AnnotationCard />', () => {
  it('renders collapsed badge with severity-prefixed aria-label', () => {
    const ann = makeAnnotation();
    render(
      <AnnotationCard
        annotation={ann}
        expanded={false}
        onExpand={vi.fn()}
        onCollapse={vi.fn()}
        onApplyFix={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('error: Missing credential')).toBeInTheDocument();
  });

  it.each(['error', 'warning', 'suggestion'] as const)(
    'renders severity %s',
    (severity) => {
      const ann = makeAnnotation({ severity, title: `${severity}-title` });
      render(
        <AnnotationCard
          annotation={ann}
          expanded={false}
          onExpand={vi.fn()}
          onCollapse={vi.fn()}
          onApplyFix={vi.fn()}
          onDismiss={vi.fn()}
        />,
      );
      expect(screen.getByLabelText(`${severity}: ${severity}-title`)).toBeInTheDocument();
    },
  );

  it('hides Apply Fix button when annotation.fix is absent', () => {
    const ann = makeAnnotation();
    render(
      <AnnotationCard
        annotation={ann}
        expanded={true}
        onExpand={vi.fn()}
        onCollapse={vi.fn()}
        onApplyFix={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('apply-fix-a1')).toBeNull();
  });

  it('shows Apply Fix button and calls handler when fix is present', () => {
    const ann = makeAnnotation({
      fix: { tool: 'update_node', params: {}, description: 'Add credential' },
    });
    const onApplyFix = vi.fn();
    render(
      <AnnotationCard
        annotation={ann}
        expanded={true}
        onExpand={vi.fn()}
        onCollapse={vi.fn()}
        onApplyFix={onApplyFix}
        onDismiss={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('apply-fix-a1'));
    expect(onApplyFix).toHaveBeenCalled();
  });

  it('calls onExpand when collapsed card is clicked', () => {
    const onExpand = vi.fn();
    render(
      <AnnotationCard
        annotation={makeAnnotation()}
        expanded={false}
        onExpand={onExpand}
        onCollapse={vi.fn()}
        onApplyFix={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('annotation-card-a1'));
    expect(onExpand).toHaveBeenCalled();
  });
});

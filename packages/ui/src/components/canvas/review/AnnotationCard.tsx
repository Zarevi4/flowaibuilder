import { useEffect, useRef, useState, type ReactElement } from 'react';
import { AlertCircle, AlertTriangle, Lightbulb, X } from 'lucide-react';
import type { Annotation } from '@flowaibuilder/shared';

interface Props {
  annotation: Annotation;
  expanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  onApplyFix: () => void;
  onDismiss: (reason?: string) => void;
  onRelatedNodeClick?: (nodeId: string) => void;
}

const severityStyles: Record<Annotation['severity'], { wrap: string; icon: ReactElement }> = {
  error: {
    wrap: 'border-red-500 bg-red-500/10 text-red-300',
    icon: <AlertCircle size={14} />,
  },
  warning: {
    wrap: 'border-amber-500 bg-amber-500/10 text-amber-300',
    icon: <AlertTriangle size={14} />,
  },
  suggestion: {
    wrap: 'border-blue-500 bg-blue-500/10 text-blue-300',
    icon: <Lightbulb size={14} />,
  },
};

export function AnnotationCard({
  annotation,
  expanded,
  onExpand,
  onCollapse,
  onApplyFix,
  onDismiss,
  onRelatedNodeClick,
}: Props) {
  const [dismissReason, setDismissReason] = useState('');
  const [showReasonInput, setShowReasonInput] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const style = severityStyles[annotation.severity];
  const isApplied = annotation.status === 'applied';

  // Focus the dialog on expand so the Escape key works without a prior click,
  // and install a document-level mousedown listener so outside clicks collapse it.
  useEffect(() => {
    if (!expanded) {
      setShowReasonInput(false);
      setDismissReason('');
      return;
    }
    dialogRef.current?.focus();
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (target && dialogRef.current && !dialogRef.current.contains(target)) {
        onCollapse();
      }
    };
    const onDocKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCollapse();
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onDocKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onDocKey);
    };
  }, [expanded, onCollapse]);

  const titleClass = isApplied ? 'opacity-50 line-through' : '';

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={onExpand}
        aria-label={`${annotation.severity}: ${annotation.title}`}
        data-testid={`annotation-card-${annotation.id}`}
        className={`flex items-center gap-1.5 rounded border px-2 py-1 text-xs max-w-[220px] truncate ${style.wrap} ${titleClass}`}
      >
        {style.icon}
        <span className="truncate">{annotation.title}</span>
      </button>
    );
  }

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${annotation.severity}: ${annotation.title}`}
      data-testid={`annotation-card-${annotation.id}`}
      tabIndex={-1}
      className={`rounded border p-2 text-xs w-[260px] outline-none ${style.wrap}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className={`flex items-center gap-1.5 font-medium ${titleClass}`}>
          {style.icon}
          <span>{annotation.title}</span>
        </div>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Close"
          className="text-gray-400 hover:text-white"
        >
          <X size={12} />
        </button>
      </div>
      <p className="mt-1 text-gray-300 whitespace-pre-wrap">{annotation.description}</p>

      {annotation.relatedNodes && annotation.relatedNodes.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Related nodes</div>
          <div className="flex flex-wrap gap-1">
            {annotation.relatedNodes.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => onRelatedNodeClick?.(id)}
                className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-300 text-[10px] hover:bg-gray-700"
              >
                {id}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-2 flex items-center gap-1.5">
        {annotation.fix && !isApplied && (
          <button
            type="button"
            onClick={onApplyFix}
            title={annotation.fix.description}
            data-testid={`apply-fix-${annotation.id}`}
            className="px-2 py-1 rounded bg-purple-600 text-white text-[10px] hover:bg-purple-700"
          >
            Apply Fix
          </button>
        )}
        {showReasonInput ? (
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={dismissReason}
              onChange={(e) => setDismissReason(e.target.value)}
              maxLength={500}
              placeholder="Reason (optional)"
              className="px-1 py-0.5 rounded bg-gray-800 border border-gray-700 text-[10px] w-28"
            />
            <button
              type="button"
              data-testid={`dismiss-${annotation.id}`}
              onClick={() => onDismiss(dismissReason || undefined)}
              className="px-2 py-1 rounded bg-gray-700 text-gray-200 text-[10px] hover:bg-gray-600"
            >
              {dismissReason ? 'OK' : 'Dismiss'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowReasonInput(true)}
            data-testid={`dismiss-${annotation.id}`}
            className="px-2 py-1 rounded bg-gray-700 text-gray-200 text-[10px] hover:bg-gray-600"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}

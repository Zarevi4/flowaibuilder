import { useMemo } from 'react';
import { useReactFlow } from '@xyflow/react';
import type { Annotation } from '@flowaibuilder/shared';
import { X } from 'lucide-react';
import { useReviewStore } from '../../../store/review';

const SEVERITY_ORDER: Annotation['severity'][] = ['error', 'warning', 'suggestion'];

export function ReviewPanel() {
  const open = useReviewStore((s) => s.panelOpen);
  const togglePanel = useReviewStore((s) => s.togglePanel);
  const annotations = useReviewStore((s) => s.annotations);
  const setExpanded = useReviewStore((s) => s.setExpanded);
  const { getNode, setCenter } = useReactFlow();

  const grouped = useMemo(() => {
    const g: Record<Annotation['severity'], Annotation[]> = {
      error: [],
      warning: [],
      suggestion: [],
    };
    for (const a of annotations) g[a.severity].push(a);
    return g;
  }, [annotations]);

  if (!open) return null;

  return (
    <div
      data-testid="review-panel"
      className="absolute top-0 right-0 h-full w-80 bg-gray-900 border-l border-gray-800 z-20 flex flex-col"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
        <h3 className="text-sm font-semibold text-white">Review ({annotations.length})</h3>
        <button onClick={togglePanel} aria-label="Close review panel" className="text-gray-400 hover:text-white">
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-auto p-2 space-y-3">
        {SEVERITY_ORDER.map((sev) => {
          const list = grouped[sev];
          if (list.length === 0) return null;
          return (
            <div key={sev}>
              <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1 px-1">{sev}</div>
              <div className="space-y-1">
                {list.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      setExpanded(a.id);
                      const n = getNode(a.nodeId);
                      if (n) setCenter(n.position.x, n.position.y, { zoom: 1.2, duration: 200 });
                    }}
                    className="block w-full text-left px-2 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-xs"
                  >
                    <div className="text-white font-medium truncate">{a.title}</div>
                    <div className="text-gray-400 truncate">{a.description}</div>
                    <div className="text-gray-500 text-[10px] mt-0.5">node: {a.nodeId}</div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {annotations.length === 0 && (
          <div className="text-xs text-gray-500 text-center mt-8">No active annotations</div>
        )}
      </div>
    </div>
  );
}

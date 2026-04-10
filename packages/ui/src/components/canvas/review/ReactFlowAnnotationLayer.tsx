import { useMemo } from 'react';
import { useReactFlow, useStore } from '@xyflow/react';
import type { Annotation } from '@flowaibuilder/shared';
import { useReviewStore } from '../../../store/review';
import { AnnotationCard } from './AnnotationCard';
import { AnnotationConnector } from './AnnotationConnector';

const CARD_OFFSET_X = 220;
const CARD_GAP = 4;
const CARD_HEIGHT = 32;
const SEVERITY_ORDER: Record<Annotation['severity'], number> = {
  error: 0,
  warning: 1,
  suggestion: 2,
};

export function ReactFlowAnnotationLayer() {
  const annotations = useReviewStore((s) => s.annotations);
  const expandedId = useReviewStore((s) => s.expandedAnnotationId);
  const setExpanded = useReviewStore((s) => s.setExpanded);
  const applyFix = useReviewStore((s) => s.applyFix);
  const dismiss = useReviewStore((s) => s.dismiss);
  const { getNode, setCenter } = useReactFlow();
  // Re-render on viewport changes so overlay pans/zooms with canvas.
  const viewport = useStore((s) => s.transform);
  // Re-render on node drag / resize so cards track their target node.
  // Subscribe to nodeLookup (identity changes when any node moves/resizes)
  // so drag updates — which don't mutate `transform` — still trigger a render.
  useStore((s) => s.nodeLookup);

  const grouped = useMemo(() => {
    const by = new Map<string, Annotation[]>();
    for (const a of annotations) {
      const list = by.get(a.nodeId) ?? [];
      list.push(a);
      by.set(a.nodeId, list);
    }
    for (const list of by.values()) {
      list.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    }
    return by;
  }, [annotations]);

  const [tx, ty, zoom] = viewport;

  return (
    <div
      data-testid="annotation-layer"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 5,
      }}
    >
      {Array.from(grouped.entries()).map(([nodeId, list]) => {
        const node = getNode(nodeId);
        if (!node) return null;
        // Use measured width when available; fall back to the default RF node width.
        const nodeWidth = node.measured?.width ?? node.width ?? 120;
        // Convert flow coords → screen coords (flow pans/zooms with `transform`).
        const nodeScreenX = node.position.x * zoom + tx;
        const nodeScreenY = node.position.y * zoom + ty;
        // Cards live in SCREEN space at fixed pixel size regardless of zoom —
        // so offsets and stacking are NOT multiplied by `zoom`.
        const baseX = nodeScreenX + nodeWidth * zoom + CARD_OFFSET_X - 120;
        const baseY = nodeScreenY;
        return list.map((ann, i) => {
          const yOff = baseY + i * (CARD_HEIGHT + CARD_GAP);
          return (
            <div key={ann.id}>
              <AnnotationConnector
                from={{ x: nodeScreenX + nodeWidth * zoom, y: baseY + CARD_HEIGHT / 2 }}
                to={{ x: baseX, y: yOff + CARD_HEIGHT / 2 }}
                severity={ann.severity}
              />
              <div
                style={{
                  position: 'absolute',
                  transform: `translate(${baseX}px, ${yOff}px)`,
                  pointerEvents: 'auto',
                }}
              >
                <AnnotationCard
                  annotation={ann}
                  expanded={expandedId === ann.id}
                  onExpand={() => setExpanded(ann.id)}
                  onCollapse={() => setExpanded(null)}
                  onApplyFix={() => void applyFix(ann.id)}
                  onDismiss={(reason) => void dismiss(ann.id, reason)}
                  onRelatedNodeClick={(id) => {
                    const n = getNode(id);
                    if (n) setCenter(n.position.x, n.position.y, { zoom: 1.2, duration: 200 });
                  }}
                />
              </div>
            </div>
          );
        });
      })}
    </div>
  );
}

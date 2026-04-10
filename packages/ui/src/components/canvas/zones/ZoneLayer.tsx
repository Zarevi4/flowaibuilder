import { useMemo } from 'react';
import { useStore, ViewportPortal, type ReactFlowState } from '@xyflow/react';
import type { ProtectedZone } from '@flowaibuilder/shared';
import { useWorkflowStore } from '../../../store/workflow';

const PADDING = 24;
const DEFAULT_COLOR = '#378ADD';

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diff = Math.max(0, Date.now() - then);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

interface ComputedZone {
  zone: ProtectedZone;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ZoneLayerProps {
  onZoneContextMenu?: (event: React.MouseEvent, zone: ProtectedZone) => void;
}

const selectNodeLookup = (s: ReactFlowState) => s.nodeLookup;

export function ZoneLayer({ onZoneContextMenu }: ZoneLayerProps = {}) {
  const zones = useWorkflowStore((s) => s.zones);
  // Subscribe to nodeLookup so the memo recomputes whenever nodes move/resize.
  const nodeLookup = useStore(selectNodeLookup);

  const computed = useMemo<ComputedZone[]>(() => {
    const result: ComputedZone[] = [];
    for (const zone of zones) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let any = false;
      for (const id of zone.nodeIds) {
        const n = nodeLookup.get(id) as
          | { position: { x: number; y: number }; measured?: { width?: number; height?: number }; width?: number; height?: number }
          | undefined;
        if (!n) continue;
        const w = n.measured?.width ?? n.width ?? 180;
        const h = n.measured?.height ?? n.height ?? 60;
        const x = n.position.x;
        const y = n.position.y;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x + w > maxX) maxX = x + w;
        if (y + h > maxY) maxY = y + h;
        any = true;
      }
      if (!any) continue;
      result.push({
        zone,
        x: minX - PADDING,
        y: minY - PADDING,
        width: maxX - minX + PADDING * 2,
        height: maxY - minY + PADDING * 2,
      });
    }
    return result;
  }, [zones, nodeLookup]);

  if (computed.length === 0) return null;

  return (
    <ViewportPortal>
      {computed.map(({ zone, x, y, width, height }) => {
        const color = zone.color ?? DEFAULT_COLOR;
        return (
          <div
            key={zone.id}
            data-testid={`zone-${zone.id}`}
            style={{
              position: 'absolute',
              transform: `translate(${x}px, ${y}px)`,
              width,
              height,
              border: `2px dashed ${color}`,
              borderRadius: 8,
              // Rect itself must NOT swallow clicks on member nodes (AC #1: "behind all member nodes").
              // Only the label below opts back into pointer events for the right-click menu.
              pointerEvents: 'none',
              background: 'transparent',
              zIndex: -1,
            }}
          >
            <div
              onContextMenu={(e) => {
                if (!onZoneContextMenu) return;
                e.preventDefault();
                e.stopPropagation();
                onZoneContextMenu(e, zone);
              }}
              style={{
                position: 'absolute',
                left: 8,
                top: 4,
                color,
                fontSize: 11,
                fontWeight: 600,
                lineHeight: 1.2,
                fontFamily: 'system-ui, sans-serif',
                textShadow: '0 1px 2px rgba(0,0,0,0.6)',
                pointerEvents: 'auto',
                cursor: 'context-menu',
                padding: '2px 4px',
              }}
            >
              <div>{zone.name}</div>
              <div style={{ fontWeight: 400, opacity: 0.85 }}>
                Pinned by {zone.pinnedBy} · {relativeTime(zone.pinnedAt)}
              </div>
            </div>
          </div>
        );
      })}
    </ViewportPortal>
  );
}

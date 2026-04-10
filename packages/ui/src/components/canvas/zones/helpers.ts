// Story 3.2: pure helpers for zone interactions on the canvas.
// Extracted from Canvas.tsx so they can be unit-tested without pulling in @xyflow/react.

/** Strip zero-width chars and trim. Returns null if the result is empty. */
export function sanitizeZoneName(raw: string | null): string | null {
  if (raw == null) return null;
  const cleaned = raw.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  return cleaned.length === 0 ? null : cleaned;
}

/** Apply pinned flags to a node: blocks drag AND delete, propagates pinned to data. */
export function applyPinnedFlag<
  N extends { draggable?: boolean; deletable?: boolean; data?: Record<string, unknown> }
>(node: N, isPinned: boolean): N {
  if (!isPinned) return node;
  return {
    ...node,
    draggable: false,
    deletable: false,
    data: { ...(node.data ?? {}), pinned: true },
  };
}

export function buildNodeMenuLabels(isPinned: boolean): string[] {
  return isPinned ? ['Remove from Zone'] : ['Create Protected Zone'];
}
export function buildPaneMenuLabels(): string[] {
  return ['Create Protected Zone (with selection)'];
}
export function buildZoneMenuLabels(): string[] {
  return ['Unpin Zone', 'Rename Zone'];
}

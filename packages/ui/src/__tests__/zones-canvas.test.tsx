import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { createElement } from 'react';
import type { ProtectedZone, WebSocketMessage, Workflow } from '@flowaibuilder/shared';
import { useWorkflowStore } from '../store/workflow';
import { BaseNode } from '../components/canvas/nodes/BaseNode';
import { CanvasContextMenu, type ContextMenuState } from '../components/canvas/zones/ContextMenu';
import {
  applyPinnedFlag,
  buildNodeMenuLabels,
  buildPaneMenuLabels,
  buildZoneMenuLabels,
  sanitizeZoneName,
} from '../components/canvas/zones/helpers';

// Mock @xyflow/react primitives used by BaseNode (mirrors base-node-overlay.test.ts)
vi.mock('@xyflow/react', () => ({
  Handle: function MockHandle(props: Record<string, unknown>) {
    return createElement('div', { 'data-testid': `handle-${props.type}-${props.id}` });
  },
  Position: { Left: 'left', Right: 'right' },
}));

vi.mock('@flowaibuilder/shared', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@flowaibuilder/shared');
  return {
    ...actual,
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
  };
});

vi.mock('../lib/icons', () => ({ resolveIcon: () => null }));

function fakeWorkflow(): Workflow {
  return {
    id: 'wf1',
    name: 'wf',
    description: '',
    nodes: [],
    connections: [],
    active: false,
    version: 1,
    environment: 'dev',
    canvas: {},
    settings: {},
    tags: [],
    createdBy: 't',
    updatedBy: 't',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeZone(overrides: Partial<ProtectedZone> = {}): ProtectedZone {
  return {
    id: 'z1',
    workflowId: 'wf1',
    name: 'critical',
    nodeIds: ['n1'],
    color: '#378ADD',
    pinnedBy: 'ui:user',
    pinnedAt: new Date().toISOString(),
    ...overrides,
  };
}

function wsMsg(type: WebSocketMessage['type'], data: unknown): WebSocketMessage {
  return { type, workflowId: 'wf1', data, timestamp: new Date().toISOString() };
}

describe('Workflow store — zone WS reducer cases', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      workflow: fakeWorkflow(),
      nodes: [],
      edges: [],
      taskLinks: [],
      zones: [],
      loading: false,
      error: null,
      fitViewCounter: 0,
    });
  });

  it('zone_created adds a zone to the store', () => {
    const zone = makeZone();
    useWorkflowStore.getState().applyWsMessage(wsMsg('zone_created', { zone }));
    expect(useWorkflowStore.getState().zones).toHaveLength(1);
    expect(useWorkflowStore.getState().zones[0].id).toBe('z1');
  });

  it('zone_created is idempotent (duplicate id ignored)', () => {
    const zone = makeZone();
    useWorkflowStore.getState().applyWsMessage(wsMsg('zone_created', { zone }));
    useWorkflowStore.getState().applyWsMessage(wsMsg('zone_created', { zone }));
    expect(useWorkflowStore.getState().zones).toHaveLength(1);
  });

  it('zone_updated replaces a zone in place', () => {
    useWorkflowStore.setState({ zones: [makeZone()] });
    const renamed = makeZone({ name: 'renamed' });
    useWorkflowStore.getState().applyWsMessage(wsMsg('zone_updated', { zone: renamed }));
    expect(useWorkflowStore.getState().zones[0].name).toBe('renamed');
  });

  it('zone_deleted removes the zone by id', () => {
    useWorkflowStore.setState({ zones: [makeZone()] });
    useWorkflowStore.getState().applyWsMessage(wsMsg('zone_deleted', { zone_id: 'z1' }));
    expect(useWorkflowStore.getState().zones).toHaveLength(0);
  });
});

describe('BaseNode pinned overlay', () => {
  it('renders the lock icon and opacity-70 when pinned=true', () => {
    const { container, getByTestId } = render(
      createElement(BaseNode, { nodeType: 'http-request', name: 'X', pinned: true }),
    );
    expect(getByTestId('pinned-lock')).toBeTruthy();
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('opacity-70');
  });

  it('does NOT render the lock icon when pinned is undefined', () => {
    const { queryByTestId } = render(
      createElement(BaseNode, { nodeType: 'http-request', name: 'X' }),
    );
    expect(queryByTestId('pinned-lock')).toBeNull();
  });
});

describe('CanvasContextMenu', () => {
  it('renders provided items and invokes onSelect on click', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const state: ContextMenuState = {
      x: 10,
      y: 10,
      items: [{ label: 'Unpin Zone', onSelect }],
    };
    const { getByText } = render(
      createElement(CanvasContextMenu, { state, onClose }),
    );
    const button = getByText('Unpin Zone');
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onSelect).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('renders nothing when state is null', () => {
    const { container } = render(
      createElement(CanvasContextMenu, { state: null, onClose: () => {} }),
    );
    expect(container.firstChild).toBeNull();
  });
});

// AC #11(e): pinned nodes get draggable === false (and deletable === false) via the merge.
describe('applyPinnedFlag (Canvas merge — AC #11e)', () => {
  type TestNode = {
    id: string;
    draggable?: boolean;
    deletable?: boolean;
    data?: Record<string, unknown>;
  };

  it('returns the original node unchanged when not pinned', () => {
    const n: TestNode = { id: 'n1', draggable: true, data: { foo: 1 } };
    expect(applyPinnedFlag(n, false)).toBe(n);
  });

  it('sets draggable=false, deletable=false, data.pinned=true when pinned', () => {
    const n: TestNode = { id: 'n1', draggable: true, data: { foo: 1 } };
    const out = applyPinnedFlag(n, true);
    expect(out.draggable).toBe(false);
    expect(out.deletable).toBe(false);
    expect(out.data).toEqual({ foo: 1, pinned: true });
    // Must not mutate original
    expect(n.draggable).toBe(true);
  });

  it('handles nodes with no prior data field', () => {
    const n: TestNode = { id: 'n2' };
    const out = applyPinnedFlag(n, true);
    expect(out.draggable).toBe(false);
    expect(out.deletable).toBe(false);
    expect(out.data).toEqual({ pinned: true });
  });
});

// AC #11(f): correct items for empty / single-node / zone-boundary right-clicks.
describe('Context menu label builders (AC #11f)', () => {
  it('node right-click — non-pinned offers "Create Protected Zone"', () => {
    expect(buildNodeMenuLabels(false)).toEqual(['Create Protected Zone']);
  });
  it('node right-click — pinned offers "Remove from Zone"', () => {
    expect(buildNodeMenuLabels(true)).toEqual(['Remove from Zone']);
  });
  it('pane right-click after marquee select offers "Create Protected Zone (with selection)"', () => {
    expect(buildPaneMenuLabels()).toEqual(['Create Protected Zone (with selection)']);
  });
  it('zone-boundary right-click offers Unpin and Rename', () => {
    expect(buildZoneMenuLabels()).toEqual(['Unpin Zone', 'Rename Zone']);
  });
});

describe('sanitizeZoneName', () => {
  it('returns null for null/empty/whitespace', () => {
    expect(sanitizeZoneName(null)).toBeNull();
    expect(sanitizeZoneName('')).toBeNull();
    expect(sanitizeZoneName('   ')).toBeNull();
  });
  it('rejects zero-width-only input', () => {
    expect(sanitizeZoneName('\u200B\u200C')).toBeNull();
  });
  it('trims and strips zero-width chars', () => {
    expect(sanitizeZoneName('  hello\u200B  ')).toBe('hello');
  });
});

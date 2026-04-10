import type {
  WorkflowNode,
  Connection,
  WorkflowSnapshot,
  WorkflowDiff,
  ChangedNodeEntry,
} from '@flowaibuilder/shared';
import type { workflows } from '../db/schema.js';

type WorkflowRow = typeof workflows.$inferSelect;

/** Build the canonical snapshot object from a persisted workflow row. */
export function snapshotFromWorkflow(row: WorkflowRow): WorkflowSnapshot {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    nodes: ((row.nodes ?? []) as WorkflowNode[]).map((n) => ({ ...n })),
    connections: ((row.connections ?? []) as Connection[]).map((c) => ({ ...c })),
    settings: ((row.settings ?? {}) as Record<string, unknown>),
    canvas: ((row.canvas ?? {}) as Record<string, unknown>),
    tags: ((row.tags ?? []) as string[]),
    active: row.active ?? false,
    version: row.version ?? 1,
    environment: row.environment ?? 'dev',
  };
}

/**
 * Deterministic JSON stringify — keys sorted recursively so the byte-level
 * output is stable across Node versions and process runs. Arrays preserved.
 * 2-space indent + trailing newline, matching git-friendly conventions.
 */
export function serializeSnapshot(snap: unknown): string {
  return stableStringify(snap, 2) + '\n';
}

function stableStringify(value: unknown, indent: number): string {
  return JSON.stringify(sortKeys(value), null, indent);
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>).sort()) {
    out[k] = sortKeys((value as Record<string, unknown>)[k]);
  }
  return out;
}

/** Stable stringify used for equality comparison during diff. */
function stable(value: unknown): string {
  return stableStringify(value, 0);
}

/**
 * Deterministic diff keyed by node.id and connection.id. The result is
 * independent of the order of the input arrays.
 */
export function diffSnapshots(
  a: WorkflowSnapshot,
  b: WorkflowSnapshot,
): Omit<WorkflowDiff, 'from' | 'to'> {
  // Legacy/corrupt snapshots may have missing arrays — treat as empty rather
  // than crashing the REST /diff endpoint.
  const aNodeArr: WorkflowNode[] = Array.isArray(a?.nodes) ? a.nodes : [];
  const bNodeArr: WorkflowNode[] = Array.isArray(b?.nodes) ? b.nodes : [];
  const aConnArr: Connection[] = Array.isArray(a?.connections) ? a.connections : [];
  const bConnArr: Connection[] = Array.isArray(b?.connections) ? b.connections : [];

  const aNodes = new Map(aNodeArr.map((n) => [n.id, n]));
  const bNodes = new Map(bNodeArr.map((n) => [n.id, n]));

  const addedNodes: WorkflowNode[] = [];
  const removedNodes: WorkflowNode[] = [];
  const changedNodes: ChangedNodeEntry[] = [];

  for (const [id, bn] of bNodes) {
    const an = aNodes.get(id);
    if (!an) {
      addedNodes.push(bn);
      continue;
    }
    const changedFields: string[] = [];
    if (an.name !== bn.name) changedFields.push('name');
    if (an.position?.x !== bn.position?.x) changedFields.push('position.x');
    if (an.position?.y !== bn.position?.y) changedFields.push('position.y');
    if ((an.disabled ?? false) !== (bn.disabled ?? false)) changedFields.push('disabled');
    if (stable(an.data?.config ?? {}) !== stable(bn.data?.config ?? {})) {
      changedFields.push('data.config');
    }
    if (changedFields.length > 0) {
      changedNodes.push({ id, before: an, after: bn, changedFields });
    }
  }
  for (const [id, an] of aNodes) {
    if (!bNodes.has(id)) removedNodes.push(an);
  }

  const aConns = new Map(aConnArr.map((c) => [c.id, c]));
  const bConns = new Map(bConnArr.map((c) => [c.id, c]));
  const addedConns: Connection[] = [];
  const removedConns: Connection[] = [];
  for (const [id, bc] of bConns) if (!aConns.has(id)) addedConns.push(bc);
  for (const [id, ac] of aConns) if (!bConns.has(id)) removedConns.push(ac);

  return {
    nodes: { added: addedNodes, removed: removedNodes, changed: changedNodes },
    connections: { added: addedConns, removed: removedConns },
    meta: {
      nameChanged: (a?.name ?? '') !== (b?.name ?? ''),
      descriptionChanged: (a?.description ?? '') !== (b?.description ?? ''),
      settingsChanged: stable(a?.settings ?? {}) !== stable(b?.settings ?? {}),
    },
  };
}

/**
 * True iff any versioning-relevant field differs between the before/after
 * workflow row shapes. Cosmetic-only updates (updatedAt-only touch from
 * finishing an execution) must NOT create a new version. Both sides are
 * normalized to canonical defaults before comparison so a pre-fetched row
 * with `active: undefined` does not spuriously differ from a DB-normalized
 * `active: false`.
 */
export function shouldVersion(before: unknown, after: unknown): boolean {
  // When either side is missing we cannot make a meaningful comparison —
  // default to false (do not version) to match cosmetic-touch semantics.
  // Callers that explicitly want a version should call recordSnapshot directly.
  if (!before || !after) return false;
  const defaults: Record<string, unknown> = {
    nodes: [],
    connections: [],
    settings: {},
    canvas: {},
    name: '',
    description: '',
    tags: [],
    active: false,
    environment: 'dev',
  };
  for (const f of Object.keys(defaults)) {
    const a = (before as Record<string, unknown>)[f] ?? defaults[f];
    const b = (after as Record<string, unknown>)[f] ?? defaults[f];
    if (stable(a) !== stable(b)) return true;
  }
  return false;
}

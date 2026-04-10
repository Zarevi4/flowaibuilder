import { nanoid } from 'nanoid';
import type { WorkflowNode, NodeType, N8nImportWarning } from '@flowaibuilder/shared';

export const N8N_TYPE_MAP: Record<string, NodeType> = {
  'n8n-nodes-base.webhook': 'webhook',
  'n8n-nodes-base.scheduleTrigger': 'schedule',
  'n8n-nodes-base.cron': 'schedule',
  'n8n-nodes-base.manualTrigger': 'manual',
  'n8n-nodes-base.code': 'code-js',
  'n8n-nodes-base.function': 'code-js',
  'n8n-nodes-base.functionItem': 'code-js',
  'n8n-nodes-base.httpRequest': 'http-request',
  'n8n-nodes-base.if': 'if',
  'n8n-nodes-base.switch': 'switch',
  'n8n-nodes-base.merge': 'merge',
  'n8n-nodes-base.set': 'set',
  'n8n-nodes-base.respondToWebhook': 'respond-webhook',
};

export interface RawN8nNode {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  typeVersion?: unknown;
  position?: unknown;
  parameters?: unknown;
}

const ID_RE = /^[A-Za-z0-9_-]+$/;

export interface MappedNode {
  node: WorkflowNode;
  warning?: N8nImportWarning;
  originalId: string;
  originalName: string;
}

export function mapN8nNode(raw: RawN8nNode): MappedNode {
  const now = new Date().toISOString();
  const originalName = typeof raw.name === 'string' ? raw.name : 'Unnamed';
  const rawType = typeof raw.type === 'string' ? raw.type : 'unknown';
  const typeVersion = raw.typeVersion;

  const rawId = typeof raw.id === 'string' ? raw.id : raw.id != null ? String(raw.id) : '';
  const id = rawId && ID_RE.test(rawId) ? rawId : nanoid(12);

  let position = { x: 0, y: 0 };
  if (Array.isArray(raw.position) && raw.position.length >= 2) {
    const x = Number(raw.position[0]);
    const y = Number(raw.position[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) position = { x, y };
  }

  const mappedType = N8N_TYPE_MAP[rawType];
  const parameters =
    raw.parameters && typeof raw.parameters === 'object' ? (raw.parameters as Record<string, unknown>) : {};

  if (mappedType) {
    const node: WorkflowNode = {
      id,
      type: mappedType,
      name: originalName,
      position,
      data: {
        label: originalName,
        config: { ...parameters },
      },
      createdAt: now,
      updatedAt: now,
    };
    return { node, originalId: rawId || id, originalName };
  }

  // Unknown → placeholder code-js
  const paramsJson = JSON.stringify(parameters, null, 2)
    .split('\n')
    .map((line) => `// ${line}`)
    .join('\n');
  const code = `// Imported from n8n
// Original type: ${rawType} (v${typeVersion ?? '?'})
// Original parameters:
${paramsJson}
return $input.all();`;

  const node: WorkflowNode = {
    id,
    type: 'code-js',
    name: originalName,
    position,
    data: {
      label: originalName,
      config: { code, language: 'javascript' },
    },
    createdAt: now,
    updatedAt: now,
  };

  const warning: N8nImportWarning = {
    n8nNodeName: originalName,
    n8nType: rawType,
    mappedTo: 'code-js',
    reason: `n8n node type "${rawType}" is not supported; converted to code-js placeholder`,
  };

  return { node, warning, originalId: rawId || id, originalName };
}

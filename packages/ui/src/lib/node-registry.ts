import type { ComponentType } from 'react';
import type { NodeProps } from '@xyflow/react';
import { NODE_TYPES } from '@flowaibuilder/shared';
import { TriggerNode } from '../components/canvas/nodes/TriggerNode';
import { CodeNode } from '../components/canvas/nodes/CodeNode';
import { HttpNode } from '../components/canvas/nodes/HttpNode';
import { LogicNode } from '../components/canvas/nodes/LogicNode';
import { AiNode } from '../components/canvas/nodes/AiNode';
import { OutputNode } from '../components/canvas/nodes/OutputNode';

function getComponentForType(type: string): ComponentType<NodeProps> {
  const meta = NODE_TYPES[type];
  if (!meta) return LogicNode;

  if (type === 'code-js' || type === 'code-python' || type === 'set') return CodeNode;
  if (type === 'ai-agent') return AiNode;
  if (type === 'http-request') return HttpNode;
  if (meta.category === 'trigger') return TriggerNode;
  if (meta.category === 'output') return OutputNode;
  if (meta.category === 'logic') return LogicNode;
  return LogicNode;
}

export const nodeTypeMap: Record<string, ComponentType<NodeProps>> = {};

for (const type of Object.keys(NODE_TYPES)) {
  nodeTypeMap[type] = getComponentForType(type);
}

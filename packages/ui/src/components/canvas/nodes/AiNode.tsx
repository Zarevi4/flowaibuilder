import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';

export function AiNode({ data, selected }: NodeProps) {
  const nodeType = (data.nodeType as string) ?? 'ai-agent';
  const name = (data.name as string) ?? 'AI Agent';
  const config = (data.config as Record<string, unknown>) ?? {};
  const model = (config.model as string) ?? '';

  const executionStatus = data.executionStatus as import('@flowaibuilder/shared').ExecutionStatus | null | undefined;
  const linkedAgent = data.linkedAgent as string | undefined;
  const linkedTaskStatus = data.linkedTaskStatus as string | undefined;
  const linkedTaskTitle = data.linkedTaskTitle as string | undefined;
  const pinned = data.pinned as boolean | undefined;

  return (
    <BaseNode nodeType={nodeType} name={name} selected={selected} executionStatus={executionStatus} linkedAgent={linkedAgent} linkedTaskStatus={linkedTaskStatus} linkedTaskTitle={linkedTaskTitle} pinned={pinned}>
      {model ? (
        <span>{model}</span>
      ) : (
        <span className="italic text-gray-500">No model configured</span>
      )}
    </BaseNode>
  );
}

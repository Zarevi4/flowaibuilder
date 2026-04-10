import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';

export function OutputNode({ data, selected }: NodeProps) {
  const nodeType = (data.nodeType as string) ?? 'respond-webhook';
  const name = (data.name as string) ?? 'Respond Webhook';

  const executionStatus = data.executionStatus as import('@flowaibuilder/shared').ExecutionStatus | null | undefined;
  const linkedAgent = data.linkedAgent as string | undefined;
  const linkedTaskStatus = data.linkedTaskStatus as string | undefined;
  const linkedTaskTitle = data.linkedTaskTitle as string | undefined;
  const pinned = data.pinned as boolean | undefined;

  return (
    <BaseNode nodeType={nodeType} name={name} selected={selected} executionStatus={executionStatus} linkedAgent={linkedAgent} linkedTaskStatus={linkedTaskStatus} linkedTaskTitle={linkedTaskTitle} pinned={pinned}>
      <span>Respond Webhook</span>
    </BaseNode>
  );
}

import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';

export function CodeNode({ data, selected }: NodeProps) {
  const nodeType = (data.nodeType as string) ?? 'code-js';
  const name = (data.name as string) ?? 'Code';
  const config = (data.config as Record<string, unknown>) ?? {};
  const code = (config.code as string) ?? '';

  const preview = code
    ? code.split('\n').slice(0, 2).join('\n')
    : null;

  const executionStatus = data.executionStatus as import('@flowaibuilder/shared').ExecutionStatus | null | undefined;
  const linkedAgent = data.linkedAgent as string | undefined;
  const linkedTaskStatus = data.linkedTaskStatus as string | undefined;
  const linkedTaskTitle = data.linkedTaskTitle as string | undefined;
  const pinned = data.pinned as boolean | undefined;

  return (
    <BaseNode nodeType={nodeType} name={name} selected={selected} executionStatus={executionStatus} linkedAgent={linkedAgent} linkedTaskStatus={linkedTaskStatus} linkedTaskTitle={linkedTaskTitle} pinned={pinned}>
      {preview ? (
        <pre className="font-mono truncate whitespace-pre-wrap">{preview}</pre>
      ) : (
        <span className="italic text-gray-500">No code</span>
      )}
    </BaseNode>
  );
}

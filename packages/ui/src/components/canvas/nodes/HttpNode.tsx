import type { NodeProps } from '@xyflow/react';
import { NODE_TYPES } from '@flowaibuilder/shared';
import { BaseNode } from './BaseNode';

export function HttpNode({ data, selected }: NodeProps) {
  const nodeType = (data.nodeType as string) ?? 'http-request';
  const name = (data.name as string) ?? 'HTTP Request';
  const config = (data.config as Record<string, unknown>) ?? {};
  const method = ((config.method as string) ?? 'GET').toUpperCase();
  const url = (config.url as string) ?? '';
  const color = NODE_TYPES[nodeType]?.color ?? '#D85A30';

  const truncatedUrl = url.length > 30 ? url.slice(0, 30) + '…' : url;

  const executionStatus = data.executionStatus as import('@flowaibuilder/shared').ExecutionStatus | null | undefined;
  const linkedAgent = data.linkedAgent as string | undefined;
  const linkedTaskStatus = data.linkedTaskStatus as string | undefined;
  const linkedTaskTitle = data.linkedTaskTitle as string | undefined;
  const pinned = data.pinned as boolean | undefined;

  return (
    <BaseNode nodeType={nodeType} name={name} selected={selected} executionStatus={executionStatus} linkedAgent={linkedAgent} linkedTaskStatus={linkedTaskStatus} linkedTaskTitle={linkedTaskTitle} pinned={pinned}>
      <div className="flex items-center gap-1">
        <span
          className="px-1 py-0.5 rounded text-[9px] font-bold text-white"
          style={{ backgroundColor: color }}
        >
          {method}
        </span>
        {truncatedUrl ? (
          <span className="truncate">{truncatedUrl}</span>
        ) : (
          <span className="italic text-gray-500">No URL</span>
        )}
      </div>
    </BaseNode>
  );
}

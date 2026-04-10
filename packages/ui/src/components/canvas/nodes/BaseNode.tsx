import type { ReactNode } from 'react';
import { Handle, Position } from '@xyflow/react';
import { NODE_TYPES } from '@flowaibuilder/shared';
import type { ExecutionStatus } from '@flowaibuilder/shared';
import { resolveIcon } from '../../../lib/icons';
import { XCircle, Lock } from 'lucide-react';
import { agentColor } from '../Canvas';

interface BaseNodeProps {
  nodeType: string;
  name: string;
  icon?: ReactNode;
  children?: ReactNode;
  selected?: boolean;
  executionStatus?: ExecutionStatus | null;
  linkedAgent?: string;
  linkedTaskStatus?: string;
  linkedTaskTitle?: string;
  pinned?: boolean;
}

function getExecutionRingClasses(status: ExecutionStatus | null | undefined): string {
  switch (status) {
    case 'running':
      return 'ring-2 ring-blue-400 animate-pulse';
    case 'success':
      return 'ring-2 ring-green-400';
    case 'error':
      return 'ring-2 ring-red-400';
    case 'pending':
      return 'ring-2 ring-yellow-400/50';
    case 'cancelled':
      return 'border-2 border-dashed border-gray-500 opacity-60';
    default:
      return '';
  }
}

export function BaseNode({ nodeType, name, icon, children, selected, executionStatus, linkedAgent, linkedTaskStatus, linkedTaskTitle, pinned }: BaseNodeProps) {
  const meta = NODE_TYPES[nodeType];
  const ResolvedIcon = meta ? resolveIcon(meta.icon) : null;
  const renderedIcon = icon ?? (ResolvedIcon ? <ResolvedIcon size={14} /> : null);
  const color = meta?.color ?? '#888';
  const inputs = meta?.inputs ?? 1;
  const outputs = meta?.outputs ?? 1;
  const execRing = getExecutionRingClasses(executionStatus);
  const buildingRing = !executionStatus && linkedTaskStatus === 'in-progress'
    ? 'ring-2 ring-purple-400 animate-pulse'
    : '';

  return (
    <div
      className={`
        relative bg-gray-900 rounded-lg shadow-lg min-w-[180px] max-w-[220px]
        border border-gray-700 transition-shadow
        ${selected ? 'shadow-xl ring-2 ring-blue-500/50' : ''}
        ${!selected ? execRing || buildingRing : ''}
        ${pinned ? 'opacity-70' : ''}
      `}
      style={{ borderLeftColor: color, borderLeftWidth: '3px' }}
    >
      {/* Pinned (protected zone) lock badge */}
      {pinned && (
        <div className="absolute -top-1 -right-1 z-10" data-testid="pinned-lock">
          <Lock size={12} className="text-blue-300" />
        </div>
      )}
      {/* Error indicator badge */}
      {executionStatus === 'error' && (
        <div className="absolute -top-2 -right-2 z-10">
          <XCircle size={16} className="text-red-400 fill-gray-900" />
        </div>
      )}

      {/* Target handles (inputs) */}
      {inputs > 0 &&
        Array.from({ length: inputs }).map((_, i) => (
          <Handle
            key={`target-${i}`}
            type="target"
            position={Position.Left}
            id={`input-${i}`}
            style={{
              top: inputs > 1 ? `${((i + 1) / (inputs + 1)) * 100}%` : '50%',
              background: color,
              width: 8,
              height: 8,
              border: '2px solid #1f2937',
            }}
          />
        ))}

      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-t-lg"
        style={{ backgroundColor: `${color}15` }}
      >
        <span style={{ color }}>{renderedIcon}</span>
        <span className="text-white text-xs font-medium truncate">{name}</span>
      </div>

      {/* Body */}
      {children && (
        <div className="px-3 py-2 text-gray-400 text-[10px] leading-tight border-t border-gray-800">
          {children}
        </div>
      )}

      {/* Source handles (outputs) */}
      {outputs > 0 &&
        Array.from({ length: outputs }).map((_, i) => (
          <Handle
            key={`source-${i}`}
            type="source"
            position={Position.Right}
            id={`output-${i}`}
            style={{
              top: outputs > 1 ? `${((i + 1) / (outputs + 1)) * 100}%` : '50%',
              background: color,
              width: 8,
              height: 8,
              border: '2px solid #1f2937',
            }}
          />
        ))}

      {/* Agent badge -- positioned below the node */}
      {linkedAgent && (
        <div
          className={`absolute -bottom-5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-[10px] font-medium text-white whitespace-nowrap ${agentColor(linkedAgent)}`}
          title={linkedTaskTitle}
        >
          {linkedAgent}
        </div>
      )}
    </div>
  );
}

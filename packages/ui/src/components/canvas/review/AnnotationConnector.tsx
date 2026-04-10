interface Props {
  from: { x: number; y: number };
  to: { x: number; y: number };
  severity: 'error' | 'warning' | 'suggestion';
}

const colorBySeverity: Record<Props['severity'], string> = {
  error: '#ef4444',
  warning: '#f59e0b',
  suggestion: '#3b82f6',
};

export function AnnotationConnector({ from, to, severity }: Props) {
  return (
    <svg
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: 'none',
        overflow: 'visible',
      }}
    >
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke={colorBySeverity[severity]}
        strokeDasharray="3 2"
        strokeWidth={1}
        opacity={0.5}
      />
    </svg>
  );
}

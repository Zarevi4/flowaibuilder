interface Props {
  nodeId: string;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}

const OPERATORS = [
  'equals', 'notEquals', 'gt', 'gte', 'lt', 'lte',
  'contains', 'notContains', 'startsWith', 'endsWith',
  'isEmpty', 'isNotEmpty', 'exists', 'notExists',
] as const;

export function IfForm({ config, onChange }: Props) {
  const field = (config.field as string) ?? '';
  const operator = (config.operator as string) ?? 'equals';
  const value = (config.value as string) ?? '';

  const update = (patch: Record<string, unknown>) => onChange({ ...config, ...patch });

  const noValueNeeded = ['isEmpty', 'isNotEmpty', 'exists', 'notExists'].includes(operator);

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-xs text-gray-400 mb-1 block">Field</span>
        <input
          type="text"
          value={field}
          onChange={(e) => update({ field: e.target.value })}
          placeholder="data.status"
          className="input-field"
        />
      </label>

      <label className="block">
        <span className="text-xs text-gray-400 mb-1 block">Operator</span>
        <select value={operator} onChange={(e) => update({ operator: e.target.value })} className="input-field">
          {OPERATORS.map((op) => <option key={op} value={op}>{op}</option>)}
        </select>
      </label>

      {!noValueNeeded && (
        <label className="block">
          <span className="text-xs text-gray-400 mb-1 block">Value</span>
          <input
            type="text"
            value={String(value)}
            onChange={(e) => update({ value: e.target.value })}
            className="input-field"
          />
        </label>
      )}
    </div>
  );
}

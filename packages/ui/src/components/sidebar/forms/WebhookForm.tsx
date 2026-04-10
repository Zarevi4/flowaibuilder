interface Props {
  nodeId: string;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

export function WebhookForm({ config, onChange }: Props) {
  const path = (config.path as string) ?? '';
  const method = (config.method as string) ?? 'POST';

  const update = (patch: Record<string, unknown>) => onChange({ ...config, ...patch });

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-xs text-gray-400 mb-1 block">Path</span>
        <input
          type="text"
          value={path}
          onChange={(e) => update({ path: e.target.value })}
          placeholder="/my-webhook"
          className="input-field"
        />
      </label>

      <label className="block">
        <span className="text-xs text-gray-400 mb-1 block">Method Filter</span>
        <select value={method} onChange={(e) => update({ method: e.target.value })} className="input-field">
          {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>
    </div>
  );
}

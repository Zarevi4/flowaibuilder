interface Props {
  nodeId: string;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}

interface SetField {
  name: string;
  value: unknown;
}

export function SetForm({ config, onChange }: Props) {
  const mode = (config.mode as string) ?? 'set';
  const keepExisting = (config.keepExisting as boolean) ?? true;
  const fields = (config.fields as SetField[]) ?? [];

  const update = (patch: Record<string, unknown>) => onChange({ ...config, ...patch });

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-xs text-gray-400 mb-1 block">Mode</span>
        <select value={mode} onChange={(e) => update({ mode: e.target.value })} className="input-field">
          <option value="set">Set</option>
          <option value="remove">Remove</option>
        </select>
      </label>

      <label className="flex items-center gap-2 text-sm text-gray-300">
        <input
          type="checkbox"
          checked={keepExisting}
          onChange={(e) => update({ keepExisting: e.target.checked })}
          className="rounded border-gray-600"
        />
        Keep existing fields
      </label>

      <div>
        <span className="text-xs text-gray-400 mb-1 block">Fields</span>
        {fields.map((field, i) => (
          <div key={i} className="flex gap-1 mb-1">
            <input
              type="text"
              value={field.name}
              placeholder="Name"
              className="input-field flex-1"
              onChange={(e) => {
                const newFields = [...fields];
                newFields[i] = { ...field, name: e.target.value };
                update({ fields: newFields });
              }}
            />
            <input
              type="text"
              value={String(field.value ?? '')}
              placeholder="Value"
              className="input-field flex-1"
              onChange={(e) => {
                const newFields = [...fields];
                newFields[i] = { ...field, value: e.target.value };
                update({ fields: newFields });
              }}
            />
            <button
              onClick={() => update({ fields: fields.filter((_, j) => j !== i) })}
              className="text-gray-500 hover:text-red-400 px-1"
            >
              x
            </button>
          </div>
        ))}
        <button
          onClick={() => update({ fields: [...fields, { name: '', value: '' }] })}
          className="text-xs text-purple-400 hover:text-purple-300"
        >
          + Add field
        </button>
      </div>
    </div>
  );
}

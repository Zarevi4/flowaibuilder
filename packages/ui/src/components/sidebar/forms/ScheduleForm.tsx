interface Props {
  nodeId: string;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}

export function ScheduleForm({ config, onChange }: Props) {
  const cron = (config.cron as string) ?? '';

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-xs text-gray-400 mb-1 block">Cron Expression</span>
        <input
          type="text"
          value={cron}
          onChange={(e) => onChange({ ...config, cron: e.target.value })}
          placeholder="0 * * * *"
          className="input-field font-mono"
        />
      </label>
      <p className="text-xs text-gray-500">
        Format: minute hour day month weekday. Example: <code className="text-gray-400">*/5 * * * *</code> = every 5 minutes
      </p>
    </div>
  );
}

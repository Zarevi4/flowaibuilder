import { useState, useCallback } from 'react';

interface Props {
  nodeId: string;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}

export function DefaultForm({ config, onChange }: Props) {
  const [text, setText] = useState(() => JSON.stringify(config, null, 2));
  const [error, setError] = useState<string | null>(null);

  const handleBlur = useCallback(() => {
    try {
      const parsed = JSON.parse(text);
      setError(null);
      onChange(parsed);
    } catch {
      setError('Invalid JSON');
    }
  }, [text, onChange]);

  return (
    <div className="space-y-2">
      <span className="text-xs text-gray-400 block">Configuration (JSON)</span>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={handleBlur}
        rows={12}
        className="input-field font-mono text-xs w-full"
        spellCheck={false}
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

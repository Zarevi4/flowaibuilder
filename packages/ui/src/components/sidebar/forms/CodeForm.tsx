import { useCallback } from 'react';
import { useWorkflowStore } from '../../../store/workflow';
import { CodeEditor } from '../CodeEditor';

interface Props {
  nodeId: string;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}

export function CodeForm({ nodeId, config, onChange }: Props) {
  const code = (config.code as string) ?? '';
  const nodeType = useWorkflowStore((s) => s.workflow?.nodes.find((n) => n.id === nodeId)?.type);
  const language = nodeType === 'code-python' ? 'python' : 'javascript';

  // Only pass the code delta — avoids stale closure overwriting concurrent config changes
  const handleCodeChange = useCallback(
    (newCode: string) => {
      onChange({ code: newCode });
    },
    [onChange],
  );

  return (
    <div className="flex flex-col h-full -mx-3 -mb-3">
      <CodeEditor value={code} onChange={handleCodeChange} language={language} />
    </div>
  );
}

import { useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  language: 'javascript' | 'python';
}

export function CodeEditor({ value, onChange, language }: Props) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Clear pending debounce on unmount to prevent stale saves
  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  const handleChange = (val: string | undefined) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      onChangeRef.current(val ?? '');
    }, 500);
  };

  return (
    <div className="flex-1 min-h-[200px]">
      <Editor
        value={value}
        onChange={handleChange}
        language={language}
        theme="vs-dark"
        options={{
          minimap: { enabled: false },
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          fontSize: 13,
          wordWrap: 'on',
        }}
      />
    </div>
  );
}

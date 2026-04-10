import { useEffect, useState } from 'react';
import { X, Download } from 'lucide-react';
import type { ExportFormat, ExportResult } from '@flowaibuilder/shared';
import { EXPORT_FORMATS } from '@flowaibuilder/shared';
import { useWorkflowStore } from '../../store/workflow';
import { exportWorkflow } from '../../lib/api';

const FORMAT_LABELS: Record<ExportFormat, string> = {
  prompt: 'Prompt',
  typescript: 'TypeScript',
  python: 'Python',
  mermaid: 'Mermaid',
  json: 'JSON',
};

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ExportDialog({ open, onClose }: ExportDialogProps) {
  const workflow = useWorkflowStore((s) => s.workflow);
  const [format, setFormat] = useState<ExportFormat>('json');
  const [result, setResult] = useState<ExportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !workflow) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    exportWorkflow(workflow.id, format, ctrl.signal)
      .then((r) => {
        setResult(r);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [open, workflow, format]);

  if (!open) return null;

  const content = result?.content ?? '';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setCopyError(null);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : 'Copy failed');
      setTimeout(() => setCopyError(null), 3000);
    }
  };

  const handleDownload = () => {
    if (!result) return;
    const blob = new Blob([result.content], { type: result.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
      <div className="bg-gray-900 border border-gray-800 rounded-lg shadow-xl w-full max-w-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white text-lg font-semibold">Export Workflow</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="flex items-center gap-2 mb-3" data-testid="format-selector">
          {EXPORT_FORMATS.map((f) => (
            <button
              key={f}
              onClick={() => setFormat(f)}
              className={`px-3 py-1.5 rounded text-sm border ${
                format === f
                  ? 'bg-purple-600 border-purple-500 text-white'
                  : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
              }`}
            >
              {FORMAT_LABELS[f]}
            </button>
          ))}
        </div>

        <pre
          data-testid="export-preview"
          className="bg-gray-950 text-gray-300 font-mono text-xs p-3 rounded overflow-auto max-h-96 border border-gray-800"
        >
          {loading ? 'Loading…' : error ? `Error: ${error}` : content}
        </pre>

        <div className="flex items-center justify-end gap-2 mt-4">
          {copied && <span className="text-green-400 text-xs mr-2">Copied!</span>}
          {copyError && <span className="text-red-400 text-xs mr-2">Copy failed: {copyError}</span>}
          <button
            onClick={handleDownload}
            disabled={!result}
            className="bg-gray-800 border border-gray-700 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded text-sm flex items-center gap-1 disabled:opacity-50"
          >
            <Download size={14} /> Download
          </button>
          <button
            onClick={handleCopy}
            disabled={!result}
            className="bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
          >
            Copy to Clipboard
          </button>
          <button
            onClick={onClose}
            className="bg-gray-800 border border-gray-700 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded text-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

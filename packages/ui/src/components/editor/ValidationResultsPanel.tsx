import { useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import { X, AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { ValidationResult, ValidationIssue } from '@flowaibuilder/shared';

interface ValidationResultsPanelProps {
  result: ValidationResult;
  onClose: () => void;
  getNodePosition?: (nodeId: string) => { x: number; y: number } | null;
}

export function ValidationResultsPanel({ result, onClose, getNodePosition }: ValidationResultsPanelProps) {
  const rf = useReactFlow();

  useEffect(() => {
    if (result.valid && result.issues.length === 0) {
      const t = setTimeout(onClose, 2000);
      return () => clearTimeout(t);
    }
  }, [result, onClose]);

  const errors = result.issues.filter((i) => i.severity === 'error');
  const warnings = result.issues.filter((i) => i.severity === 'warning');

  const panToNode = (nodeId: string) => {
    const pos = getNodePosition?.(nodeId);
    if (pos) {
      rf.setCenter(pos.x, pos.y, { zoom: 1.5, duration: 400 });
    } else {
      // Fallback: try to find in rf nodes
      const node = rf.getNode(nodeId);
      if (node) rf.setCenter(node.position.x, node.position.y, { zoom: 1.5, duration: 400 });
    }
  };

  if (result.valid && result.issues.length === 0) {
    return (
      <div
        data-testid="validation-results-panel"
        className="absolute top-16 right-4 z-50 bg-gray-900 border border-green-500 rounded-lg p-4 max-w-md shadow-xl"
      >
        <div className="flex items-center gap-2 text-green-400">
          <CheckCircle2 size={18} />
          <span className="text-sm font-medium">Workflow is valid</span>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="validation-results-panel"
      className="absolute top-16 right-4 z-50 bg-gray-900 border border-purple-500 rounded-lg p-4 max-w-md shadow-xl max-h-[70vh] overflow-y-auto"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white">
          Validation Results ({errors.length} errors, {warnings.length} warnings)
        </h3>
        <button
          onClick={onClose}
          className="p-1 text-gray-400 hover:text-white rounded hover:bg-gray-800"
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>
      <div data-testid="validation-issues" className="space-y-2">
        {errors.map((issue, i) => (
          <IssueRow key={`e-${i}`} issue={issue} onNodeClick={panToNode} />
        ))}
        {warnings.map((issue, i) => (
          <IssueRow key={`w-${i}`} issue={issue} onNodeClick={panToNode} />
        ))}
      </div>
    </div>
  );
}

interface IssueRowProps {
  issue: ValidationIssue;
  onNodeClick: (nodeId: string) => void;
}

function IssueRow({ issue, onNodeClick }: IssueRowProps) {
  const isError = issue.severity === 'error';
  return (
    <div
      data-testid={`validation-issue-${issue.severity}`}
      className={`p-2 rounded border text-xs ${
        isError ? 'border-red-600 bg-red-950/30 text-red-200' : 'border-yellow-600 bg-yellow-950/30 text-yellow-200'
      }`}
    >
      <div className="flex items-start gap-1.5">
        {isError ? <AlertCircle size={14} className="mt-0.5 shrink-0" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0" />}
        <div className="flex-1">
          <div className="font-mono text-[10px] opacity-70">{issue.code}</div>
          <div>{issue.message}</div>
          {issue.nodeId && (
            <button
              type="button"
              data-testid="validation-node-chip"
              onClick={() => onNodeClick(issue.nodeId!)}
              className="mt-1 inline-block px-1.5 py-0.5 text-[10px] rounded bg-gray-800 border border-gray-700 hover:bg-gray-700 font-mono"
            >
              {issue.nodeId}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

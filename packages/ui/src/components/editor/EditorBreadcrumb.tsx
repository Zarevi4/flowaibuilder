import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useWorkflowStore } from '../../store/workflow';
import { useReviewStore } from '../../store/review';

const envBadgeClass: Record<string, string> = {
  dev: 'bg-gray-700 text-gray-300',
  staging: 'bg-amber-500/20 text-amber-300',
  prod: 'bg-green-500/20 text-green-400',
};

function healthClass(score: number): string {
  if (score >= 90) return 'bg-green-500/20 text-green-400';
  if (score >= 70) return 'bg-amber-500/20 text-amber-300';
  if (score >= 50) return 'bg-orange-500/20 text-orange-300';
  return 'bg-red-500/20 text-red-400';
}

export function EditorBreadcrumb() {
  const workflow = useWorkflowStore((s) => s.workflow);
  const healthScore = useReviewStore((s) => s.healthScore);
  const annotations = useReviewStore((s) => s.annotations);
  const togglePanel = useReviewStore((s) => s.togglePanel);

  const counts = useMemo(() => {
    let errors = 0, warnings = 0, suggestions = 0;
    for (const a of annotations) {
      if (a.status !== 'active') continue;
      if (a.severity === 'error') errors++;
      else if (a.severity === 'warning') warnings++;
      else suggestions++;
    }
    return { errors, warnings, suggestions, total: errors + warnings + suggestions };
  }, [annotations]);

  if (!workflow) return null;

  const environment = workflow.environment ?? 'dev';
  const envClass = envBadgeClass[environment] ?? envBadgeClass.dev;

  const score = healthScore;

  return (
    <div className="flex items-center gap-2">
      <Link to="/" className="text-gray-400 hover:text-white text-sm flex items-center gap-1">
        <ArrowLeft size={14} />
        Workflows
      </Link>
      <span className="text-gray-600 text-sm">/</span>
      <span className="text-white text-sm font-medium" data-testid="wf-name">{workflow.name}</span>
      <span
        data-testid="env-badge"
        className={`px-2 py-0.5 rounded text-xs font-medium ${envClass}`}
      >
        {environment}
      </span>
      <span
        data-testid="health-pill"
        className={`px-2 py-0.5 rounded text-xs font-medium ${
          typeof score === 'number' ? healthClass(score) : 'bg-gray-800 text-gray-500'
        }`}
      >
        {typeof score === 'number' ? score : '—'}
      </span>
      {counts.total > 0 && (
        <button
          type="button"
          data-testid="annotation-counter"
          onClick={togglePanel}
          title={`${counts.total} active annotations (${counts.errors} errors, ${counts.warnings} warnings, ${counts.suggestions} suggestions)`}
          className="px-2 py-0.5 rounded text-xs font-medium bg-purple-500/20 text-purple-300 hover:bg-purple-500/30"
        >
          {counts.total}
        </button>
      )}
    </div>
  );
}

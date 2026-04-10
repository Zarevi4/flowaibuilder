import { useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Play, Loader2, CheckCircle, XCircle, X, Ban, Braces, History, Download, Sparkles, ShieldCheck, Upload } from 'lucide-react';
import { AddNodeDropdown } from './AddNodeDropdown';
import { ExportDialog } from '../editor/ExportDialog';
import { ValidationResultsPanel } from '../editor/ValidationResultsPanel';
import { useWorkflowStore } from '../../store/workflow';
import { useExecutionStore } from '../../store/execution';
import { useUiStore } from '../../store/ui';
import {
  executeWorkflow,
  requestReview,
  activateWorkflow,
  updateWorkflow,
  validateWorkflow as apiValidateWorkflow,
  importN8nWorkflow as apiImportN8nWorkflow,
} from '../../lib/api';
import type { ValidationResult } from '@flowaibuilder/shared';

interface CanvasToolbarProps {
  className?: string;
}

export function CanvasToolbar({ className }: CanvasToolbarProps) {
  const navigate = useNavigate();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [validatePending, setValidatePending] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importPending, setImportPending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [reviewStatus, setReviewStatus] = useState<string | null>(null);
  const [reviewPending, setReviewPending] = useState(false);
  const isSubmitting = useRef(false);
  const isReviewSubmitting = useRef(false);
  const addNode = useWorkflowStore((s) => s.addNode);
  const workflow = useWorkflowStore((s) => s.workflow);
  const workflowId = workflow?.id ?? null;
  const continuousReviewEnabled =
    (workflow?.settings as Record<string, unknown> | undefined)?.continuousReviewEnabled === true;
  const isActive = workflow?.active === true;
  const [activateDialog, setActivateDialog] = useState<{ healthScore: number | null; warning: string } | null>(null);
  const [activatePending, setActivatePending] = useState(false);

  const handleToggleContinuous = useCallback(async () => {
    if (!workflow) return;
    const next = !continuousReviewEnabled;
    const nextSettings = { ...(workflow.settings ?? {}), continuousReviewEnabled: next };
    // Optimistic update
    useWorkflowStore.setState({ workflow: { ...workflow, settings: nextSettings } });
    try {
      await updateWorkflow(workflow.id, { settings: nextSettings });
    } catch (err) {
      // Revert
      useWorkflowStore.setState({ workflow });
      // eslint-disable-next-line no-console
      console.warn('[continuous-review] toggle failed:', err);
    }
  }, [workflow, continuousReviewEnabled]);

  const performActivate = useCallback(
    async (force: boolean) => {
      if (!workflow) return;
      setActivatePending(true);
      try {
        const res = await activateWorkflow(workflow.id, force ? { force: true } : {});
        if (res.requiresConfirmation) {
          setActivateDialog({ healthScore: res.healthScore, warning: res.warning ?? 'Health score is low.' });
        } else if (res.activated) {
          useWorkflowStore.setState({ workflow: { ...workflow, active: true } });
          setActivateDialog(null);
        } else {
          setReviewStatus(res.warning ?? 'Activate failed');
          setTimeout(() => setReviewStatus(null), 3000);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[activate] failed:', err);
      } finally {
        setActivatePending(false);
      }
    },
    [workflow],
  );

  const handleActivateClick = useCallback(async () => {
    if (!workflow) return;
    if (isActive) {
      // Deactivate via standard PUT — no review gate
      try {
        await updateWorkflow(workflow.id, { active: false });
        useWorkflowStore.setState({ workflow: { ...workflow, active: false } });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[deactivate] failed:', err);
      }
      return;
    }
    await performActivate(false);
  }, [workflow, isActive, performActivate]);

  const jsonPanelOpen = useUiStore((s) => s.jsonPanelOpen);
  const toggleJsonPanel = useUiStore((s) => s.toggleJsonPanel);

  const executionStatus = useExecutionStore((s) => s.status);
  const durationMs = useExecutionStore((s) => s.durationMs);
  const clearExecution = useExecutionStore((s) => s.clearExecution);

  const isRunning = executionStatus === 'running';
  const isDisabled = isRunning || !workflowId;

  const handleSelect = useCallback(
    async (type: string, name: string) => {
      await addNode(type, name);
    },
    [addNode],
  );

  const handleValidate = useCallback(async () => {
    if (!workflowId || validatePending) return;
    setValidatePending(true);
    try {
      const result = await apiValidateWorkflow(workflowId);
      setValidationResult(result);
    } catch (err) {
      setValidationResult({
        valid: false,
        issues: [{
          severity: 'error',
          code: 'missing-required-config',
          message: err instanceof Error ? err.message : 'Validation failed',
        }],
      });
    } finally {
      setValidatePending(false);
    }
  }, [workflowId, validatePending]);

  const handleImportFile = useCallback(async (file: File) => {
    setImportPending(true);
    setImportStatus(null);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const result = await apiImportN8nWorkflow(json);
      const warnMsg =
        result.warnings.length > 0
          ? ` (${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'})`
          : '';
      setImportStatus(`Imported "${result.workflow.name}"${warnMsg}`);
      setTimeout(() => setImportStatus(null), 4000);
      navigate(`/editor/${result.workflow.id}`);
    } catch (err) {
      setImportStatus(err instanceof Error ? err.message : 'Import failed');
      setTimeout(() => setImportStatus(null), 4000);
    } finally {
      setImportPending(false);
    }
  }, [navigate]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void handleImportFile(file);
      e.target.value = '';
    },
    [handleImportFile],
  );

  const handleRun = useCallback(async () => {
    if (!workflowId || isRunning || isSubmitting.current) return;
    isSubmitting.current = true;
    try {
      const execution = await executeWorkflow(workflowId);
      // Fill in full node execution data (input/output/error) from REST response
      useExecutionStore.getState().setFullExecutionData(execution.id, execution.nodeExecutions);
    } catch (err) {
      // Clean up stuck execution state if WS execution_started already fired
      const execStore = useExecutionStore.getState();
      if (execStore.status === 'running') {
        execStore.clearExecution();
      }
      useExecutionStore.setState({
        error: err instanceof Error ? err.message : 'Failed to execute workflow',
      });
    } finally {
      isSubmitting.current = false;
    }
  }, [workflowId, isRunning]);

  const handleRequestReview = useCallback(async () => {
    if (!workflowId || isReviewSubmitting.current) return;
    isReviewSubmitting.current = true;
    setReviewPending(true);
    try {
      const { prompt } = await requestReview(workflowId);
      // In non-secure contexts (http://) `navigator.clipboard` is undefined and
      // the optional chain returns undefined instead of throwing, so the catch
      // below never runs. Check presence explicitly and only report success
      // once writeText actually resolves.
      const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
      if (clipboard && typeof clipboard.writeText === 'function') {
        try {
          await clipboard.writeText(prompt);
          setReviewStatus('Review requested — paste prompt into Claude Code');
        } catch {
          setReviewStatus('Review requested — copy prompt from console');
          // eslint-disable-next-line no-console
          console.info('[flowAIbuilder] AI Review prompt:', prompt);
        }
      } else {
        setReviewStatus('Review requested — copy prompt from console');
        // eslint-disable-next-line no-console
        console.info('[flowAIbuilder] AI Review prompt:', prompt);
      }
      setTimeout(() => setReviewStatus(null), 3000);
    } catch (err) {
      setReviewStatus(err instanceof Error ? err.message : 'Failed to request review');
      setTimeout(() => setReviewStatus(null), 3000);
    } finally {
      isReviewSubmitting.current = false;
      setReviewPending(false);
    }
  }, [workflowId]);

  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      {/* Add Node */}
      <div className="relative">
        <button
          onClick={() => setDropdownOpen((prev) => !prev)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
        >
          <Plus size={16} />
          Add Node
        </button>
        {dropdownOpen && (
          <AddNodeDropdown
            onSelect={handleSelect}
            onClose={() => setDropdownOpen(false)}
          />
        )}
      </div>

      {/* JSON toggle */}
      <button
        onClick={toggleJsonPanel}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors ${
          jsonPanelOpen
            ? 'bg-purple-600 border-purple-500 text-white'
            : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700 hover:text-white'
        }`}
        title="Toggle JSON view"
      >
        <Braces size={16} />
        JSON
      </button>

      {/* Export */}
      <button
        onClick={() => setExportOpen(true)}
        disabled={!workflowId}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        title="Export workflow"
      >
        <Download size={16} />
        Export
      </button>
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />

      {/* Validate */}
      <button
        onClick={handleValidate}
        disabled={!workflowId || validatePending}
        data-testid="validate-button"
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        title="Validate workflow"
      >
        {validatePending ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
        Validate
      </button>
      {validationResult && (
        <ValidationResultsPanel
          result={validationResult}
          onClose={() => setValidationResult(null)}
          getNodePosition={(nodeId) => {
            const n = workflow?.nodes.find((x) => x.id === nodeId);
            return n ? { x: n.position.x, y: n.position.y } : null;
          }}
        />
      )}

      {/* Import n8n */}
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={importPending}
        data-testid="import-n8n-button"
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        title="Import n8n workflow JSON"
      >
        {importPending ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
        Import n8n
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        data-testid="import-n8n-input"
        onChange={handleFileChange}
        className="hidden"
      />
      {importStatus && (
        <span data-testid="import-n8n-status" className="text-xs text-purple-300">
          {importStatus}
        </span>
      )}

      {/* AI Review */}
      <button
        onClick={handleRequestReview}
        disabled={!workflowId || reviewPending}
        data-testid="ai-review-button"
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        title="Request AI review from Claude Code"
      >
        {reviewPending ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
        AI Review
      </button>
      {reviewStatus && (
        <span data-testid="ai-review-status" className="text-xs text-purple-300">
          {reviewStatus}
        </span>
      )}

      {/* Continuous review toggle (per-workflow) */}
      <label className="flex items-center gap-1.5 text-xs text-gray-300">
        <input
          type="checkbox"
          data-testid="continuous-review-toggle"
          checked={continuousReviewEnabled}
          disabled={!workflowId}
          onChange={handleToggleContinuous}
          className="accent-purple-600"
        />
        Continuous review
      </label>

      {/* Activate / Deactivate */}
      <button
        onClick={handleActivateClick}
        disabled={!workflowId || activatePending}
        data-testid="activate-button"
        className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors disabled:opacity-50 ${
          isActive
            ? 'bg-green-700 border-green-600 text-white hover:bg-green-800'
            : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
        }`}
        title={isActive ? 'Deactivate workflow' : 'Activate workflow'}
      >
        {isActive ? 'Deactivate' : 'Activate'}
      </button>
      {activateDialog && (
        <div
          role="dialog"
          aria-modal="true"
          data-testid="activate-confirm-dialog"
          className="absolute top-16 right-4 z-50 bg-gray-900 border border-purple-500 rounded-lg p-4 max-w-sm shadow-xl"
        >
          <p className="text-sm text-yellow-300 mb-3">{activateDialog.warning}</p>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setActivateDialog(null)}
              className="px-3 py-1 text-xs rounded bg-gray-800 text-gray-300 hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              onClick={() => performActivate(true)}
              data-testid="activate-anyway-button"
              className="px-3 py-1 text-xs rounded bg-purple-600 text-white hover:bg-purple-700"
            >
              Activate anyway
            </button>
          </div>
        </div>
      )}

      {/* Executions */}
      <button
        onClick={() => workflowId && navigate(`/editor/${workflowId}/executions`)}
        disabled={!workflowId}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        title="View execution history"
      >
        <History size={16} />
        Executions
      </button>

      {/* Run button */}
      <button
        onClick={handleRun}
        disabled={isDisabled}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors ${
          isDisabled
            ? 'bg-gray-800 border-gray-700 text-gray-500 opacity-50 cursor-not-allowed'
            : 'bg-purple-600 border-purple-500 text-white hover:bg-purple-700'
        }`}
      >
        {isRunning ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
        Run
      </button>

      {/* Execution status indicator */}
      {executionStatus && executionStatus !== 'running' && (
        <div className="flex items-center gap-1.5">
          <span
            className={`flex items-center gap-1 text-sm ${
              executionStatus === 'success'
                ? 'text-green-400'
                : executionStatus === 'cancelled'
                  ? 'text-gray-400'
                  : 'text-red-400'
            }`}
          >
            {executionStatus === 'success' ? (
              <CheckCircle size={16} />
            ) : executionStatus === 'cancelled' ? (
              <Ban size={16} />
            ) : (
              <XCircle size={16} />
            )}
            {durationMs != null ? `${(durationMs / 1000).toFixed(1)}s` : ''}
          </span>
          <button
            onClick={clearExecution}
            className="p-1 text-gray-400 hover:text-white rounded hover:bg-gray-800"
            title="Clear execution results"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Canvas } from '../components/canvas/Canvas';
import { CanvasToolbar } from '../components/toolbar/CanvasToolbar';
import { NodeConfigSidebar } from '../components/sidebar/NodeConfigSidebar';
import { JsonPanel } from '../components/editor/JsonPanel';
import { EditorBreadcrumb } from '../components/editor/EditorBreadcrumb';
import { VersionsPanel } from '../components/versions/VersionsPanel';
import { useWorkflowStore, cancelPendingSaves } from '../store/workflow';
import { useUiStore } from '../store/ui';
import { useWsStore } from '../store/ws';
import { useReviewStore } from '../store/review';
import { getCurrentUser, promoteWorkflow, type CurrentUser } from '../lib/api';

export function Editor() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const loadWorkflow = useWorkflowStore((s) => s.loadWorkflow);
  const loadTaskLinks = useWorkflowStore((s) => s.loadTaskLinks);
  const loading = useWorkflowStore((s) => s.loading);
  const error = useWorkflowStore((s) => s.error);
  const workflow = useWorkflowStore((s) => s.workflow);
  const selectedNodeId = useUiStore((s) => s.selectedNodeId);
  const jsonPanelOpen = useUiStore((s) => s.jsonPanelOpen);
  const toggleJsonPanel = useUiStore((s) => s.toggleJsonPanel);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [envDropdownOpen, setEnvDropdownOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  useEffect(() => {
    let cancelled = false;
    getCurrentUser().then((u) => { if (!cancelled) setCurrentUser(u); });
    return () => { cancelled = true; };
  }, []);
  const wsStatus = useWsStore((s) => s.status);
  const wsConnect = useWsStore((s) => s.connect);
  const wsDisconnect = useWsStore((s) => s.disconnect);

  useEffect(() => {
    let cancelled = false;
    if (workflowId) {
      loadWorkflow(workflowId).then(() => {
        // Only connect WS if load succeeded and component is still mounted
        if (!cancelled && !useWorkflowStore.getState().error) {
          wsConnect(workflowId);
          loadTaskLinks(workflowId);
          void useReviewStore.getState().loadForWorkflow(workflowId);
        }
      });
    }
    return () => {
      cancelled = true;
      cancelPendingSaves(); // P10: prevent stale debounced writes after unmount
      useUiStore.getState().selectNode(null); // Clear sidebar on navigation
      wsDisconnect();
      useReviewStore.getState().clear();
    };
  }, [workflowId, loadWorkflow, loadTaskLinks, wsConnect, wsDisconnect]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-950">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-gray-400 text-sm">Loading workflow…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-950">
        <div className="text-center">
          <div className="text-red-400 text-lg font-medium mb-2">Error loading workflow</div>
          <div className="text-gray-500 text-sm">{error}</div>
        </div>
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-950">
        <span className="text-gray-500 text-sm">No workflow selected</span>
      </div>
    );
  }

  const envColors: Record<string, string> = {
    dev: 'bg-blue-600',
    staging: 'bg-yellow-600',
    prod: 'bg-green-600',
  };
  const currentEnv = workflow.environment ?? 'dev';
  const isEditor = currentUser?.role === 'editor' || currentUser?.role === 'admin';

  const handlePromote = async (env: string) => {
    if (!workflowId || env === currentEnv) return;
    setEnvDropdownOpen(false);
    try {
      await promoteWorkflow(workflowId, env);
      loadWorkflow(workflowId);
    } catch {
      // promotion failed — UI will show stale env but next load will correct
    }
  };

  const statusColor =
    wsStatus === 'connected' ? 'bg-green-500' :
    wsStatus === 'connecting' ? 'bg-yellow-500' :
    'bg-red-500';

  const statusLabel =
    wsStatus === 'connected' ? 'Live' :
    wsStatus === 'connecting' ? 'Connecting…' :
    'Disconnected';

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="h-9 flex items-center border-b border-gray-800 bg-gray-900 px-3 gap-2">
        <EditorBreadcrumb />
        <div className="relative">
          <button
            onClick={() => isEditor && setEnvDropdownOpen((o) => !o)}
            className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${envColors[currentEnv] ?? 'bg-gray-600'} text-white ${isEditor ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
            title={isEditor ? 'Click to promote' : currentEnv}
          >
            {currentEnv}
          </button>
          {envDropdownOpen && (
            <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-700 rounded shadow-lg z-30 min-w-[100px]">
              {['dev', 'staging', 'prod'].filter((e) => e !== currentEnv).map((env) => (
                <button
                  key={env}
                  onClick={() => handlePromote(env)}
                  className="block w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 hover:text-white"
                >
                  Promote to {env}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="flex-1 flex">
        <div className="flex-1 relative">
          <Canvas />
          <CanvasToolbar className="absolute top-2 left-2 z-10" />
          <div className="absolute top-2 right-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setVersionsOpen((v) => !v)}
              className="bg-gray-900/80 border border-gray-700 rounded-full px-2.5 py-1 text-xs text-gray-400 hover:text-gray-200"
              title="Workflow versions"
            >
              Versions
            </button>
            <div className="flex items-center gap-1.5 bg-gray-900/80 border border-gray-700 rounded-full px-2.5 py-1 text-xs text-gray-400">
              <span className={`w-2 h-2 rounded-full ${statusColor}`} />
              {statusLabel}
            </div>
          </div>
          {versionsOpen && workflowId && (
            <div className="absolute top-12 right-2 z-20 bg-white text-gray-900 border border-gray-300 rounded shadow-xl">
              <VersionsPanel workflowId={workflowId} role={currentUser?.role} onClose={() => setVersionsOpen(false)} />
            </div>
          )}
        </div>
        {selectedNodeId && !jsonPanelOpen && <NodeConfigSidebar />}
        {jsonPanelOpen && <JsonPanel onClose={toggleJsonPanel} />}
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Copy, Check, Save, AlertTriangle } from 'lucide-react';
import type { WorkflowNode, Connection } from '@flowaibuilder/shared';
import { useWorkflowStore } from '../../store/workflow';
import { useUiStore } from '../../store/ui';
import { useExecutionStore } from '../../store/execution';
import { updateWorkflow } from '../../lib/api';

type Tab = 'workflow' | 'node' | 'input' | 'output';

interface JsonPanelProps {
  onClose: () => void;
}

function JsonBlock({
  value,
  editable,
  onChange,
  onSave,
}: {
  value: string;
  editable?: boolean;
  onChange?: (v: string) => void;
  onSave?: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's' && onSave) {
      e.preventDefault();
      onSave();
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = ref.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newText = value.substring(0, start) + '  ' + value.substring(end);
      onChange?.(newText);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  };

  return (
    <textarea
      ref={ref}
      value={value}
      readOnly={!editable}
      onChange={editable ? (e) => onChange?.(e.target.value) : undefined}
      onKeyDown={editable ? handleKeyDown : undefined}
      spellCheck={false}
      className={`flex-1 bg-gray-950 text-xs font-mono p-3 resize-none outline-none leading-5 overflow-auto ${
        editable ? 'text-gray-300' : 'text-gray-500'
      }`}
      style={{ tabSize: 2 }}
    />
  );
}

export function JsonPanel({ onClose }: JsonPanelProps) {
  const workflow = useWorkflowStore((s) => s.workflow);
  const loadWorkflow = useWorkflowStore((s) => s.loadWorkflow);
  const selectedNodeId = useUiStore((s) => s.selectedNodeId);
  const nodeStatuses = useExecutionStore((s) => s.nodeStatuses);

  const [activeTab, setActiveTab] = useState<Tab>('workflow');
  const [wfText, setWfText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  // Auto-switch to node tab when a node is selected
  useEffect(() => {
    if (selectedNodeId) {
      setActiveTab('node');
    }
  }, [selectedNodeId]);

  // Build full workflow JSON
  const buildWorkflowJson = useCallback(() => {
    if (!workflow) return '';
    const obj = {
      name: workflow.name,
      description: workflow.description,
      nodes: (workflow.nodes ?? []).map((n) => ({
        id: n.id,
        type: n.type,
        name: n.name,
        position: n.position,
        config: n.data?.config ?? {},
        disabled: n.disabled,
      })),
      connections: (workflow.connections ?? []).map((c) => ({
        id: c.id,
        source: c.sourceNodeId,
        target: c.targetNodeId,
        sourceHandle: c.sourceHandle,
        targetHandle: c.targetHandle,
      })),
    };
    return JSON.stringify(obj, null, 2);
  }, [workflow]);

  // Sync workflow text when workflow changes (and not dirty)
  useEffect(() => {
    if (!dirty) {
      setWfText(buildWorkflowJson());
      setError(null);
    }
  }, [buildWorkflowJson, dirty]);

  // Selected node data
  const selectedNode = workflow?.nodes?.find((n) => n.id === selectedNodeId) ?? null;
  const nodeExec = selectedNodeId ? nodeStatuses[selectedNodeId] : null;

  const nodeJson = selectedNode
    ? JSON.stringify(
        {
          id: selectedNode.id,
          type: selectedNode.type,
          name: selectedNode.name,
          position: selectedNode.position,
          config: selectedNode.data?.config ?? {},
          disabled: selectedNode.disabled,
        },
        null,
        2,
      )
    : '// Click a node on the canvas';

  const inputJson = nodeExec?.input
    ? JSON.stringify(nodeExec.input, null, 2)
    : selectedNode
      ? '// Run the workflow first, then select this node\n// to see what data it received'
      : '// No node selected';

  const outputJson = nodeExec?.output
    ? JSON.stringify(nodeExec.output, null, 2)
    : nodeExec?.error
      ? JSON.stringify({ error: nodeExec.error }, null, 2)
      : selectedNode
        ? '// Run the workflow first, then select this node\n// to see what data it produced'
        : '// No node selected';

  // Current display text
  const displayText =
    activeTab === 'workflow'
      ? wfText
      : activeTab === 'node'
        ? nodeJson
        : activeTab === 'input'
          ? inputJson
          : outputJson;

  const isEditable = activeTab === 'workflow';

  const handleWfChange = (value: string) => {
    setWfText(value);
    setDirty(true);
    setError(null);
    try {
      JSON.parse(value);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleSave = async () => {
    if (!workflow || !dirty) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(wfText);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const nodes: WorkflowNode[] = (
        (parsed.nodes ?? []) as Array<Record<string, unknown>>
      ).map((n) => ({
        id: n.id as string,
        type: n.type as WorkflowNode['type'],
        name: n.name as string,
        position: n.position as { x: number; y: number },
        data: {
          label: n.name as string,
          config: (n.config ?? {}) as Record<string, unknown>,
        },
        disabled: n.disabled as boolean | undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
      const connections: Connection[] = (
        (parsed.connections ?? []) as Array<Record<string, unknown>>
      ).map((c) => ({
        id: c.id as string,
        sourceNodeId: c.source as string,
        targetNodeId: c.target as string,
        sourceHandle: c.sourceHandle as string | undefined,
        targetHandle: c.targetHandle as string | undefined,
      }));
      await updateWorkflow(workflow.id, {
        name: (parsed.name as string) ?? workflow.name,
        description: (parsed.description as string) ?? workflow.description,
        nodes,
        connections,
      });
      await loadWorkflow(workflow.id);
      setDirty(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(displayText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const tabs: { key: Tab; label: string; badge?: string }[] = [
    { key: 'workflow', label: 'Workflow', badge: dirty ? '*' : undefined },
    {
      key: 'node',
      label: selectedNode ? selectedNode.name : 'Node',
      badge: nodeExec?.status === 'success' ? '✓' : nodeExec?.status === 'error' ? '✗' : undefined,
    },
    {
      key: 'input',
      label: 'Input',
      badge: nodeExec?.input ? '●' : undefined,
    },
    {
      key: 'output',
      label: 'Output',
      badge: nodeExec?.output ? '●' : nodeExec?.error ? '!' : undefined,
    },
  ];

  return (
    <div className="w-120 border-l border-gray-800 bg-gray-950 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 bg-gray-900">
        <span className="text-white text-sm font-medium">JSON</span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleCopy}
            className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-gray-800"
            title="Copy JSON"
          >
            {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
          </button>
          {activeTab === 'workflow' && (
            <button
              onClick={handleSave}
              disabled={!dirty || !!error || saving}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Save (Cmd+S)"
            >
              <Save size={12} />
              Save
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-gray-800"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800 bg-gray-900/50">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs border-b-2 transition-colors truncate max-w-32 ${
              activeTab === tab.key
                ? 'border-purple-500 text-white'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            <span className="truncate">{tab.label}</span>
            {tab.badge && (
              <span
                className={`text-[10px] ${
                  tab.badge === '✓'
                    ? 'text-green-400'
                    : tab.badge === '✗' || tab.badge === '!'
                      ? 'text-red-400'
                      : tab.badge === '●'
                        ? 'text-blue-400'
                        : 'text-yellow-400'
                }`}
              >
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Error bar */}
      {error && activeTab === 'workflow' && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-900/30 border-b border-red-800 text-red-400 text-xs">
          <AlertTriangle size={12} />
          <span className="truncate">{error}</span>
        </div>
      )}

      {/* JSON content */}
      <JsonBlock
        value={displayText}
        editable={isEditable}
        onChange={isEditable ? handleWfChange : undefined}
        onSave={isEditable ? handleSave : undefined}
      />
    </div>
  );
}

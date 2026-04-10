import type { Workflow, NodeType } from './workflow.js';

export interface N8nImportWarning {
  n8nNodeName: string;
  n8nType: string;
  mappedTo: NodeType;
  reason: string;
}

export interface N8nImportResult {
  workflow: Workflow;
  warnings: N8nImportWarning[];
}

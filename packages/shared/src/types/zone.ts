export interface ProtectedZone {
  id: string;
  workflowId: string;
  name: string;
  nodeIds: string[];
  color?: string;
  pinnedBy: string;
  pinnedAt: string;
  reason?: string;
  canUnpin?: string[];
}

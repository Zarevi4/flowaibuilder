export interface AuditEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  changes?: { before?: unknown; after?: unknown };
  metadata?: { ip?: string; userAgent?: string; mcpTool?: string; [key: string]: unknown };
}

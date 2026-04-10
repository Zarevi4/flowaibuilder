import type {
  Workflow, Execution, TeamSnapshot, InboxMessage, TeamTemplate,
  InstanceSettings, AuditLogEntry, Annotation, ReviewScores, ProtectedZone,
  ExportFormat, ExportResult, ValidationResult, N8nImportWarning,
  WorkflowVersionMeta, WorkflowDiff, WorkflowSnapshot,
  Credential, CredentialType,
} from '@flowaibuilder/shared';

export interface HealthPayload {
  healthScore: number | null;
  scores: ReviewScores | null;
  summary: string | null;
  reviewId: string | null;
  reviewType: string | null;
  annotationCount: number;
  createdAt: string | null;
}

const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const defaultHeaders: Record<string, string> = {};
  if (options?.body) {
    defaultHeaders['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${BASE}${path}`, {
    // Explicitly include cookies for the same-origin session — relying on
    // the fetch default is fragile in non-same-origin dev proxies.
    credentials: 'same-origin',
    ...options,
    headers: { ...defaultHeaders, ...(options?.headers as Record<string, string>) },
  });
  if (!res.ok) {
    let serverMessage: string | null = null;
    try {
      const body = await res.clone().json();
      if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
        serverMessage = (body as { error: string }).error;
      }
    } catch {
      // body wasn't JSON — ignore
    }
    throw new Error(serverMessage ?? `API ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

export async function getWorkflow(id: string): Promise<Workflow> {
  return request<Workflow>(`/workflows/${id}`);
}

export async function listWorkflows(): Promise<{ workflows: Workflow[] }> {
  return request<{ workflows: Workflow[] }>('/workflows');
}

export async function updateWorkflow(
  id: string,
  data: Partial<Workflow>,
): Promise<Workflow> {
  return request<Workflow>(`/workflows/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function addNode(
  workflowId: string,
  body: { type: string; name: string; config?: Record<string, unknown> },
): Promise<{ node: import('@flowaibuilder/shared').WorkflowNode; position: { x: number; y: number } }> {
  return request(`/workflows/${workflowId}/nodes`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function deleteNode(
  workflowId: string,
  nodeId: string,
): Promise<{ removed: boolean; node_id: string }> {
  return request(`/workflows/${workflowId}/nodes/${nodeId}`, {
    method: 'DELETE',
  });
}

export async function addConnection(
  workflowId: string,
  body: { sourceNodeId: string; targetNodeId: string; sourceHandle?: string; targetHandle?: string },
): Promise<{ connection: import('@flowaibuilder/shared').Connection }> {
  return request(`/workflows/${workflowId}/connections`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function deleteConnection(
  workflowId: string,
  connectionId: string,
): Promise<{ removed: boolean; connection_id: string }> {
  return request(`/workflows/${workflowId}/connections/${connectionId}`, {
    method: 'DELETE',
  });
}

export async function updateNode(
  workflowId: string,
  nodeId: string,
  changes: { name?: string; config?: Record<string, unknown>; disabled?: boolean },
): Promise<{ updated: boolean; node_id: string }> {
  return request<{ updated: boolean; node_id: string }>(`/workflows/${workflowId}/nodes/${nodeId}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  });
}

export async function createWorkflow(name: string, description?: string): Promise<Workflow> {
  return request<Workflow>('/workflows', {
    method: 'POST',
    body: JSON.stringify({ name, description }),
  });
}

export async function deleteWorkflow(id: string): Promise<{ deleted: boolean; id: string }> {
  return request<{ deleted: boolean; id: string }>(`/workflows/${id}`, {
    method: 'DELETE',
  });
}

export async function executeWorkflow(workflowId: string): Promise<Execution> {
  return request<Execution>(`/workflows/${workflowId}/execute`, { method: 'POST' });
}

export async function listExecutions(workflowId: string): Promise<{ executions: Execution[] }> {
  return request<{ executions: Execution[] }>(`/workflows/${workflowId}/executions`);
}

export async function getExecution(workflowId: string, executionId: string): Promise<Execution> {
  return request<Execution>(`/workflows/${workflowId}/executions/${executionId}`);
}

// Task Links
export interface TaskLinkInfo {
  taskId: string;
  nodeId: string;
  teamName: string;
  assignee: string | null;
  taskStatus: string;
  taskTitle: string;
}

export async function getTaskLinks(workflowId: string): Promise<{ links: TaskLinkInfo[] }> {
  return request<{ links: TaskLinkInfo[] }>(`/workflows/${encodeURIComponent(workflowId)}/task-links`);
}

// Agent Teams
export async function listTeams(): Promise<{ teams: string[] }> {
  return request<{ teams: string[] }>('/teams');
}

export async function getTeamSnapshot(teamName: string): Promise<TeamSnapshot> {
  return request<TeamSnapshot>(`/teams/${encodeURIComponent(teamName)}`);
}

export async function getTeamMessages(teamName: string): Promise<{ messages: (InboxMessage & { to: string })[] }> {
  return request<{ messages: (InboxMessage & { to: string })[] }>(`/teams/${encodeURIComponent(teamName)}/messages`);
}

export async function listTemplates(): Promise<{ templates: TeamTemplate[] }> {
  return request<{ templates: TeamTemplate[] }>('/teams/templates');
}

export async function watchTeam(teamName: string): Promise<TeamSnapshot> {
  return request<TeamSnapshot>(`/teams/${encodeURIComponent(teamName)}/watch`, {
    method: 'POST',
  });
}

export async function launchTeam(templateId: string, teamName: string): Promise<TeamSnapshot> {
  return request<TeamSnapshot>('/teams/launch', {
    method: 'POST',
    body: JSON.stringify({ templateId, teamName }),
  });
}

// Instance Settings
export async function getSettings(): Promise<InstanceSettings> {
  return request<InstanceSettings>('/settings');
}

export async function updateSettings(patch: Partial<InstanceSettings>): Promise<InstanceSettings> {
  return request<InstanceSettings>('/settings', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

// Review / Annotations
export async function getAnnotations(workflowId: string): Promise<{ annotations: Annotation[] }> {
  return request<{ annotations: Annotation[] }>(`/workflows/${workflowId}/annotations`);
}

export async function getHealth(workflowId: string): Promise<HealthPayload> {
  return request<HealthPayload>(`/workflows/${workflowId}/health`);
}

export async function applyAnnotationFix(
  workflowId: string,
  annotationId: string,
): Promise<{ applied: true; annotation_id: string; tool: string; result: unknown }> {
  return request(`/workflows/${workflowId}/annotations/${annotationId}/apply`, {
    method: 'POST',
  });
}

export async function dismissAnnotation(
  workflowId: string,
  annotationId: string,
  reason?: string,
): Promise<{ dismissed: true; annotation_id: string }> {
  return request(`/workflows/${workflowId}/annotations/${annotationId}/dismiss`, {
    method: 'POST',
    body: JSON.stringify({ reason: reason ?? undefined }),
  });
}

export async function requestReview(
  workflowId: string,
  body?: { trigger?: string; context_type?: string },
): Promise<{ prompt: string }> {
  return request<{ prompt: string }>(`/workflows/${workflowId}/review/request`, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  });
}

export interface ActivateWorkflowResult {
  healthScore: number | null;
  requiresConfirmation: boolean;
  warning: string | null;
  activated: boolean;
}

export async function activateWorkflow(
  workflowId: string,
  body?: { force?: boolean },
): Promise<ActivateWorkflowResult> {
  return request<ActivateWorkflowResult>(`/workflows/${workflowId}/activate`, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  });
}

// Protected Zones (Story 3.2)
export async function getZones(workflowId: string): Promise<{ zones: ProtectedZone[] }> {
  return request<{ zones: ProtectedZone[] }>(`/workflows/${workflowId}/zones`);
}

export async function createZone(
  workflowId: string,
  body: { name: string; nodeIds: string[]; color?: string; reason?: string },
): Promise<{ zone: ProtectedZone }> {
  return request<{ zone: ProtectedZone }>(`/workflows/${workflowId}/zones`, {
    method: 'POST',
    body: JSON.stringify({
      name: body.name,
      node_ids: body.nodeIds,
      color: body.color,
      reason: body.reason,
    }),
  });
}

export async function renameZone(
  workflowId: string,
  zoneId: string,
  name: string,
): Promise<{ zone: ProtectedZone }> {
  return request<{ zone: ProtectedZone }>(`/workflows/${workflowId}/zones/${zoneId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export async function deleteZone(
  workflowId: string,
  zoneId: string,
): Promise<{ deleted: boolean; zone_id: string }> {
  return request<{ deleted: boolean; zone_id: string }>(`/workflows/${workflowId}/zones/${zoneId}`, {
    method: 'DELETE',
  });
}

export async function addNodesToZone(
  workflowId: string,
  zoneId: string,
  nodeIds: string[],
): Promise<{ zone: ProtectedZone } | { deleted: true; zone_id: string }> {
  return request(`/workflows/${workflowId}/zones/${zoneId}/add`, {
    method: 'POST',
    body: JSON.stringify({ node_ids: nodeIds }),
  });
}

export async function removeNodesFromZone(
  workflowId: string,
  zoneId: string,
  nodeIds: string[],
): Promise<{ zone: ProtectedZone } | { deleted: true; zone_id: string }> {
  return request(`/workflows/${workflowId}/zones/${zoneId}/remove`, {
    method: 'POST',
    body: JSON.stringify({ node_ids: nodeIds }),
  });
}

// Workflow Export (Story 4.1)
export async function exportWorkflow(
  workflowId: string,
  format: ExportFormat,
  signal?: AbortSignal,
): Promise<ExportResult> {
  const res = await fetch(`${BASE}/workflows/${workflowId}/export?format=${format}`, { signal });
  if (!res.ok) {
    let msg: string | null = null;
    try {
      const body = await res.clone().json();
      if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
        msg = (body as { error: string }).error;
      }
    } catch {
      // ignore
    }
    throw new Error(msg ?? `API ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

// Workflow Validation (Story 4.2)
export async function validateWorkflow(workflowId: string): Promise<ValidationResult> {
  return request<ValidationResult>(`/workflows/${workflowId}/validate`, { method: 'POST' });
}

// n8n Import (Story 4.2)
export async function importN8nWorkflow(
  n8nWorkflowJson: unknown,
  opts?: { name?: string; description?: string },
): Promise<{ workflow: Workflow; warnings: N8nImportWarning[] }> {
  return request<{ workflow: Workflow; warnings: N8nImportWarning[] }>(
    '/workflows/import-n8n',
    {
      method: 'POST',
      body: JSON.stringify({
        n8n_workflow_json: n8nWorkflowJson,
        name: opts?.name,
        description: opts?.description,
      }),
    },
  );
}

// Audit Log
export async function listAuditLog(
  filters?: { actor?: string; action?: string; resourceType?: string },
): Promise<{ entries: AuditLogEntry[] }> {
  const params = new URLSearchParams();
  if (filters?.actor) params.set('actor', filters.actor);
  if (filters?.action) params.set('action', filters.action);
  if (filters?.resourceType) params.set('resourceType', filters.resourceType);
  const qs = params.toString();
  return request<{ entries: AuditLogEntry[] }>(`/audit-log${qs ? `?${qs}` : ''}`);
}

// ─── Versioning & Git sync (Story 5.3) ──────────────────────
export async function listVersions(
  workflowId: string,
  limit = 50,
): Promise<{ versions: WorkflowVersionMeta[] }> {
  return request(`/workflows/${workflowId}/versions?limit=${limit}`);
}

export async function getVersion(
  workflowId: string,
  version: number,
): Promise<{
  version: number;
  snapshot: WorkflowSnapshot;
  gitSha: string | null;
  message: string | null;
  createdBy: string;
  createdAt: string | null;
}> {
  return request(`/workflows/${workflowId}/versions/${version}`);
}

export async function diffVersions(
  workflowId: string,
  from: number,
  to: number,
): Promise<WorkflowDiff> {
  return request(`/workflows/${workflowId}/diff?from=${from}&to=${to}`);
}

export async function revertWorkflow(
  workflowId: string,
  version: number,
  message?: string,
): Promise<{ reverted: boolean; version: number }> {
  return request(`/workflows/${workflowId}/revert`, {
    method: 'POST',
    body: JSON.stringify({ version, message }),
  });
}

export interface CurrentUser {
  id: string;
  email: string;
  role: 'admin' | 'editor' | 'viewer';
  name?: string | null;
}

/** Fetch the currently authenticated user. Returns null on 401 so callers
 *  can render unauthenticated UI without a throw. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    const { user } = await request<{ user: CurrentUser }>('/auth/me');
    return user;
  } catch {
    return null;
  }
}

export async function gitPush(
  workflowId: string,
  message: string,
  versionId?: string,
): Promise<{ sha: string; version: number; message: string; file: string }> {
  return request(`/workflows/${workflowId}/git/push`, {
    method: 'POST',
    body: JSON.stringify(versionId ? { message, versionId } : { message }),
  });
}

export async function gitHistory(
  workflowId: string,
): Promise<{ history: WorkflowVersionMeta[] }> {
  return request(`/workflows/${workflowId}/git/history`);
}

export async function getGitSettings(): Promise<InstanceSettings> {
  return request('/settings');
}

export async function updateGitSettings(
  patch: Partial<InstanceSettings>,
): Promise<InstanceSettings> {
  return request('/settings', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

// ─── Secrets (Story 5.4) ──────────────────────────────────────
export async function listSecrets(): Promise<{ secrets: Credential[] }> {
  return request<{ secrets: Credential[] }>('/secrets');
}

export async function createSecret(
  body: { name: string; type: CredentialType; value: string },
): Promise<{ id: string; name: string; type: string; createdAt: string }> {
  return request('/secrets', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function updateSecret(
  id: string,
  body: { value: string },
): Promise<{ id: string; name: string; type: string; updatedAt: string }> {
  return request(`/secrets/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export async function deleteSecret(
  id: string,
): Promise<{ deleted: boolean; id: string }> {
  return request(`/secrets/${id}`, {
    method: 'DELETE',
  });
}

// ─── Queue & Log Streaming (Story 5.5) ──────────────────────
export async function getQueueStatus(): Promise<import('@flowaibuilder/shared').QueueStatus> {
  return request<import('@flowaibuilder/shared').QueueStatus>('/queue/status');
}

export async function updateLogStreamConfig(
  destinations: import('@flowaibuilder/shared').LogDestination[],
): Promise<InstanceSettings> {
  return request<InstanceSettings>('/settings', {
    method: 'PUT',
    body: JSON.stringify({ logStreamDestinations: destinations }),
  });
}

export async function promoteWorkflow(
  workflowId: string,
  environment: string,
): Promise<{ promoted: boolean; from?: string; to?: string; reason?: string }> {
  return request(`/workflows/${workflowId}/promote`, {
    method: 'POST',
    body: JSON.stringify({ environment }),
  });
}

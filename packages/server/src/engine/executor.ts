import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { executions, credentials } from '../db/schema.js';
import { createNodeContext } from './context.js';
import { runNode } from './node-runner.js';
import { getBroadcaster } from '../api/ws/broadcaster.js';
import { decrypt } from '../crypto/aes.js';
import type {
  Workflow,
  WorkflowNode,
  Connection,
  Execution,
  NodeExecutionData,
  ExecutionStatus,
  ExecutionMode,
} from '@flowaibuilder/shared';
import { getLogStreamer } from '../logging/index.js';

export class WorkflowExecutor {
  /**
   * Execute a workflow graph node by node.
   */
  async execute(
    workflow: Workflow,
    triggerData?: unknown,
    mode: ExecutionMode = 'manual',
    triggeredBy: string = 'system',
    existingExecutionId?: string,
  ): Promise<Execution> {
    // 1. Create or reuse execution record
    const startedAt = new Date();
    let execRecord: typeof executions.$inferSelect;

    if (existingExecutionId) {
      // Queue mode: reuse the pre-created execution record
      const [updated] = await db
        .update(executions)
        .set({ status: 'running', workflowVersion: workflow.version, startedAt })
        .where(eq(executions.id, existingExecutionId))
        .returning();
      if (!updated) throw new Error(`Execution record ${existingExecutionId} not found`);
      execRecord = updated;
    } else {
      // Inline mode: create a new execution record
      const [created] = await db
        .insert(executions)
        .values({
          workflowId: workflow.id,
          workflowVersion: workflow.version,
          status: 'running',
          mode,
          triggerData: triggerData ?? null,
          triggeredBy,
          startedAt,
        })
        .returning();
      execRecord = created;
    }

    const nodeExecResults: NodeExecutionData[] = [];
    const nodeOutputs = new Map<string, unknown>();
    const skippedNodes = new Set<string>();
    let executionStatus: ExecutionStatus = 'success';
    let executionError: unknown = null;
    let secrets: Record<string, string> = {};

    // Broadcast execution started
    getBroadcaster()?.broadcastToWorkflow(workflow.id, 'execution_started', {
      execution_id: execRecord.id,
      workflow_id: workflow.id,
      mode,
    });

    // Log streaming: execution started
    try {
      getLogStreamer().emit({
        timestamp: new Date().toISOString(),
        level: 'info',
        event: 'execution_started',
        workflowId: workflow.id,
        executionId: execRecord.id,
        message: `Execution started (mode: ${mode})`,
        data: { mode, triggeredBy },
      });
    } catch { /* log streaming must not break execution */ }

    try {
      // 2. Load secrets (decrypted in-memory only for execution duration)
      secrets = await this.loadSecrets();

      // 3. Topological sort
      const sortedNodes = this.topologicalSort(workflow.nodes, workflow.connections);

      // 4. Execute each node sequentially
      for (let node of sortedNodes) {
        if (node.disabled || skippedNodes.has(node.id)) {
          nodeExecResults.push({
            nodeId: node.id,
            nodeName: node.name,
            nodeType: node.type,
            status: 'cancelled',
          });
          continue;
        }

        // Gather input from connected upstream nodes
        const input = this.gatherInput(node.id, workflow.connections, nodeOutputs, triggerData);

        // Resolve $secrets template expressions in HTTP Request node config.
        // Clone the config first so plaintext secrets never mutate the original node.
        if (node.type === 'http-request' && node.data?.config) {
          const clonedConfig = JSON.parse(JSON.stringify(node.data.config));
          this.resolveSecretsTemplates(clonedConfig, secrets);
          node = { ...node, data: { ...node.data, config: clonedConfig } };
        }

        // Build node context
        const context = createNodeContext({
          input,
          workflow,
          secrets,
        });

        // Log streaming: node started
        try {
          getLogStreamer().emit({
            timestamp: new Date().toISOString(),
            level: 'info',
            event: 'node_started',
            workflowId: workflow.id,
            executionId: execRecord.id,
            nodeId: node.id,
            nodeName: node.name,
            message: `Node "${node.name}" started`,
          });
        } catch { /* log streaming must not break execution */ }

        // Run the node
        const nodeExec = await runNode(node, context);
        nodeExecResults.push(nodeExec);

        // Log streaming: node completed
        try {
          getLogStreamer().emit({
            timestamp: new Date().toISOString(),
            level: nodeExec.status === 'error' ? 'error' : 'info',
            event: nodeExec.status === 'error' ? 'node_error' : 'node_completed',
            workflowId: workflow.id,
            executionId: execRecord.id,
            nodeId: node.id,
            nodeName: node.name,
            message: `Node "${node.name}" ${nodeExec.status} (${nodeExec.duration ?? 0}ms)`,
            data: { status: nodeExec.status, durationMs: nodeExec.duration },
          });
        } catch { /* log streaming must not break execution */ }

        if (nodeExec.status === 'success') {
          nodeOutputs.set(node.id, nodeExec.output);
        }

        // Broadcast node execution result
        getBroadcaster()?.broadcastToWorkflow(workflow.id, 'node_executed', {
          execution_id: execRecord.id,
          node_id: node.id,
          node_name: node.name,
          status: nodeExec.status,
          duration_ms: nodeExec.duration,
        });

        // Handle IF branching
        if (node.type === 'if' && nodeExec.status === 'success') {
          this.handleIfBranching(node, nodeExec.output, workflow.connections, skippedNodes);
        }

        // Stop on error unless retry is configured
        if (nodeExec.status === 'error') {
          if (node.retryOnFail && node.maxRetries && node.maxRetries > 0) {
            // Retry logic
            let retried = false;
            for (let i = 0; i < node.maxRetries; i++) {
              if (node.retryInterval) {
                await new Promise(r => setTimeout(r, node.retryInterval));
              }
              const retryExec = await runNode(node, context);
              if (retryExec.status === 'success') {
                // Replace the failed result
                nodeExecResults[nodeExecResults.length - 1] = retryExec;
                nodeOutputs.set(node.id, retryExec.output);
                retried = true;
                break;
              }
            }
            if (!retried) {
              executionStatus = 'error';
              executionError = { nodeId: node.id, error: nodeExec.error };
              break;
            }
          } else {
            executionStatus = 'error';
            executionError = { nodeId: node.id, error: nodeExec.error };
            break;
          }
        }
      }
    } catch (err) {
      executionStatus = 'error';
      executionError = err instanceof Error ? err.message : String(err);
    }

    // 4. Finalize execution
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();

    // Get the last successful node's output as result
    const lastOutput = nodeExecResults
      .filter(n => n.status === 'success' && n.output != null)
      .pop()?.output;

    // Scrub secret values from results before persisting (defense-in-depth).
    const secretValues = Object.values(secrets);
    const scrubbedNodeExecs = this.scrubSecrets(nodeExecResults, secretValues) as NodeExecutionData[];
    const scrubbedResult = this.scrubSecrets(lastOutput ?? null, secretValues);
    const scrubbedError = this.scrubSecrets(executionError ?? null, secretValues);

    const [updated] = await db
      .update(executions)
      .set({
        status: executionStatus,
        nodeExecutions: scrubbedNodeExecs,
        resultData: scrubbedResult,
        error: scrubbedError ? scrubbedError : null,
        finishedAt,
        durationMs,
      })
      .where(eq(executions.id, execRecord.id))
      .returning();

    // Broadcast execution completed
    getBroadcaster()?.broadcastToWorkflow(workflow.id, 'execution_completed', {
      execution_id: updated.id,
      workflow_id: workflow.id,
      status: executionStatus,
      duration_ms: durationMs,
    });

    // Log streaming: execution completed
    try {
      getLogStreamer().emit({
        timestamp: new Date().toISOString(),
        level: executionStatus === 'error' ? 'error' : 'info',
        event: executionStatus === 'error' ? 'execution_error' : 'execution_completed',
        workflowId: workflow.id,
        executionId: updated.id,
        message: `Execution ${executionStatus} (${durationMs}ms)`,
        data: { status: executionStatus, durationMs },
      });
    } catch { /* log streaming must not break execution */ }

    // Story 2.4 AC#3: post-execution review trigger on failure
    if (executionStatus === 'error') {
      try {
        getBroadcaster()?.broadcast('review_requested', workflow.id, {
          workflow_id: workflow.id,
          trigger: 'post-execution',
          context_type: 'post-execution',
          execution_id: updated.id,
          requested_at: new Date().toISOString(),
        });
      } catch {
        // Fire-and-forget — never block execution result on broadcast failure
      }
    }

    return {
      id: updated.id,
      workflowId: workflow.id,
      workflowVersion: workflow.version ?? 1,
      status: updated.status as ExecutionStatus,
      mode: updated.mode as ExecutionMode,
      triggerData: updated.triggerData,
      resultData: updated.resultData,
      nodeExecutions: nodeExecResults,
      error: updated.error,
      triggeredBy: updated.triggeredBy,
      startedAt: updated.startedAt?.toISOString() ?? startedAt.toISOString(),
      finishedAt: updated.finishedAt?.toISOString() ?? finishedAt.toISOString(),
      durationMs: updated.durationMs ?? durationMs,
    };
  }

  /**
   * Load all secrets from the credentials table, decrypting each value.
   * The returned map exists only for the duration of execution.
   */
  private async loadSecrets(): Promise<Record<string, string>> {
    const secrets: Record<string, string> = {};
    try {
      const rows = await db
        .select({ name: credentials.name, dataEncrypted: credentials.dataEncrypted })
        .from(credentials);
      for (const row of rows) {
        try {
          secrets[row.name] = decrypt(row.dataEncrypted);
        } catch {
          // Skip secrets that fail to decrypt — do not block execution.
        }
      }
    } catch {
      // If credentials table is unavailable, run with empty secrets.
    }
    return secrets;
  }

  /**
   * Resolve {{$secrets.KEY_NAME}} template expressions in HTTP Request
   * node config fields (url, headers, body).
   */
  /**
   * Resolve {{$secrets.KEY_NAME}} template expressions in a config object.
   * The config is expected to be a deep-cloned copy — this method mutates it.
   */
  private resolveSecretsTemplates(
    config: Record<string, unknown>,
    secrets: Record<string, string>,
  ): void {
    const resolve = (val: unknown): unknown => {
      if (typeof val !== 'string') return val;
      return val.replace(/\{\{\$secrets\.([A-Za-z0-9_-]+)\}\}/g, (_match, key: string) => {
        if (key in secrets) return secrets[key];
        throw new Error(
          `Secret '${key}' not found. Check that a secret with this name exists.`,
        );
      });
    };

    if (typeof config.url === 'string') config.url = resolve(config.url);
    if (typeof config.body === 'string') config.body = resolve(config.body);
    if (typeof config.token === 'string') config.token = resolve(config.token);
    if (typeof config.username === 'string') config.username = resolve(config.username);
    if (typeof config.password === 'string') config.password = resolve(config.password);

    if (config.headers && typeof config.headers === 'object') {
      const headers = config.headers as Record<string, string>;
      for (const [k, v] of Object.entries(headers)) {
        if (typeof v === 'string') {
          headers[k] = resolve(v) as string;
        }
      }
    }
  }

  /**
   * Scrub known secret values from execution results before persisting.
   * Defense-in-depth: prevents Code nodes from leaking secrets via return values.
   */
  private scrubSecrets(data: unknown, secretValues: string[]): unknown {
    if (secretValues.length === 0) return data;
    if (typeof data === 'string') {
      let result = data;
      for (const sv of secretValues) {
        if (sv && result.includes(sv)) {
          result = result.replaceAll(sv, '[REDACTED]');
        }
      }
      return result;
    }
    if (Array.isArray(data)) {
      return data.map((v) => this.scrubSecrets(v, secretValues));
    }
    if (data && typeof data === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
        out[k] = this.scrubSecrets(v, secretValues);
      }
      return out;
    }
    return data;
  }

  /**
   * Topological sort of nodes based on connections (Kahn's algorithm).
   */
  topologicalSort(nodes: WorkflowNode[], connections: Connection[]): WorkflowNode[] {
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    // Initialize
    for (const node of nodes) {
      inDegree.set(node.id, 0);
      adjacency.set(node.id, []);
    }

    // Build graph
    for (const conn of connections) {
      const targets = adjacency.get(conn.sourceNodeId);
      if (targets) {
        targets.push(conn.targetNodeId);
      }
      inDegree.set(conn.targetNodeId, (inDegree.get(conn.targetNodeId) ?? 0) + 1);
    }

    // Start with nodes that have no incoming edges (triggers)
    const queue: string[] = [];
    for (const [nodeId, degree] of inDegree) {
      if (degree === 0) {
        queue.push(nodeId);
      }
    }

    const sorted: WorkflowNode[] = [];
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      const node = nodeMap.get(nodeId);
      if (node) {
        sorted.push(node);
      }

      for (const targetId of adjacency.get(nodeId) ?? []) {
        const newDegree = (inDegree.get(targetId) ?? 1) - 1;
        inDegree.set(targetId, newDegree);
        if (newDegree === 0) {
          queue.push(targetId);
        }
      }
    }

    if (sorted.length !== nodes.length) {
      throw new Error('Workflow contains a cycle - cannot execute');
    }

    return sorted;
  }

  /**
   * Gather input data for a node from its upstream connections.
   */
  private gatherInput(
    nodeId: string,
    connections: Connection[],
    nodeOutputs: Map<string, unknown>,
    triggerData?: unknown,
  ): unknown {
    const incomingConnections = connections.filter(c => c.targetNodeId === nodeId);

    if (incomingConnections.length === 0) {
      // Trigger node — use triggerData
      return triggerData;
    }

    if (incomingConnections.length === 1) {
      return nodeOutputs.get(incomingConnections[0].sourceNodeId);
    }

    // Multiple inputs (merge scenario) — return array of all upstream outputs
    return incomingConnections.map(c => nodeOutputs.get(c.sourceNodeId));
  }

  /**
   * Handle IF node branching: mark nodes on the untaken branch as skipped.
   */
  private handleIfBranching(
    ifNode: WorkflowNode,
    output: unknown,
    connections: Connection[],
    skippedNodes: Set<string>,
  ) {
    const result = output as { condition: boolean } | boolean;
    const conditionResult = typeof result === 'boolean' ? result : result?.condition ?? false;

    // Get connections from IF node
    const trueConnections = connections.filter(
      c => c.sourceNodeId === ifNode.id && c.sourceHandle === 'true',
    );
    const falseConnections = connections.filter(
      c => c.sourceNodeId === ifNode.id && c.sourceHandle === 'false',
    );

    // Skip the untaken branch
    const toSkip = conditionResult ? falseConnections : trueConnections;
    for (const conn of toSkip) {
      this.markBranchSkipped(conn.targetNodeId, connections, skippedNodes);
    }
  }

  /**
   * Recursively mark all downstream nodes from a starting node as skipped.
   */
  private markBranchSkipped(
    nodeId: string,
    connections: Connection[],
    skippedNodes: Set<string>,
  ) {
    if (skippedNodes.has(nodeId)) return;
    skippedNodes.add(nodeId);
    const downstream = connections.filter(c => c.sourceNodeId === nodeId);
    for (const conn of downstream) {
      this.markBranchSkipped(conn.targetNodeId, connections, skippedNodes);
    }
  }
}

export const workflowExecutor = new WorkflowExecutor();

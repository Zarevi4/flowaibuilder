import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { executions } from '../db/schema.js';
import { createNodeContext } from './context.js';
import { runNode } from './node-runner.js';
import type {
  Workflow,
  WorkflowNode,
  Connection,
  Execution,
  NodeExecutionData,
  ExecutionStatus,
  ExecutionMode,
} from '@flowaibuilder/shared';

export class WorkflowExecutor {
  /**
   * Execute a workflow graph node by node.
   */
  async execute(
    workflow: Workflow,
    triggerData?: unknown,
    mode: ExecutionMode = 'manual',
    triggeredBy: string = 'system',
  ): Promise<Execution> {
    // 1. Create execution record
    const startedAt = new Date();
    const [execRecord] = await db
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

    const nodeExecResults: NodeExecutionData[] = [];
    const nodeOutputs = new Map<string, unknown>();
    const skippedNodes = new Set<string>();
    let executionStatus: ExecutionStatus = 'success';
    let executionError: unknown = null;

    try {
      // 2. Topological sort
      const sortedNodes = this.topologicalSort(workflow.nodes, workflow.connections);

      // 3. Execute each node sequentially
      for (const node of sortedNodes) {
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

        // Build node context
        const context = createNodeContext({
          input,
          workflow,
        });

        // Run the node
        const nodeExec = await runNode(node, context);
        nodeExecResults.push(nodeExec);

        if (nodeExec.status === 'success') {
          nodeOutputs.set(node.id, nodeExec.output);
        }

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

    const [updated] = await db
      .update(executions)
      .set({
        status: executionStatus,
        nodeExecutions: nodeExecResults,
        resultData: lastOutput ?? null,
        error: executionError ? executionError : null,
        finishedAt,
        durationMs,
      })
      .where(eq(executions.id, execRecord.id))
      .returning();

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

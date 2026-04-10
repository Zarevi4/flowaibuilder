import type { Node, Edge } from '@xyflow/react';
import type { WorkflowNode, Connection } from '@flowaibuilder/shared';

export function toReactFlowNode(wn: WorkflowNode): Node {
  return {
    id: wn.id,
    type: wn.type,
    position: wn.position,
    data: { ...wn.data, name: wn.name, nodeType: wn.type },
  };
}

export function toReactFlowEdge(conn: Connection): Edge {
  return {
    id: conn.id,
    source: conn.sourceNodeId,
    target: conn.targetNodeId,
    sourceHandle: conn.sourceHandle,
    targetHandle: conn.targetHandle,
  };
}

export function toReactFlowNodes(nodes: WorkflowNode[]): Node[] {
  return nodes.map(toReactFlowNode);
}

export function toReactFlowEdges(connections: Connection[]): Edge[] {
  return connections.map(toReactFlowEdge);
}

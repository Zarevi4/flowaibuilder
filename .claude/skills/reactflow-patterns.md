# React Flow Patterns for flowAIbuilder

## Setup
```typescript
import {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState, useEdgesState, addEdge,
  Handle, Position, type NodeProps, type OnConnect,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
```

## Custom Node Registration
```typescript
// Canvas.tsx
const nodeTypes = {
  trigger: TriggerNode,
  'code-js': CodeNode,
  'http-request': HttpNode,
  'if': LogicNode,
  'set': LogicNode,
  'respond-webhook': OutputNode,
};

<ReactFlow nodeTypes={nodeTypes} ... />
```

## Custom Node Component Pattern
```tsx
export function TriggerNode({ data, selected }: NodeProps) {
  return (
    <div className={cn(
      'rounded-lg border bg-white dark:bg-gray-900 shadow-sm min-w-[180px]',
      'border-purple-300 dark:border-purple-700',
      selected && 'ring-2 ring-purple-400'
    )}>
      {/* No target handle - triggers are entry points */}
      <Handle type="source" position={Position.Bottom} className="!bg-purple-500" />
      
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-800">
        <div className="w-2.5 h-2.5 rounded-full bg-purple-500" />
        <span className="text-sm font-medium truncate">{data.label}</span>
        <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300">
          {data.config?.method || 'POST'}
        </span>
      </div>
      
      <div className="px-3 py-2 text-xs text-gray-500 font-mono truncate">
        {data.config?.path || '/webhook'}
      </div>
    </div>
  );
}
```

## Handle Positioning
For vertical (top-to-bottom) flow:
- **Target** handle: `Position.Top` (data comes IN from above)
- **Source** handle: `Position.Bottom` (data goes OUT below)
- **IF nodes**: TWO source handles with IDs:
  ```tsx
  <Handle type="source" position={Position.Bottom} id="true" style={{ left: '30%' }} />
  <Handle type="source" position={Position.Bottom} id="false" style={{ left: '70%' }} />
  ```

## Zustand Store with React Flow
```typescript
import { create } from 'zustand';
import { applyNodeChanges, applyEdgeChanges, addEdge } from '@xyflow/react';

export const useWorkflowStore = create((set, get) => ({
  nodes: [],
  edges: [],
  onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) }),
  onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) }),
  onConnect: (connection) => set({ edges: addEdge(connection, get().edges) }),
}));
```

## WebSocket -> React Flow Updates
```typescript
// When MCP adds a node, WebSocket pushes to canvas:
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  switch (msg.type) {
    case 'node_added':
      addNode({
        id: msg.node.id,
        type: msg.node.type,
        position: msg.position,
        data: { label: msg.node.name, config: msg.node.data.config },
      });
      break;
    case 'node_removed':
      removeNode(msg.node_id);
      break;
    case 'connection_added':
      addEdge({ source: msg.source, target: msg.target });
      break;
  }
};
```

## Auto-Layout (Simple Top-Down)
```typescript
const VERTICAL_GAP = 100;
const HORIZONTAL_GAP = 200;

function autoLayout(nodes: Node[], edges: Edge[]): Node[] {
  // Topological sort
  // Assign layers (BFS from roots)
  // Center each layer horizontally
  // For IF branches: true goes left, false goes right
}
```

Post-MVP: use `dagre` library for proper graph layout:
```
npm install dagre @types/dagre
```

## Overlay Pattern (Annotations, Zones)
Annotations and zone boundaries are NOT React Flow nodes. They are SVG overlays:

```tsx
<ReactFlow>
  {/* Normal flow */}
  <Background />
  <Controls />
  
  {/* Custom overlays rendered on top */}
  <Panel position="top-left">
    <HealthBadge score={healthScore} />
  </Panel>
</ReactFlow>

{/* Annotation cards positioned absolutely relative to canvas */}
{annotations.map(a => (
  <AnnotationCard
    key={a.id}
    annotation={a}
    nodePosition={getNodePosition(a.nodeId)}
  />
))}
```

## Performance
- Use `memo()` on all custom node components
- Minimize re-renders: Zustand selectors for individual fields
- Large workflows (50+ nodes): enable virtualization via React Flow's built-in support
- Debounce position updates when dragging

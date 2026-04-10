# Story 1.1: UI Scaffold & React Flow Canvas with Custom Nodes

Status: done

## Story

As a workflow user,
I want to see my workflow rendered as an interactive node graph in the browser,
So that I can visually understand the structure and flow of my automation.

## Acceptance Criteria

1. **Given** the packages/ui project is set up with Vite, React, Tailwind, Zustand, and @xyflow/react
   **When** I navigate to `/editor/:workflowId`
   **Then** the workflow is fetched from the server REST API and rendered on a React Flow canvas

2. **Given** a workflow with nodes of different types
   **When** the canvas renders
   **Then** each node type displays with its correct color and visual treatment (Trigger=purple `#7F77DD`, Code=teal `#1D9E75`, HTTP=coral `#D85A30`, Logic=amber `#BA7517`, AI=pink `#D4537E`, Output=gray `#888780`)
   **And** nodes show their name, type icon, and a brief config preview (URL for HTTP, code snippet for Code, etc.)

3. **Given** the canvas is loaded
   **When** I pan, zoom, select, or drag nodes
   **Then** standard React Flow interactions work correctly
   **And** node position changes are persisted to the server via `PUT /api/workflows/:id`

## Tasks / Subtasks

- [x] Task 1: React Router setup with page routing (AC: #1)
  - [x] 1.1 Install `react-router-dom` (v7)
  - [x] 1.2 Create `pages/Editor.tsx` — accepts `workflowId` param, fetches workflow, renders canvas
  - [x] 1.3 Create `pages/Dashboard.tsx` — placeholder page at `/` (just a link to editor for now)
  - [x] 1.4 Update `App.tsx` to use `BrowserRouter` with routes for `/` and `/editor/:workflowId`
  - [x] 1.5 Add Vite proxy for WebSocket: `'/ws'` → `ws://localhost:3000` (needed for future story 1.2)

- [x] Task 2: Zustand stores (AC: #1, #3)
  - [x] 2.1 Create `store/workflow.ts` — holds current `Workflow` object, `nodes` and `edges` as React Flow arrays, actions: `loadWorkflow(id)`, `updateNodePosition(nodeId, position)`, `setNodes`, `setEdges`
  - [x] 2.2 Create `store/ui.ts` — holds `selectedNodeId`, `sidebarOpen`, `loading` state

- [x] Task 3: API client layer (AC: #1, #3)
  - [x] 3.1 Create `lib/api.ts` — thin fetch wrapper with methods: `getWorkflow(id)`, `listWorkflows()`, `updateWorkflow(id, data)` matching existing REST endpoints

- [x] Task 4: Node registry and type mapping (AC: #2)
  - [x] 4.1 Create `lib/node-registry.ts` — imports `NODE_TYPES` from `@flowaibuilder/shared`, maps each `NodeType` to a React Flow `nodeTypes` key, exports `nodeTypeMap` for `<ReactFlow nodeTypes={...}>`
  - [x] 4.2 Create `lib/mappers.ts` — converts `WorkflowNode[]` → React Flow `Node[]` and `Connection[]` → React Flow `Edge[]`, using shared types

- [x] Task 5: Custom node components (AC: #2)
  - [x] 5.1 Create `components/canvas/nodes/TriggerNode.tsx` — purple `#7F77DD`, icons: Zap (webhook), Clock (schedule), Play (manual); shows trigger type label
  - [x] 5.2 Create `components/canvas/nodes/CodeNode.tsx` — teal `#1D9E75`, icon: Code; shows first ~2 lines of code preview from `data.config.code`
  - [x] 5.3 Create `components/canvas/nodes/HttpNode.tsx` — coral `#D85A30`, icon: Globe; shows method badge (GET/POST/etc) + truncated URL from `data.config.url`
  - [x] 5.4 Create `components/canvas/nodes/LogicNode.tsx` — amber `#BA7517`, icons: GitBranch (if/switch), GitMerge (merge), Repeat (loop); shows subtype label
  - [x] 5.5 Create `components/canvas/nodes/AiNode.tsx` — pink `#D4537E`, icon: Bot; shows model name from `data.config.model`
  - [x] 5.6 Create `components/canvas/nodes/OutputNode.tsx` — gray `#888780`, icon: Send; shows "Respond Webhook" label
  - [x] 5.7 Create `components/canvas/nodes/BaseNode.tsx` — shared wrapper: colored left border, header (icon + name), body (config preview), source/target `Handle` components with proper `position` and count from `NODE_TYPES[type].inputs/outputs`

- [x] Task 6: Canvas component (AC: #1, #2, #3)
  - [x] 6.1 Create `components/canvas/Canvas.tsx` — wraps `<ReactFlow>` with `nodeTypes` from registry, `Background`, `Controls`, `MiniMap`, `fitView`; receives nodes/edges from Zustand store
  - [x] 6.2 Wire `onNodeDragStop` → call `PUT /api/workflows/:id` to persist position changes (debounced, 500ms)
  - [x] 6.3 Wire `onNodesChange` and `onEdgesChange` to Zustand store for local state updates

- [x] Task 7: Editor page integration (AC: #1, #2, #3)
  - [x] 7.1 `Editor.tsx` reads `workflowId` from URL params, calls `store.loadWorkflow(id)` on mount
  - [x] 7.2 Shows loading skeleton while fetching
  - [x] 7.3 Renders `<Canvas />` with workflow data
  - [x] 7.4 Error state if workflow not found (404)

## Dev Notes

### Architecture Compliance

- **File structure**: All new files go under `packages/ui/src/` following the architecture spec:
  - Pages: `pages/Editor.tsx`, `pages/Dashboard.tsx`
  - Canvas components: `components/canvas/Canvas.tsx`, `components/canvas/nodes/*.tsx`
  - Stores: `store/workflow.ts`, `store/ui.ts`
  - Utilities: `lib/api.ts`, `lib/node-registry.ts`, `lib/mappers.ts`
- **State management**: Zustand 5 with slices pattern. Do NOT use React context or Redux.
- **Styling**: Tailwind CSS v4 (uses `@import "tailwindcss"` not `@tailwind` directives). No CSS modules. No styled-components.
- **Icons**: Use `lucide-react` exclusively — already installed. Icon names from `NODE_TYPES` constant: Zap, Clock, Play, Code, GitBranch, GitMerge, Repeat, PenLine, Globe, Bot, Send.
- **Types**: Import shared types from `@flowaibuilder/shared` — do NOT duplicate type definitions locally.

### Existing Code to Reuse (DO NOT RECREATE)

- **`@flowaibuilder/shared` types**: `Workflow`, `WorkflowNode`, `Connection`, `Position`, `NodeData`, `NodeType`, `NodeCategory`, `NodeTypeMetadata` — all defined in `packages/shared/src/types/workflow.ts`
- **`NODE_TYPES` constant**: Full node metadata (type, category, label, description, color, icon, inputs, outputs) at `packages/shared/src/constants/node-types.ts` — use these colors/icons exactly
- **`NODE_CATEGORIES` constant**: Category labels and colors at same file
- **Current `App.tsx`**: Has basic ReactFlow + header already — replace the static `initialNodes` with dynamic data, keep the header/layout structure
- **Vite config**: Proxy to `/api` → `localhost:3000` already configured
- **Package deps**: React 19, @xyflow/react 12.4, Zustand 5, Tailwind 4, lucide-react — all installed

### Server API Endpoints (Already Implemented)

```
GET    /api/workflows           → { workflows: Workflow[] }
GET    /api/workflows/:id       → Workflow
POST   /api/workflows           → Workflow  (body: { name, description? })
PUT    /api/workflows/:id       → Workflow  (body: Partial<Workflow>)
DELETE /api/workflows/:id       → { deleted: true, id }
POST   /api/workflows/:id/nodes → { node, position }  (body: { type, name, config?, connectAfter? })
POST   /api/workflows/:id/execute → Execution
```

The `PUT /api/workflows/:id` endpoint accepts `nodes` array directly — use this for persisting position changes by sending the full nodes array with updated positions.

### React Flow v12 Specifics (@xyflow/react 12.4)

- Import from `@xyflow/react` (NOT `reactflow` or `react-flow-renderer`)
- Custom nodes use `NodeProps` type from `@xyflow/react`
- `Handle` component for input/output ports: `<Handle type="target" position={Position.Left} />`, `<Handle type="source" position={Position.Right} />`
- Register custom nodes via `nodeTypes` prop on `<ReactFlow>` — keys must match the type strings
- `onNodeDragStop` callback provides `(event, node)` — `node.position` has new coordinates
- `useNodesState` and `useEdgesState` hooks available, BUT since we use Zustand, use `onNodesChange`/`onEdgesChange` + `applyNodeChanges`/`applyEdgeChanges` from `@xyflow/react` instead
- `fitView` prop auto-fits on initial load
- `MiniMap` accepts `nodeColor` callback or string

### Mapping WorkflowNode → React Flow Node

```typescript
// lib/mappers.ts pattern
import type { Node, Edge } from '@xyflow/react';
import type { WorkflowNode, Connection } from '@flowaibuilder/shared';

function toReactFlowNode(wn: WorkflowNode): Node {
  return {
    id: wn.id,
    type: wn.type,  // must match nodeTypes registry key
    position: wn.position,
    data: { ...wn.data, name: wn.name, nodeType: wn.type },
  };
}

function toReactFlowEdge(conn: Connection): Edge {
  return {
    id: conn.id,
    source: conn.sourceNodeId,
    target: conn.targetNodeId,
    sourceHandle: conn.sourceHandle,
    targetHandle: conn.targetHandle,
  };
}
```

### Custom Node Component Pattern

```typescript
// components/canvas/nodes/BaseNode.tsx pattern
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { NODE_TYPES } from '@flowaibuilder/shared';

// Each node gets: colored left border, header with icon + name, body with preview
// Use Handle count from NODE_TYPES[type].inputs / .outputs
// Trigger nodes: 0 inputs, 1 output → no left handle
// Output nodes: 1 input, 0 outputs → no right handle
// Logic branching (if): 1 input, 2 outputs → two right handles with IDs
```

### Zustand 5 Pattern

```typescript
// store/workflow.ts pattern
import { create } from 'zustand';
// Zustand 5: no more set((state) => ...) wrapper needed for simple sets
// Use: const useWorkflowStore = create<WorkflowState>()((set, get) => ({...}))
```

### Previous Story Intelligence (Story 1.0)

Story 1.0 established the full server foundation. Key learnings:
- Server runs on port 3000, UI proxies to it via Vite dev server
- All node/connection data stored as JSON columns in the `workflows` table (not separate tables)
- The `toWorkflow()` helper in routes handles null-coalescing for all JSON fields
- Broadcaster is accessible via `getBroadcaster()` singleton
- WebSocket broadcasts `node_added`, `node_updated`, `node_removed` events (relevant for story 1.2)
- Tests use vitest — if adding UI tests, use same framework

### Project Structure Notes

- Alignment with unified project structure: all files match architecture spec paths exactly
- Empty directories already scaffolded: `components/canvas/`, `components/sidebar/`, `components/toolbar/`, `components/export/`, `store/`, `pages/`, `lib/`, `types/`
- The `index.css` already has `@import "tailwindcss"` and full-height setup for html/body/#root

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 1, Story 1.1]
- [Source: _bmad-output/planning-artifacts/architecture.md — UI directory structure, WebSocket protocol]
- [Source: packages/shared/src/types/workflow.ts — Workflow, WorkflowNode, Connection, NodeType, NodeTypeMetadata]
- [Source: packages/shared/src/constants/node-types.ts — NODE_TYPES, NODE_CATEGORIES with colors/icons]
- [Source: packages/server/src/api/routes/workflows.ts — REST API endpoints]
- [Source: packages/ui/src/App.tsx — current scaffold with ReactFlow]
- [Source: packages/ui/package.json — installed dependencies]
- [Source: packages/ui/vite.config.ts — proxy config]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- Fixed `NodeDragHandler` → `OnNodeDrag` type import for @xyflow/react v12.4
- Added `composite: true` to shared/tsconfig.json for project references to work

### Completion Notes List
- Task 1: react-router-dom v7 installed, App.tsx updated with BrowserRouter, routes for `/` and `/editor/:workflowId`, Vite WS proxy added
- Task 2: Zustand stores created — workflow store with loadWorkflow/updateNodePosition/onNodesChange/onEdgesChange, ui store with selectedNodeId/sidebarOpen
- Task 3: API client with getWorkflow, listWorkflows, updateWorkflow — thin fetch wrapper
- Task 4: Node registry maps all 13 NODE_TYPES to 6 custom components; mappers convert WorkflowNode↔ReactFlow Node and Connection↔Edge
- Task 5: All 7 custom node components created — BaseNode wrapper with colored left border, handles from metadata, header/body layout. Specialized: TriggerNode, CodeNode, HttpNode, LogicNode, AiNode, OutputNode
- Task 6: Canvas component wraps ReactFlow with nodeTypes, Background, Controls, MiniMap, fitView. onNodeDragStop debounced 500ms save to server via PUT API
- Task 7: Editor page reads workflowId from URL, loads workflow on mount, shows loading spinner, error state for 404, renders Canvas

### Change Log
- 2026-03-25: Story 1.1 implemented — UI scaffold with React Flow canvas, custom nodes, routing, stores, API client, and tests (20 tests)

### File List
- packages/ui/src/App.tsx (modified — added BrowserRouter routing)
- packages/ui/src/pages/Editor.tsx (new)
- packages/ui/src/pages/Dashboard.tsx (new)
- packages/ui/src/store/workflow.ts (new)
- packages/ui/src/store/ui.ts (new)
- packages/ui/src/lib/api.ts (new)
- packages/ui/src/lib/mappers.ts (new)
- packages/ui/src/lib/node-registry.ts (new)
- packages/ui/src/components/canvas/Canvas.tsx (new)
- packages/ui/src/components/canvas/nodes/BaseNode.tsx (new)
- packages/ui/src/components/canvas/nodes/TriggerNode.tsx (new)
- packages/ui/src/components/canvas/nodes/CodeNode.tsx (new)
- packages/ui/src/components/canvas/nodes/HttpNode.tsx (new)
- packages/ui/src/components/canvas/nodes/LogicNode.tsx (new)
- packages/ui/src/components/canvas/nodes/AiNode.tsx (new)
- packages/ui/src/components/canvas/nodes/OutputNode.tsx (new)
- packages/ui/vite.config.ts (modified — added WS proxy)
- packages/ui/package.json (modified — added react-router-dom, test deps, test scripts)
- packages/ui/vitest.config.ts (new)
- packages/ui/src/__tests__/setup.ts (new)
- packages/ui/src/__tests__/mappers.test.ts (new)
- packages/ui/src/__tests__/node-registry.test.ts (new)
- packages/ui/src/__tests__/api.test.ts (new)
- packages/ui/src/__tests__/workflow-store.test.ts (new)
- packages/shared/tsconfig.json (modified — added composite: true)

### Review Findings

- [x] [Review][Decision] #7 Zustand stores are independent, not using slices pattern — Accepted: separate stores are intentional. Zustand 5 docs recommend multiple stores for independent state. Spec constraint intentionally deviated.
- [x] [Review][Patch] #8 Node icons hardcoded per component, not resolved from NODE_TYPES.icon — Fixed: created lib/icons.ts dynamic resolver, BaseNode resolves icons from NODE_TYPES.icon, removed hardcoded icon maps from all node components
- [x] [Review][Patch] #1 Stale closure + saveTimeout never cleared on workflow switch — Fixed: loadWorkflow now clears saveTimeout on entry
- [x] [Review][Patch] #2 Race condition: rapid loadWorkflow calls show stale workflow — Fixed: added loadRequestId counter, stale responses are discarded
- [x] [Review][Patch] #4 API client sets Content-Type on GET + header spread overrides instead of merging — Fixed: Content-Type only set when body present, headers properly merged
- [x] [Review][Patch] #5 Dashboard silently swallows errors / crashes on undefined workflows — Fixed: added error state, null guard on res.workflows
- [x] [Review][Patch] #6 Editor does not reset store on workflow switch — Fixed: loadWorkflow now clears workflow/nodes/edges on entry
- [x] [Review][Patch] #9 HttpNode method badge hardcodes color #D85A30 — Fixed: reads color from NODE_TYPES
- [x] [Review][Patch] #10 BaseNode Handle id=undefined for single-port nodes mismatches server edges with explicit handle IDs — Fixed: always set handle IDs (input-0, output-0)
- [x] [Review][Patch] #11 Editor error heading hardcodes "Workflow not found" for all errors — Fixed: changed to "Error loading workflow"
- [x] [Review][Patch] #13 Dead code: categoryComponentMap never used — Fixed: removed
- [x] [Review][Patch] #14 Test vi.useFakeTimers() not cleaned up in afterEach — Fixed: added afterEach with vi.useRealTimers()
- [x] [Review][Defer] #3 workflow.nodes and ReactFlow nodes diverge on non-position changes — onNodesChange only updates ReactFlow nodes, not workflow.nodes. Pre-existing architectural choice, will matter when node add/delete via canvas is implemented. [store/workflow.ts:52-56] — deferred, pre-existing
- [x] [Review][Defer] #12 No 404 catch-all route — unknown URLs show blank content area. Not in story scope. [App.tsx:18-21] — deferred, pre-existing

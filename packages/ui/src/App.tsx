import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Zap } from 'lucide-react';

const initialNodes: Node[] = [
  {
    id: '1',
    type: 'default',
    position: { x: 250, y: 100 },
    data: { label: 'Welcome to flowAIbuilder' },
  },
];

const initialEdges: Edge[] = [];

export default function App() {
  return (
    <div className="h-full flex flex-col bg-gray-950">
      {/* Header */}
      <header className="h-12 border-b border-gray-800 flex items-center px-4 gap-2 bg-gray-900">
        <Zap className="w-5 h-5 text-purple-500" />
        <span className="text-white font-semibold text-sm">flowAIbuilder</span>
        <span className="text-gray-500 text-xs ml-2">v0.1.0</span>
      </header>

      {/* Canvas */}
      <div className="flex-1">
        <ReactFlow
          nodes={initialNodes}
          edges={initialEdges}
          fitView
          className="bg-gray-950"
        >
          <Background color="#374151" gap={20} />
          <Controls />
          <MiniMap
            style={{ background: '#111827' }}
            nodeColor="#7c3aed"
          />
        </ReactFlow>
      </div>
    </div>
  );
}

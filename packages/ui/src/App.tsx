import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { Zap, Users } from 'lucide-react';
import { Dashboard } from './pages/Dashboard';
import { Editor } from './pages/Editor';
import { ExecutionHistory } from './pages/ExecutionHistory';
import { ExecutionDetail } from './pages/ExecutionDetail';
import { TeamDashboard } from './pages/TeamDashboard';
import { AuditLog } from './pages/AuditLog';
import { Settings } from './pages/Settings';

export default function App() {
  return (
    <BrowserRouter>
      <div className="h-full flex flex-col bg-gray-950">
        {/* Header */}
        <header className="h-12 border-b border-gray-800 flex items-center px-4 gap-2 bg-gray-900">
          <Link to="/" className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-purple-500" />
            <span className="text-white font-semibold text-sm">flowAIbuilder</span>
          </Link>
          <span className="text-gray-500 text-xs ml-2">v0.1.0</span>
          <nav className="ml-6 flex items-center gap-4">
            <Link to="/" className="text-gray-400 hover:text-white text-sm">Workflows</Link>
            <Link to="/?section=teams" className="text-gray-400 hover:text-white text-sm flex items-center gap-1">
              <Users className="w-3.5 h-3.5" />
              Teams
            </Link>
            <Link to="/audit-log" className="text-gray-400 hover:text-white text-sm">Audit Log</Link>
            <Link to="/settings" className="text-gray-400 hover:text-white text-sm">Settings</Link>
          </nav>
        </header>

        {/* Routes */}
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/editor/:workflowId" element={<Editor />} />
          <Route path="/editor/:workflowId/executions" element={<ExecutionHistory />} />
          <Route path="/editor/:workflowId/executions/:executionId" element={<ExecutionDetail />} />
          <Route path="/teams/:teamName" element={<TeamDashboard />} />
          <Route path="/audit-log" element={<AuditLog />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

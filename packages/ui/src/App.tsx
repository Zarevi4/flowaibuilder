import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { Zap, Users, LogOut } from 'lucide-react';
import { Dashboard } from './pages/Dashboard';
import { Editor } from './pages/Editor';
import { ExecutionHistory } from './pages/ExecutionHistory';
import { ExecutionDetail } from './pages/ExecutionDetail';
import { TeamDashboard } from './pages/TeamDashboard';
import { AuditLog } from './pages/AuditLog';
import { Settings } from './pages/Settings';
import { Login } from './pages/Login';
import { getCurrentUser, type CurrentUser } from './lib/api';

export default function App() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [checking, setChecking] = useState(true);

  const checkAuth = () => {
    getCurrentUser()
      .then(setUser)
      .finally(() => setChecking(false));
  };

  useEffect(() => { checkAuth(); }, []);

  if (checking) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-950">
        <div className="w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Login onLogin={checkAuth} />;
  }

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
    setUser(null);
  };

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
          <div className="ml-auto flex items-center gap-3">
            <span className="text-gray-500 text-xs">{user.email}</span>
            <button onClick={handleLogout} className="text-gray-500 hover:text-white" title="Sign out">
              <LogOut size={14} />
            </button>
          </div>
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

import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { registerAllNodes } from './nodes/index.js';
import { workflowRoutes, getWorkflowById } from './api/routes/workflows.js';
import { registerReviewRoutes } from './api/routes/review.js';
import { teamRoutes } from './api/routes/teams.js';
import { settingsRoutes } from './api/routes/settings.js';
import { auditRoutes } from './api/routes/audit.js';
import { secretsRoutes } from './api/routes/secrets.js';
import { authRoutes } from './api/routes/auth.js';
import { userRoutes } from './api/routes/users.js';
import { createMcpServer, registerSseTransport, startStdioTransport } from './mcp/index.js';
import { createBroadcaster } from './api/ws/broadcaster.js';
import { registerAuditLogger } from './audit/logger.js';
import { registerAuditMiddleware } from './api/middleware/audit.js';
import { registerAuthMiddleware } from './api/middleware/auth.js';
import { applyRouteRbac } from './api/middleware/rbac-routes.js';
import { seedFirstAdmin } from './auth/seed.js';
import { createTeamWatcher } from './agent-teams/index.js';
import { isQueueMode, startWorker, closeWorker, closeQueue } from './queue/index.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const WS_PORT = parseInt(process.env.WS_PORT || '5174', 10);

// Register all node handlers
registerAllNodes();

// Start WebSocket broadcaster
const broadcaster = createBroadcaster(WS_PORT, getWorkflowById);

// Initialize Agent Teams file watcher
const teamWatcher = createTeamWatcher();

const server = Fastify({ logger: true });

await server.register(cors, { origin: true });

// Register audit logger on the Fastify instance (Story 5.1)
registerAuditLogger(server);

// Cookie plugin required by auth middleware / auth routes (Story 5.2)
await server.register(cookie);

// Seed first admin from env vars if the users table is empty (Story 5.2)
await seedFirstAdmin(server);

// Auth middleware (Story 5.2) — onRequest hook; sets request.user BEFORE
// the audit middleware's preHandler runs.
await registerAuthMiddleware(server);

// Health check
server.get('/api/health', async () => {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '0.1.0',
    wsClients: broadcaster.clientCount,
  };
});

// REST API routes
await authRoutes(server);
await userRoutes(server);
await workflowRoutes(server);
await registerReviewRoutes(server);
await teamRoutes(server);
await settingsRoutes(server);
await secretsRoutes(server);
await auditRoutes(server);

// RBAC guard — registered AFTER routes, BEFORE audit middleware.
await applyRouteRbac(server);

// Audit middleware — registered AFTER routes so routeOptions.url is populated.
await registerAuditMiddleware(server);

// MCP server with SSE transport
const mcpServer = createMcpServer(server);
registerSseTransport(server, mcpServer);

// Start stdio transport if --stdio flag is passed (for Claude Code local)
const isStdio = process.argv.includes('--stdio');
if (isStdio) {
  await startStdioTransport(mcpServer);
}

// Start BullMQ worker if queue mode is enabled (Story 5.5)
if (isQueueMode()) {
  startWorker();
}

try {
  await server.listen({ port: PORT, host: '0.0.0.0' });
  if (!isStdio) {
    console.log(`🚀 flowAIbuilder server on http://localhost:${PORT}`);
    console.log(`🔌 MCP SSE endpoint: http://localhost:${PORT}/mcp/sse`);
    console.log(`📡 WebSocket on ws://localhost:${WS_PORT}`);
    if (isQueueMode()) {
      console.log(`📦 Queue mode enabled (concurrency: ${process.env.QUEUE_CONCURRENCY || '5'})`);
    }
  }
  // Graceful shutdown
  const shutdown = async () => {
    if (isQueueMode()) {
      await closeWorker();
      await closeQueue();
    }
    teamWatcher.closeAll();
    broadcaster.close();
    await server.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
} catch (err) {
  server.log.error(err);
  process.exit(1);
}

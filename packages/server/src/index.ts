import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerAllNodes } from './nodes/index.js';
import { workflowRoutes } from './api/routes/workflows.js';
import { createMcpServer, registerSseTransport } from './mcp/index.js';
import { createBroadcaster } from './api/ws/broadcaster.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const WS_PORT = parseInt(process.env.WS_PORT || '5174', 10);

// Register all node handlers
registerAllNodes();

// Start WebSocket broadcaster
const broadcaster = createBroadcaster(WS_PORT);

const server = Fastify({ logger: true });

await server.register(cors, { origin: true });

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
await workflowRoutes(server);

// MCP server with SSE transport
const mcpServer = createMcpServer();
registerSseTransport(server, mcpServer);

try {
  await server.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`🚀 flowAIbuilder server on http://localhost:${PORT}`);
  console.log(`🔌 MCP SSE endpoint: http://localhost:${PORT}/mcp/sse`);
  console.log(`📡 WebSocket on ws://localhost:${WS_PORT}`);
} catch (err) {
  server.log.error(err);
  process.exit(1);
}

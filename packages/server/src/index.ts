import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';

const PORT = parseInt(process.env.PORT || '3000', 10);

const server = Fastify({ logger: true });

await server.register(cors, {
  origin: true,
});

// Health check
server.get('/api/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Placeholder routes
server.get('/api/workflows', async () => {
  return { workflows: [] };
});

try {
  await server.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`🚀 flowAIbuilder server running on http://localhost:${PORT}`);
} catch (err) {
  server.log.error(err);
  process.exit(1);
}

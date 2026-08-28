import type { FastifyInstance } from 'fastify';
import { checkDatabaseConnection } from '../db.js';

export default async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/healthz', async () => {
    return { status: 'ok' };
  });

  fastify.get('/readyz', async (_request, reply) => {
    const dbUp = await checkDatabaseConnection();
    if (!dbUp) {
      return reply.code(503).send({ status: 'not-ready', db: 'down' });
    }
    return { status: 'ready', db: 'up' };
  });
}

import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import authPlugin from './plugins/auth.js';
import healthRoutes from './routes/health.js';
import authRoutes from './routes/auth.js';
import ticketRoutes from './routes/tickets.js';
import commentRoutes from './routes/comments.js';
import userRoutes from './routes/users.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      transport: config.nodeEnv === 'development' ? { target: 'pino-pretty' } : undefined,
    },
  });

  await app.register(cors, { origin: config.corsOrigin });
  await app.register(authPlugin);

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(ticketRoutes);
  await app.register(commentRoutes);
  await app.register(userRoutes);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error(error);
    const status = error.statusCode ?? 500;
    reply.code(status).send({
      error: status === 500 ? 'Internal server error' : error.message,
    });
  });

  return app;
}

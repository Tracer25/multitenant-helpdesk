import type { FastifyInstance } from 'fastify';
import { withTenantContext } from '../db.js';

const patchUserSchema = {
  body: {
    type: 'object',
    required: ['role'],
    properties: {
      role: { type: 'string', enum: ['admin', 'agent', 'customer'] },
    },
    additionalProperties: false,
  },
};

export default async function userRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', fastify.requireRole(['admin']));

  fastify.get('/api/v1/users', async (request) => {
    const { tenantId } = request.user;
    const users = await withTenantContext(tenantId, async (client) => {
      const result = await client.query(
        'SELECT id, email, role, created_at FROM users WHERE tenant_id = $1 ORDER BY created_at ASC',
        [tenantId],
      );
      return result.rows;
    });
    return { users };
  });

  fastify.patch<{ Params: { id: string }; Body: { role: 'admin' | 'agent' | 'customer' } }>(
    '/api/v1/users/:id',
    { schema: patchUserSchema },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { id } = request.params;
      const { role } = request.body;

      const user = await withTenantContext(tenantId, async (client) => {
        const result = await client.query(
          `UPDATE users SET role = $3 WHERE tenant_id = $1 AND id = $2
           RETURNING id, email, role, created_at`,
          [tenantId, id, role],
        );
        return result.rows[0];
      });

      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }
      return { user };
    },
  );
}

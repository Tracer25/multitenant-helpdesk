import type { FastifyInstance } from 'fastify';
import { withTenantContext } from '../db.js';

const createCommentSchema = {
  body: {
    type: 'object',
    required: ['body'],
    properties: {
      body: { type: 'string', minLength: 1, maxLength: 5000 },
    },
  },
};

export default async function commentRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get<{ Params: { id: string } }>(
    '/api/v1/tickets/:id/comments',
    async (request, reply) => {
      const { tenantId } = request.user;
      const { id: ticketId } = request.params;

      const result = await withTenantContext(tenantId, async (client) => {
        const ticket = await client.query('SELECT id FROM tickets WHERE tenant_id = $1 AND id = $2', [
          tenantId,
          ticketId,
        ]);
        if (!ticket.rowCount) {
          return null;
        }
        const comments = await client.query(
          'SELECT * FROM ticket_comments WHERE tenant_id = $1 AND ticket_id = $2 ORDER BY created_at ASC',
          [tenantId, ticketId],
        );
        return comments.rows;
      });

      if (result === null) {
        return reply.code(404).send({ error: 'Ticket not found' });
      }
      return { comments: result };
    },
  );

  fastify.post<{ Params: { id: string }; Body: { body: string } }>(
    '/api/v1/tickets/:id/comments',
    { schema: createCommentSchema },
    async (request, reply) => {
      const { tenantId, sub } = request.user;
      const { id: ticketId } = request.params;
      const { body } = request.body;

      const comment = await withTenantContext(tenantId, async (client) => {
        const ticket = await client.query('SELECT id FROM tickets WHERE tenant_id = $1 AND id = $2', [
          tenantId,
          ticketId,
        ]);
        if (!ticket.rowCount) {
          return null;
        }
        const result = await client.query(
          `INSERT INTO ticket_comments (tenant_id, ticket_id, author_id, body)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [tenantId, ticketId, sub, body],
        );
        return result.rows[0];
      });

      if (!comment) {
        return reply.code(404).send({ error: 'Ticket not found' });
      }
      return reply.code(201).send({ comment });
    },
  );
}

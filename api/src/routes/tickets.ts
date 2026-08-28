import type { FastifyInstance } from 'fastify';
import { withTenantContext } from '../db.js';

const STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

const createTicketSchema = {
  body: {
    type: 'object',
    required: ['subject'],
    properties: {
      subject: { type: 'string', minLength: 1, maxLength: 200 },
      description: { type: 'string', maxLength: 10000 },
      priority: { type: 'string', enum: PRIORITIES },
    },
  },
};

const patchTicketSchema = {
  body: {
    type: 'object',
    minProperties: 1,
    properties: {
      subject: { type: 'string', minLength: 1, maxLength: 200 },
      description: { type: 'string', maxLength: 10000 },
      status: { type: 'string', enum: STATUSES },
      priority: { type: 'string', enum: PRIORITIES },
      assignedTo: { type: 'string', minLength: 36, maxLength: 36 },
    },
    additionalProperties: false,
  },
};

export default async function ticketRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/api/v1/tickets', async (request) => {
    const { tenantId } = request.user;
    const { status } = request.query as { status?: string };
    const tickets = await withTenantContext(tenantId, async (client) => {
      if (status && (STATUSES as readonly string[]).includes(status)) {
        const result = await client.query(
          'SELECT * FROM tickets WHERE tenant_id = $1 AND status = $2 ORDER BY created_at DESC',
          [tenantId, status],
        );
        return result.rows;
      }
      const result = await client.query(
        'SELECT * FROM tickets WHERE tenant_id = $1 ORDER BY created_at DESC',
        [tenantId],
      );
      return result.rows;
    });
    return { tickets };
  });

  fastify.post<{ Body: { subject: string; description?: string; priority?: string } }>(
    '/api/v1/tickets',
    { schema: createTicketSchema },
    async (request, reply) => {
      const { tenantId, sub } = request.user;
      const { subject, description, priority } = request.body;
      const ticket = await withTenantContext(tenantId, async (client) => {
        const result = await client.query(
          `INSERT INTO tickets (tenant_id, created_by, subject, description, priority)
           VALUES ($1, $2, $3, $4, COALESCE($5, 'medium'))
           RETURNING *`,
          [tenantId, sub, subject, description ?? null, priority ?? null],
        );
        return result.rows[0];
      });
      return reply.code(201).send({ ticket });
    },
  );

  fastify.get<{ Params: { id: string } }>('/api/v1/tickets/:id', async (request, reply) => {
    const { tenantId } = request.user;
    const { id } = request.params;
    const ticket = await withTenantContext(tenantId, async (client) => {
      const result = await client.query('SELECT * FROM tickets WHERE tenant_id = $1 AND id = $2', [
        tenantId,
        id,
      ]);
      return result.rows[0];
    });
    if (!ticket) {
      return reply.code(404).send({ error: 'Ticket not found' });
    }
    return { ticket };
  });

  fastify.patch<{
    Params: { id: string };
    Body: { subject?: string; description?: string; status?: string; priority?: string; assignedTo?: string };
  }>('/api/v1/tickets/:id', { schema: patchTicketSchema }, async (request, reply) => {
    const { tenantId } = request.user;
    const { id } = request.params;
    const { subject, description, status, priority, assignedTo } = request.body;

    const ticket = await withTenantContext(tenantId, async (client) => {
      const result = await client.query(
        `UPDATE tickets SET
           subject = COALESCE($3, subject),
           description = COALESCE($4, description),
           status = COALESCE($5, status),
           priority = COALESCE($6, priority),
           assigned_to = COALESCE($7, assigned_to),
           updated_at = now()
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        [tenantId, id, subject ?? null, description ?? null, status ?? null, priority ?? null, assignedTo ?? null],
      );
      return result.rows[0];
    });

    if (!ticket) {
      return reply.code(404).send({ error: 'Ticket not found' });
    }
    return { ticket };
  });

  fastify.delete<{ Params: { id: string } }>(
    '/api/v1/tickets/:id',
    { preHandler: fastify.requireRole(['admin']) },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { id } = request.params;
      const deleted = await withTenantContext(tenantId, async (client) => {
        const result = await client.query('DELETE FROM tickets WHERE tenant_id = $1 AND id = $2', [
          tenantId,
          id,
        ]);
        return result.rowCount;
      });
      if (!deleted) {
        return reply.code(404).send({ error: 'Ticket not found' });
      }
      return reply.code(204).send();
    },
  );
}

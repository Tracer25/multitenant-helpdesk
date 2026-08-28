import type { FastifyInstance } from 'fastify';
import { pool, withTenantContext } from '../db.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import type { JwtUser } from '../types.js';

const SLUG_PATTERN = '^[a-z0-9]+(-[a-z0-9]+)*$';
// Deliberately simple shape check, not a full RFC 5322 validator -- avoids
// pulling in ajv-formats for a single field, real delivery is what proves
// an email works.
const EMAIL_PATTERN = '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$';

const signupSchema = {
  body: {
    type: 'object',
    required: ['tenantName', 'tenantSlug', 'email', 'password'],
    properties: {
      tenantName: { type: 'string', minLength: 1, maxLength: 120 },
      tenantSlug: { type: 'string', pattern: SLUG_PATTERN, minLength: 1, maxLength: 63 },
      email: { type: 'string', pattern: EMAIL_PATTERN, maxLength: 254 },
      password: { type: 'string', minLength: 8, maxLength: 200 },
    },
  },
};

const loginSchema = {
  body: {
    type: 'object',
    required: ['tenantSlug', 'email', 'password'],
    properties: {
      tenantSlug: { type: 'string', minLength: 1, maxLength: 63 },
      email: { type: 'string', pattern: EMAIL_PATTERN, maxLength: 254 },
      password: { type: 'string', minLength: 1, maxLength: 200 },
    },
  },
};

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.post<{
    Body: { tenantName: string; tenantSlug: string; email: string; password: string };
  }>('/api/v1/auth/signup', { schema: signupSchema }, async (request, reply) => {
    const { tenantName, tenantSlug, email, password } = request.body;

    const existing = await pool.query('SELECT id FROM tenants WHERE slug = $1', [tenantSlug]);
    if (existing.rowCount) {
      return reply.code(409).send({ error: 'Tenant slug already in use' });
    }

    const passwordHash = await hashPassword(password);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tenantResult = await client.query<{ id: string }>(
        'INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id',
        [tenantName, tenantSlug],
      );
      const tenantId = tenantResult.rows[0].id;

      // The tenant now exists, so scope the rest of this transaction to it
      // before inserting the first (admin) user, satisfying the RLS policy.
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
      const userResult = await client.query<{ id: string }>(
        `INSERT INTO users (tenant_id, email, password_hash, role)
         VALUES ($1, $2, $3, 'admin') RETURNING id`,
        [tenantId, email, passwordHash],
      );

      await client.query('COMMIT');

      const payload: JwtUser = { sub: userResult.rows[0].id, tenantId, role: 'admin', email };
      const token = fastify.jwt.sign(payload);
      return reply.code(201).send({ token, user: payload, tenant: { id: tenantId, slug: tenantSlug } });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  fastify.post<{
    Body: { tenantSlug: string; email: string; password: string };
  }>('/api/v1/auth/login', { schema: loginSchema }, async (request, reply) => {
    const { tenantSlug, email, password } = request.body;

    const tenantResult = await pool.query<{ id: string }>('SELECT id FROM tenants WHERE slug = $1', [
      tenantSlug,
    ]);
    if (!tenantResult.rowCount) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }
    const tenantId = tenantResult.rows[0].id;

    const user = await withTenantContext(tenantId, async (client) => {
      const result = await client.query<{
        id: string;
        password_hash: string;
        role: JwtUser['role'];
      }>('SELECT id, password_hash, role FROM users WHERE tenant_id = $1 AND email = $2', [
        tenantId,
        email,
      ]);
      return result.rows[0];
    });

    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const payload: JwtUser = { sub: user.id, tenantId, role: user.role, email };
    const token = fastify.jwt.sign(payload);
    return { token, user: payload };
  });

  fastify.get(
    '/api/v1/auth/me',
    { preHandler: fastify.authenticate },
    async (request) => {
      const { sub, tenantId } = request.user;
      const user = await withTenantContext(tenantId, async (client) => {
        const result = await client.query(
          'SELECT id, email, role, created_at FROM users WHERE id = $1',
          [sub],
        );
        return result.rows[0];
      });
      return { user };
    },
  );
}

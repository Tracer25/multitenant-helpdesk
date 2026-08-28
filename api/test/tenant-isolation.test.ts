import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { createTestApp, resetTestData } from './helpers.js';

async function signUpAndLogin(app: FastifyInstance, slug: string) {
  const signup = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: {
      tenantName: slug,
      tenantSlug: slug,
      email: `owner@${slug}.test`,
      password: 'correct-horse-battery-staple',
    },
  });
  return signup.json().token as string;
}

describe('tenant isolation', () => {
  let app: FastifyInstance;
  let pool: pg.Pool;

  beforeAll(async () => {
    ({ app, pool } = await createTestApp());
  });

  beforeEach(async () => {
    await resetTestData(pool);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it("a tenant cannot list or fetch another tenant's tickets over the API", async () => {
    const tokenA = await signUpAndLogin(app, 'tenant-a');
    const tokenB = await signUpAndLogin(app, 'tenant-b');

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/tickets',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { subject: 'Tenant A private ticket' },
    });
    expect(created.statusCode).toBe(201);
    const ticketId = created.json().ticket.id as string;

    const listAsB = await app.inject({
      method: 'GET',
      url: '/api/v1/tickets',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(listAsB.json().tickets).toHaveLength(0);

    const fetchAsB = await app.inject({
      method: 'GET',
      url: `/api/v1/tickets/${ticketId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(fetchAsB.statusCode).toBe(404);

    const fetchAsA = await app.inject({
      method: 'GET',
      url: `/api/v1/tickets/${ticketId}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(fetchAsA.statusCode).toBe(200);
  });

  it('enforces isolation at the database layer via row-level security, not just app filtering', async () => {
    const { withTenantContext } = await import('../src/db.js');

    const tenantAId = (
      await pool.query("INSERT INTO tenants (name, slug) VALUES ('A', 'rls-a') RETURNING id")
    ).rows[0].id as string;
    const tenantBId = (
      await pool.query("INSERT INTO tenants (name, slug) VALUES ('B', 'rls-b') RETURNING id")
    ).rows[0].id as string;

    await withTenantContext(tenantBId, (client) =>
      client.query(
        "INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, 'x@b.test', 'hash', 'admin')",
        [tenantBId],
      ),
    );

    // Query tenant B's users while the session is scoped to tenant A: RLS
    // should return zero rows even though no WHERE clause filters by tenant.
    const rows = await withTenantContext(tenantAId, async (client) => {
      const result = await client.query('SELECT * FROM users');
      return result.rows;
    });

    expect(rows).toHaveLength(0);
  });
});

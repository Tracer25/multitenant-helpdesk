import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { createTestApp, resetTestData } from './helpers.js';

describe('auth', () => {
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

  it('signs up a tenant + admin user and returns a token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        tenantName: 'Acme Co',
        tenantSlug: 'acme',
        email: 'owner@acme.test',
        password: 'correct-horse-battery-staple',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.token).toBeTypeOf('string');
    expect(body.user.role).toBe('admin');
    expect(body.tenant.slug).toBe('acme');
  });

  it('rejects a duplicate tenant slug', async () => {
    const payload = {
      tenantName: 'Acme Co',
      tenantSlug: 'acme',
      email: 'owner@acme.test',
      password: 'correct-horse-battery-staple',
    };
    await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload });
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload });
    expect(res.statusCode).toBe(409);
  });

  it('logs in with correct credentials and rejects wrong ones', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        tenantName: 'Acme Co',
        tenantSlug: 'acme',
        email: 'owner@acme.test',
        password: 'correct-horse-battery-staple',
      },
    });

    const good = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { tenantSlug: 'acme', email: 'owner@acme.test', password: 'correct-horse-battery-staple' },
    });
    expect(good.statusCode).toBe(200);
    expect(good.json().token).toBeTypeOf('string');

    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { tenantSlug: 'acme', email: 'owner@acme.test', password: 'wrong-password' },
    });
    expect(bad.statusCode).toBe(401);
  });

  it('rejects /me without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(res.statusCode).toBe(401);
  });
});

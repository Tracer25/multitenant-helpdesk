import pg from 'pg';
import { runner } from 'node-pg-migrate';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';

const TEST_DB_NAME = process.env.TEST_DB_NAME ?? 'helpdesk_test';
const ADMIN_DATABASE_URL =
  process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://helpdesk:helpdesk@localhost:5432/postgres';
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? `postgres://helpdesk:helpdesk@localhost:5432/${TEST_DB_NAME}`;

const DUPLICATE_DATABASE = '42P04';
let migrated = false;

async function ensureTestDatabase(): Promise<void> {
  if (migrated) return;

  const admin = new pg.Client({ connectionString: ADMIN_DATABASE_URL });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  } catch (err) {
    if ((err as { code?: string }).code !== DUPLICATE_DATABASE) throw err;
  } finally {
    await admin.end();
  }

  const migrationsDir = path.resolve(fileURLToPath(new URL('../migrations', import.meta.url)));
  await runner({
    databaseUrl: TEST_DATABASE_URL,
    dir: migrationsDir,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    log: () => {},
  });
  migrated = true;
}

/**
 * Sets process.env before dynamically importing the app so config.ts (which
 * reads env vars at module-evaluation time) picks up the test database.
 * A static top-level import would resolve too early for this to work.
 */
export async function createTestApp(): Promise<{ app: FastifyInstance; pool: pg.Pool }> {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';
  await ensureTestDatabase();

  const { buildApp } = await import('../src/app.js');
  const { pool } = await import('../src/db.js');
  const app = await buildApp();
  return { app, pool };
}

export async function resetTestData(pool: pg.Pool): Promise<void> {
  await pool.query('TRUNCATE tenants, users, tickets, ticket_comments RESTART IDENTITY CASCADE');
}

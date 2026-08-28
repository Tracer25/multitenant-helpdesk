export const shorthands = undefined;

export async function up(pgm) {
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  pgm.sql(`
    CREATE TABLE tenants (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  pgm.sql(`
    CREATE TABLE users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'agent', 'customer')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, email)
    );
  `);

  pgm.sql(`
    CREATE TABLE tickets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      created_by UUID NOT NULL REFERENCES users(id),
      assigned_to UUID REFERENCES users(id),
      subject TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
      priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  pgm.sql(`
    CREATE TABLE ticket_comments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      author_id UUID NOT NULL REFERENCES users(id),
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  pgm.sql(`CREATE INDEX idx_users_tenant ON users(tenant_id);`);
  pgm.sql(`CREATE INDEX idx_tickets_tenant ON tickets(tenant_id);`);
  pgm.sql(`CREATE INDEX idx_ticket_comments_tenant_ticket ON ticket_comments(tenant_id, ticket_id);`);

  // Row-Level Security: every tenant-scoped table is isolated by the
  // `app.tenant_id` session variable set per request (see src/db.ts).
  // FORCE ROW LEVEL SECURITY so isolation holds even for the table-owning
  // role the app connects as -- in a real deployment the app role should
  // additionally be a non-owner role, but FORCE keeps the demo honest
  // without provisioning a second DB role.
  for (const table of ['users', 'tickets', 'ticket_comments']) {
    pgm.sql(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    pgm.sql(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
    pgm.sql(`
      CREATE POLICY tenant_isolation ON ${table}
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
    `);
  }
}

export async function down(pgm) {
  pgm.sql('DROP TABLE IF EXISTS ticket_comments CASCADE;');
  pgm.sql('DROP TABLE IF EXISTS tickets CASCADE;');
  pgm.sql('DROP TABLE IF EXISTS users CASCADE;');
  pgm.sql('DROP TABLE IF EXISTS tenants CASCADE;');
}

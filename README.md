# Multi-Tenant Helpdesk on EKS

A multi-tenant helpdesk/ticketing API built to demonstrate production cloud/DevOps
practices end to end: Postgres row-level security for tenant isolation, a
containerized Node.js/TypeScript service, Kubernetes packaging via Helm,
AWS infrastructure as Terraform, and a CI/CD pipeline over GitHub Actions.

## Status

- [x] **Phase 1 — API + local dev loop.** Fastify/TS API, Postgres schema with
      RLS, JWT auth, tests. Verified locally: build, lint, typecheck, 6/6
      tests, and a live end-to-end smoke test all pass against a real
      Postgres.
- [x] **Phase 2 — Helm chart.** Written and validated with `helm lint` +
      `helm template` (both the default AWS values and the local
      `values-kind.yaml` override render correctly). **Not yet applied to an
      actual cluster** — this sandbox has no working container runtime
      (Docker Desktop/colima both fail to start a VM here), so `kind`
      validation is still pending on your machine; see below.
- [x] **Phase 3 — Terraform for EKS.** VPC, EKS cluster + node group, ECR,
      GitHub OIDC role, IRSA roles all written. **Not run** — no `terraform`
      CLI in this sandbox to even `init`/`validate`, and `apply` provisions
      real, billed AWS resources that need your explicit go-ahead regardless.
      Review it carefully before running.
- [x] **Phase 4 — CI/CD.** `.github/workflows/ci.yml` and `cd.yml` written.
      Untested (no GitHub remote yet) — wire up repo variables per the
      comment at the top of `cd.yml` once Phase 3 is applied.
- [ ] Phase 5 — Deploy + verify on real EKS.
- [ ] Phase 6 — Observability (stretch).

## Architecture decisions

| Decision | Choice | Why |
|---|---|---|
| API framework | Fastify + TypeScript | Async-native, JSON-schema request validation built in |
| Tenancy model | Shared schema, `tenant_id` + Postgres **Row-Level Security** | Simplest to build solo; RLS makes isolation a DB-enforced security boundary, not just an app-level `WHERE` clause |
| Migrations | `node-pg-migrate` (raw SQL via `pgm.sql`) | Needed anyway for `CREATE POLICY` / RLS statements; schema stays fully visible in the repo |
| Auth | Hand-rolled JWT + bcrypt (`bcryptjs`) | No Cognito/Auth0 — deliberately shows the primitives instead of outsourcing them. Tradeoff: no password reset, MFA, or social login |
| Packaging | Helm chart | Templated per-env values, single `helm upgrade` deploy step |
| IaC | Terraform (`terraform-aws-modules/vpc`, `.../eks`) | Real infra without hand-rolling boilerplate |
| Secrets | AWS Secrets Manager + External Secrets Operator, synced to a K8s `Secret` via IRSA | No plaintext secrets in manifests or git, no static AWS keys |
| CI/CD | GitHub Actions only (no ArgoCD/Flux) | Right call at team scale; unnecessary operational surface for a solo repo — noted as a "next step" instead |

## Tenant isolation

Every tenant-scoped table (`users`, `tickets`, `ticket_comments`) has Postgres RLS
enabled and **forced** (`FORCE ROW LEVEL SECURITY`, so isolation holds even for
the app's own DB role). Each request opens a transaction, sets the
`app.tenant_id` session variable from the JWT's `tenantId` claim via
`set_config()` (parameterized, not string-interpolated), and every query in
that transaction is scoped by the RLS policy:

```sql
CREATE POLICY tenant_isolation ON tickets
USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

See [api/src/db.ts](api/src/db.ts) (`withTenantContext`) and
[api/test/tenant-isolation.test.ts](api/test/tenant-isolation.test.ts), which
proves isolation holds at the database layer directly, independent of any
app-level `WHERE tenant_id = ...` filtering.

## Running locally

```bash
docker compose up --build
# API on http://localhost:3000, migrations run automatically via the
# one-shot `migrate` service before `api` starts.
```

Or without Docker, against any local Postgres:

```bash
cd api
cp .env.example .env   # edit DATABASE_URL/JWT_SECRET as needed
npm install
npm run migrate:up
npm run dev             # http://localhost:3000
```

Smoke test:

```bash
curl http://localhost:3000/healthz
curl -X POST http://localhost:3000/api/v1/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"tenantName":"Acme Co","tenantSlug":"acme","email":"owner@acme.test","password":"correct-horse-battery-staple"}'
```

## Tests

```bash
cd api
npm test
```

Tests spin up (or reuse) a `helpdesk_test` database via `node-pg-migrate`'s
programmatic API and run against a real Postgres — no mocked DB layer,
since the thing being tested (RLS policies) only means something against a
real database.

## Validating Phase 2 on your machine (kind, no AWS)

Once Docker is running:

```bash
kind create cluster --name helpdesk
docker build -t helpdesk-api:local ./api
kind load docker-image helpdesk-api:local --name helpdesk
kubectl create secret generic helpdesk-api-secret \
  --from-literal=DATABASE_URL=postgres://helpdesk:helpdesk@postgres:5432/helpdesk \
  --from-literal=JWT_SECRET=dev-only-change-me
helm install helpdesk-api ./helm/helpdesk-api -f helm/helpdesk-api/values-kind.yaml
kubectl get pods -w   # wait for Running + Ready
kubectl port-forward svc/helpdesk-api 3000:80
curl http://localhost:3000/healthz
```

(There's no Postgres in the kind cluster by default — either apply a
throwaway `postgres` Deployment/Service first, or point `DATABASE_URL` at a
reachable external instance for this smoke test.)

## Deploying to real AWS (Phase 3+, costs money)

1. `cd infra/terraform/envs/dev && cp terraform.tfvars.example terraform.tfvars`
   and fill in your GitHub repo.
2. `terraform init && terraform plan` — review carefully.
3. `terraform apply` — **creates real, billed AWS resources** (EKS control
   plane ~$0.10/hr + 2 `t3.medium` nodes + NAT gateway). Only run this when
   you're ready to pay for it.
4. Set the GitHub repository variables `cd.yml` expects, from
   `terraform output`: `AWS_REGION`, `AWS_ROLE_ARN`
   (`github_actions_role_arn`), `EKS_CLUSTER_NAME` (`cluster_name`),
   `ECR_REPOSITORY` (`ecr_repository_url`).
5. Install the AWS Load Balancer Controller and External Secrets Operator
   into the cluster (not managed by this repo's Helm chart — both are
   cluster-wide add-ons installed once, from their own upstream charts) and
   annotate their service accounts with `external_secrets_role_arn` /
   set up IRSA per their docs, before setting `ingress.enabled: true` /
   `externalSecret.enabled: true`.
6. Create the Secrets Manager secret at the path in
   `externalSecret.remoteRef` (`helpdesk/dev/api` by default) as JSON:
   `{"DATABASE_URL": "...", "JWT_SECRET": "..."}`.
7. Push to `main` — `cd.yml` builds, pushes to ECR, and runs
   `helm upgrade --install`.

## Repo layout

```
api/                    Fastify + TS source, migrations, tests, Dockerfile
helm/helpdesk-api/       Helm chart (Phase 2)
infra/terraform/envs/dev/  VPC, EKS, ECR, IRSA (Phase 3 — not applied without confirmation)
.github/workflows/       CI/CD (Phase 4)
docker-compose.yml        Local API + Postgres
```

## API surface

| Method | Path | Auth |
|---|---|---|
| POST | `/api/v1/auth/signup` | — |
| POST | `/api/v1/auth/login` | — |
| GET | `/api/v1/auth/me` | any |
| GET/POST | `/api/v1/tickets` | any |
| GET/PATCH | `/api/v1/tickets/:id` | any |
| DELETE | `/api/v1/tickets/:id` | admin |
| GET/POST | `/api/v1/tickets/:id/comments` | any |
| GET | `/api/v1/users` | admin |
| PATCH | `/api/v1/users/:id` | admin |
| GET | `/healthz` / `/readyz` | — |

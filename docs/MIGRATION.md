# Homatch — Migration Guide: How to Leave the Builder

This document describes the complete process to move Homatch from the current
builder environment to any self-hosted VPS or managed hosting provider.

**No proprietary business logic is locked in the builder.** All critical code
is in the source repository. This is guaranteed by the Zero Vendor Lock-in
architectural principle.

---

## Step 1: Export Source Code via Git

```bash
# If a Git remote is already configured:
git remote -v
git push origin main

# If no remote yet, connect to GitHub:
git remote add origin https://github.com/YOUR_ORG/homatch.git
git push -u origin main
```

The repository contains:
- `src/` — complete frontend (React + TypeScript + Tailwind)
- `supabase/functions/` — all Edge Functions (Deno)
- `supabase/functions/_shared/jobs.ts` — all exportable job functions
- `supabase/migrations/` — all database migrations in order
- `worker/scheduler.ts` — standalone portable scheduler
- `Dockerfile` + `docker-compose.yml` — deployment artifacts
- `.env.example` — complete environment variable reference
- `docs/` — this documentation

---

## Step 2: Export the Database

### From Supabase Cloud

```bash
# Install Supabase CLI
npm install -g supabase
supabase login

# Export schema + data
supabase db dump --project-ref YOUR_PROJECT_REF > homatch-schema.sql
supabase db dump --project-ref YOUR_PROJECT_REF --data-only > homatch-data.sql

# Export storage files (property photos)
supabase storage cp --recursive ss://property-photos ./photos-backup/
```

### Tables to verify in export

All tables must be present:
- `users`, `user_preferences`
- `markets`, `query_packs`, `source_registry`
- `properties`, `property_facts`, `property_photos`, `property_imports`
- `search_profiles`, `matching_campaigns`
- `raw_signals`, `intent_profiles`
- `matches`, `match_unlocks`
- `credit_accounts`, `credit_ledger`
- `payments`, `cost_events`
- `activity_events`, `notifications`
- `admin_settings`, `provider_health`

---

## Step 3: Export Files (Private Photos)

Private property photos are stored in Supabase Storage bucket `property-photos`.
These must be exported and re-uploaded to the new storage provider.

```bash
# Export from Supabase
supabase storage cp --recursive ss://property-photos ./photos-backup/

# Upload to new S3-compatible storage
aws s3 sync ./photos-backup/ s3://homatch-photos/
# or MinIO:
mc mirror ./photos-backup/ minio/homatch-photos/
```

Photo metadata (paths, visibility, property associations) is in `property_photos` table.
No paths need to change if bucket name stays the same. If the bucket name changes,
run: `UPDATE property_photos SET storage_path = REPLACE(storage_path, 'old-bucket', 'new-bucket');`

---

## Step 4: Provision New Environment

### Option A: VPS with Docker Compose

```bash
# On a fresh Ubuntu 22.04 VPS:
apt update && apt upgrade -y
apt install -y docker.io docker-compose-plugin git curl

# Clone repository
git clone https://github.com/YOUR_ORG/homatch.git
cd homatch

# Configure environment
cp .env.example .env
nano .env   # fill in all values

# Start all services
docker compose up -d --build
```

### Option B: Railway / Render / Fly.io

```bash
# Connect repo to the platform (each has its own CLI/dashboard)
# Set all .env variables via platform secrets UI
# Dockerfile is present — platform auto-detects and builds

# For the worker, create a separate service pointing to:
# Command: deno run --allow-net --allow-env --allow-read worker/scheduler.ts
```

### Option C: Bare metal Node + PostgreSQL

```bash
# Install Node 20, pnpm, Deno, PostgreSQL 16
pnpm install && pnpm run build
serve -s dist -l 3000 &
deno run --allow-net --allow-env --allow-read worker/scheduler.ts &
```

---

## Step 5: Restore Database

```bash
# Create new PostgreSQL database
createdb -U postgres homatch

# Apply schema (migrations in order)
for f in supabase/migrations/*.sql; do
  psql -U postgres -d homatch -f "$f"
  echo "Applied $f"
done

# Import exported data
psql -U postgres -d homatch < homatch-data.sql
```

---

## Step 6: Environment Variables Migration

1. Copy `.env.example` to `.env` on new host
2. Fill in the same values from the old `.env`
3. **Rotate secrets** — generate new values for:
   - `SUPABASE_SERVICE_ROLE_KEY` (or equivalent DB service secret)
   - `PAYMENT_WEBHOOK_SECRET` (must match new webhook endpoint URL)
   - Any API keys that should be rotated as a security measure on migration

---

## Step 7: Auth System

Homatch uses Supabase Auth with email/password. The `users` table stores:
- `id` — Homatch internal UUID (used in all relations)
- `auth_id` — Supabase auth.uid() (foreign key to auth.users)

### Option A: Stay on Supabase Auth (simplest)
Point new deployment at same Supabase project — auth works with no changes.

### Option B: Self-hosted Supabase
```bash
supabase self-host # follow official Supabase self-hosting docs
```
Auth users export via `supabase db dump` includes `auth.users`.

### Option C: Replace with custom JWT auth
1. Create a new auth table or use a different provider (Auth0, Clerk, etc.)
2. Update `AuthContext.tsx` to use the new provider's SDK
3. Replace `supabase.auth.getUser()` calls in Edge Functions with JWT verification
4. All business logic depends only on `user_id` (Homatch UUID) — update lookup logic
5. The `auth_id` field in `users` table must be updated to match new auth provider UIDs

**The Homatch data model uses internal `user.id` UUID throughout, minimizing auth dependency.**

---

## Step 8: Payment Provider Migration

Stripe webhooks must be re-registered on the new domain:

1. In Stripe Dashboard → Webhooks → add new endpoint:
   `https://NEW_DOMAIN/functions/v1/payment-webhook`
2. Copy the new Signing Secret → update `PAYMENT_WEBHOOK_SECRET` in `.env`
3. Disable old webhook endpoint
4. Test with Stripe CLI: `stripe trigger checkout.session.completed`

**The payment system is independent from the Ledger/Pricing/Unlock logic.**
Switching from Stripe to another provider only requires updating the `payment-webhook`
Edge Function and `credits-topup` Edge Function — no changes to credit accounting.

---

## Step 9: Email Provider Migration

If using Resend:
1. Register new domain for email sending in Resend dashboard
2. Update DNS records (DKIM, SPF, DMARC)
3. Set `RESEND_API_KEY` in `.env`

If switching to another provider (SendGrid, Postmark, etc.):
1. Update email-sending code in Edge Functions (search for `resend.com`)
2. Replace with new provider's API call
3. No changes to notification logic

---

## Step 10: DNS Cutover

```bash
# Test new deployment on IP directly before DNS switch
curl -H "Host: homatch.com" http://NEW_SERVER_IP/

# Update DNS A-record to new server IP
# TTL reduction before cutover: set to 60 seconds
# After DNS propagates: set TTL back to 3600

# Verify SSL certificate on new server
openssl s_client -connect NEW_SERVER_IP:443 -servername homatch.com
```

---

## Portability Verification Checklist

Before completing migration, verify:

- [ ] Source code exported to Git
- [ ] All 20 tables present in database export
- [ ] Private photos exported from storage
- [ ] `supabase/migrations/` applies cleanly on fresh PostgreSQL
- [ ] `.env.example` has every variable needed to run
- [ ] Worker/scheduler starts and runs all jobs
- [ ] Payment webhook registered on new URL
- [ ] Admin user (`is_admin = true`) confirmed accessible
- [ ] E2E test: add property → match → unlock → admin margin view
- [ ] Provider health page shows correct statuses (not mock as real)

---

## What IS dependent on Supabase

| Feature | Supabase dependency | Replacement path |
|---|---|---|
| Database | PostgreSQL (standard) | Any PostgreSQL 15+ |
| Auth | Supabase Auth | Custom JWT, Auth0, Clerk |
| Storage | Supabase Storage | S3, MinIO, Cloudflare R2 |
| Edge Functions | Deno runtime | Any Deno/Node server |
| Realtime | Supabase Realtime | Pusher, Ably, or polling |

All business logic (matching, pricing, credits, jobs, admin) has zero Supabase-specific code.

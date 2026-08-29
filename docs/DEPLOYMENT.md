# Homatch — Deployment Guide

## Prerequisites

- Linux server (Ubuntu 22.04+ / Debian 12+ recommended)
- Docker 24+ and Docker Compose v2
- Domain name with DNS A-record pointing to server IP
- Git access to source repository

---

## 1. Environment Variables

Copy `.env.example` to `.env` and fill in all values:

```bash
cp .env.example .env
nano .env
```

### Required variables

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (backend only, never expose to client) |
| `APP_URL` | Full public URL (e.g. `https://homatch.com`) |

### Provider credentials (set to enable real mode)

| Variable | Provider | Required for |
|---|---|---|
| `DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD` | DataForSEO | Market source discovery |
| `APIFY_API_TOKEN` + `APIFY_*_ACTOR_ID` | Apify | Social signal collection |
| `OPENAI_API_KEY` | OpenAI | Intent classification |
| `ZENROWS_API_KEY` | ZenRows | Extraction fallback |
| `SCRAPINGBEE_API_KEY` | ScrapingBee | Extraction fallback |
| `PAYMENT_PROVIDER_SECRET` + `PAYMENT_WEBHOOK_SECRET` | Stripe | Payments |
| `RESEND_API_KEY` | Resend | Email notifications |

All unconfigured providers run in MOCK mode — no real charges, no real data.

---

## 2. Database Setup

### Supabase (cloud, default)

Migrations are applied via the Supabase CLI or dashboard:

```bash
# Install Supabase CLI
npm install -g supabase

# Apply all migrations
supabase db push --project-ref YOUR_PROJECT_REF
```

Migrations are located in `supabase/migrations/` in numbered order.

### Self-hosted PostgreSQL (post-migration path)

```bash
# Create database
createdb -U postgres homatch

# Apply migrations in order
for f in supabase/migrations/*.sql; do
  psql -U postgres -d homatch -f "$f"
done
```

---

## 3. Build and Start

### With Docker Compose (recommended)

```bash
# Build and start all services
docker compose up -d --build

# View logs
docker compose logs -f app
docker compose logs -f worker

# Stop all services
docker compose down
```

### Without Docker (manual)

```bash
# Install dependencies
npm install -g pnpm
pnpm install

# Build frontend
pnpm run build

# Serve frontend
npm install -g serve
serve -s dist -l 3000

# Start worker (requires Deno)
deno run --allow-net --allow-env --allow-read worker/scheduler.ts
```

---

## 4. Workers and Scheduler

The worker (`worker/scheduler.ts`) runs all background jobs:

| Job | Schedule | Purpose |
|---|---|---|
| `discoverMarketSources` | Every 6 hours | Find new FB/TG/VK sources via DataForSEO |
| `collectSourceUpdates` | Every 30 min | Collect new social posts via Apify |
| `classifyCandidateSignals` | Every 15 min | AI-classify pending signals via OpenAI |
| `runMatching` | Every 20 min | Match properties to intent profiles |
| `sendNotifications` | Every 5 min | In-app notifications for new matches |
| `aggregateProviderCosts` | Every hour | Log COGS summary |
| `cleanupExpiredData` | Every 24 hours | Delete noise/rejected signals per retention rules |

All jobs enforce spend caps before issuing paid API calls. At cap, job skips gracefully — no errors, no retries.

### Running a single job manually

```bash
deno eval "
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { cleanupExpiredData } from './supabase/functions/_shared/jobs.ts';
const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
const r = await cleanupExpiredData({ supabase });
console.log(r);
" --allow-net --allow-env --allow-read
```

---

## 5. Storage

### Supabase Storage (default)

No additional configuration. Private photos are stored in the `property-photos` bucket with RLS policies enforcing ownership.

### S3-Compatible Storage (migration path)

Set in `.env`:
```
STORAGE_PROVIDER=s3
S3_ENDPOINT=https://s3.amazonaws.com
S3_BUCKET=homatch-photos
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_REGION=us-east-1
```

For MinIO (self-hosted), start with the `storage` profile:
```bash
docker compose --profile storage up -d
```

---

## 6. SSL and Domain

### With Nginx + Certbot

```bash
# Install Certbot
apt install certbot python3-certbot-nginx

# Obtain certificate
certbot --nginx -d homatch.com -d www.homatch.com

# Copy certs for Docker Nginx
cp /etc/letsencrypt/live/homatch.com/fullchain.pem nginx/certs/cert.pem
cp /etc/letsencrypt/live/homatch.com/privkey.pem nginx/certs/key.pem
```

Sample `nginx/nginx.conf`:
```nginx
server {
  listen 80;
  server_name homatch.com www.homatch.com;
  return 301 https://$host$request_uri;
}
server {
  listen 443 ssl;
  server_name homatch.com www.homatch.com;
  ssl_certificate /etc/nginx/certs/cert.pem;
  ssl_certificate_key /etc/nginx/certs/key.pem;
  location / {
    proxy_pass http://app:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

---

## 7. Webhook Configuration

### Stripe

1. In Stripe Dashboard → Webhooks → Add endpoint: `https://homatch.com/functions/v1/payment-webhook`
2. Select events: `checkout.session.completed`, `payment_intent.succeeded`
3. Copy Signing Secret → set as `PAYMENT_WEBHOOK_SECRET` in `.env`
4. Redeploy Edge Function: `supabase functions deploy payment-webhook`

---

## 8. Backup and Restore

### Database backup

```bash
# Supabase cloud — export via CLI
supabase db dump --project-ref YOUR_REF > backup-$(date +%Y%m%d).sql

# Self-hosted PostgreSQL
pg_dump -U homatch homatch > backup-$(date +%Y%m%d).sql

# Compress
gzip backup-$(date +%Y%m%d).sql
```

### Database restore

```bash
gunzip backup-20260101.sql.gz
psql -U homatch homatch < backup-20260101.sql
```

### Storage backup

```bash
# Download all private photos from Supabase Storage
supabase storage cp --recursive ss://property-photos ./backup/photos/

# Or from S3-compatible storage
aws s3 sync s3://homatch-photos ./backup/photos/
```

### Automated daily backup (cron)

```cron
0 2 * * * pg_dump -U homatch homatch | gzip > /backups/homatch-$(date +\%Y\%m\%d).sql.gz
```

---

## 9. Health Checks

```bash
# App health
curl http://localhost:3000/

# Database health
pg_isready -U homatch

# Worker logs
docker compose logs worker --tail=50

# Edge Function logs (Supabase)
supabase functions logs provider-health-check
```

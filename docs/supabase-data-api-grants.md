# Supabase Data API grants — October 30, 2026

Supabase will no longer auto-GRANT API access for **new** tables in `public` on existing projects. Existing table privileges are unchanged. This is not an outage and does not require bulk grants on production.

## Mandatory rule for new migrations

In the SAME migration that creates each `public` table, add explicit grants according to its intended API callers, and define RLS policies separately. Never blindly copy `GRANT ALL TO anon, authenticated` into financial, admin, token, or private tables.

```sql
create table public.example_user_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id)
);
alter table public.example_user_items enable row level security;
create policy "owner reads" on public.example_user_items
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "owner inserts" on public.example_user_items
  for insert to authenticated with check ((select auth.uid()) = user_id);
grant select, insert on table public.example_user_items to authenticated;
grant select, insert, update, delete on table public.example_user_items to service_role;
-- No anon grant: anonymous callers must not reach this table.
```

For server-only tables, explicitly grant only `service_role` the required operations and leave `anon`/`authenticated` without grants. Remember that `GRANT` enables the API role to access a table but RLS governs row visibility; both are required for user-facing tables. Consider sequence privileges where identities use sequences; prefer UUID identities.

## Required release checks

1. Inspect each migration adding or recreating a `public` table for explicit `GRANT ... ON ... TO ...` clauses (or intentional service-only grants).
2. Test the actual API roles in a disposable branch or local reset: authenticated permitted paths succeed; anon and cross-user requests are denied. `service_role` is never exposed to clients.
3. Test from an empty schema/branch, not only on the long-lived production project, since legacy grants may hide omissions.
4. Do not change historical production grants, RLS, or database-wide default privileges just to address this announcement.

Reference: https://github.com/orgs/supabase/discussions/45329

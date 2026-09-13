-- Communications — make the outreach_* tables writable by their owners.
--
-- THE DEFECT
--
-- outreach_campaigns, outreach_contacts, outreach_contact_lists and
-- outreach_sends each carry an owner_id with:
--
--   FOREIGN KEY (owner_id) REFERENCES auth.users(id)   -- wants auth.uid()
--   RLS ... USING/WITH CHECK (owner_id = get_user_id()) -- wants public.users.id
--
-- and get_user_id() is `SELECT id FROM public.users WHERE auth_id = auth.uid()`.
-- In this database public.users.id <> public.users.auth_id for every single
-- row, so the two conditions are mutually unsatisfiable:
--
--   owner_id = auth.uid()   -> passes the FK, REJECTED by RLS
--   owner_id = users.id     -> passes RLS, REJECTED by the FK
--
-- Verified by running both inserts inside a transaction as role `authenticated`
-- with request.jwt.claims set to a real user:
--
--   "new row violates row-level security policy for table outreach_campaigns"
--   "insert or update ... violates foreign key constraint
--    outreach_campaigns_user_id_fkey"
--
-- So no authenticated user has ever been able to create a campaign, a contact
-- or a list. That is the production "campaign creation failed" error, and it
-- is why contact import had nothing to show. All four tables contain zero
-- rows, which is the other half of the proof and means there is nothing to
-- migrate.
--
-- WHICH SIDE IS WRONG
--
-- auth.uid() is correct here, on three independent grounds:
--
--   1. It is what the foreign keys already demand, and those constraints
--      predate the Communications work (the constraint is still named
--      outreach_campaigns_user_id_fkey, from when the column was user_id).
--   2. Every comm_* table in the Communications schema uses auth.uid()
--      (comm_agents, comm_conversations, comm_messages, comm_extractions,
--      comm_whatsapp_templates, comm_channel_accounts), and those work —
--      comm_agents holds a real row owned by an auth.users id.
--   3. The service layer has one identity helper, and it returns
--      supabase.auth.getUser().id.
--
-- Changing the four policies is therefore an alignment, not a widening. The
-- predicate stays "this row belongs to the caller"; only the spelling of
-- "the caller" changes, from an identity the FK forbids to the one it
-- requires. Tenant isolation is unchanged: owner_id = auth.uid() is still an
-- exact per-account match, and the admin read policies are left alone.

-- ── outreach_campaigns ──────────────────────────────────────────────────────
drop policy if exists owners_manage_outreach_campaigns on public.outreach_campaigns;
create policy owners_manage_outreach_campaigns on public.outreach_campaigns
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- ── outreach_contacts ───────────────────────────────────────────────────────
drop policy if exists owners_manage_outreach_contacts on public.outreach_contacts;
create policy owners_manage_outreach_contacts on public.outreach_contacts
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- ── outreach_contact_lists ──────────────────────────────────────────────────
drop policy if exists owners_manage_outreach_contact_lists on public.outreach_contact_lists;
create policy owners_manage_outreach_contact_lists on public.outreach_contact_lists
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- ── outreach_sends ──────────────────────────────────────────────────────────
-- Read-only for owners; writes stay with the service role that does the
-- sending. Only the identity spelling changes.
drop policy if exists owners_read_outreach_sends on public.outreach_sends;
create policy owners_read_outreach_sends on public.outreach_sends
  for select to authenticated
  using (owner_id = (select auth.uid()));

-- Homatch — stop outreach from contacting the same person twice.
--
-- WHAT WAS FOUND
--
-- outreach-send's own header comment promises: "it never re-sends to a contact
-- that already has a non-failed outreach_sends row." It keeps that promise the
-- way a lot of code does -- by reading first and hoping:
--
--   const { data: alreadySent } = await supabase.from('outreach_sends')
--     .select('contact_id').eq('campaign_id', campaign_id).neq('status','FAILED');
--   ... pick 40 contacts not in that list ...
--   ... call the provider ...
--   ... THEN insert the outreach_sends row ...
--
-- Between the read and the insert there is nothing. Two overlapping calls --
-- a double-tapped Launch button, or the documented "call again with the same
-- campaign_id to continue" pattern arriving before the first call finished --
-- both read an empty exclusion set, both select the same first 40 contacts,
-- and both dial them. The provider call happens BEFORE the row that was
-- supposed to prevent it exists.
--
-- What that costs is not an inconsistent counter. It is a real person receiving
-- the same marketing email twice, or being phoned twice by an AI agent, and
-- the account being billed twice for it. For SMS and voice that is also the
-- kind of thing regulators count.
--
-- There was no unique index, so the database would not have stopped it either.
--
-- SECOND FINDING: duplicate contacts.
--
-- contact-import de-duplicates within a single uploaded file, sets
-- is_duplicate = true on the losers -- and then inserts them anyway. Nothing
-- filters on is_duplicate afterwards; outreach-send checks suppressed,
-- do_not_contact, do_not_call and unsubscribed, but not that. So the same
-- address, flagged as a duplicate at import time, is still contacted twice.
-- Re-uploading the same file into the same list duplicates the entire list,
-- because the de-dup set is per-invocation and starts empty every time.
--
-- THIRD FINDING: rationale is the wrong type.
--
-- property_community_recommendations.rationale is `text`, but all three
-- writers store an object ({location_match, type_match, ..., summary}) and the
-- reader does `rec.rationale?.summary`. types.ts declares it
-- Record<string, unknown>. Every producer and every consumer in the codebase
-- treats this column as jsonb; only the column disagrees, so the explanation
-- of WHY a community was recommended never reaches the customer.
--
-- WHAT THIS MIGRATION DOES
--
-- Constraints only -- the enforcement that makes the application-side fix in
-- outreach-send possible. It claims a contact by inserting a QUEUED row BEFORE
-- dialling; the unique index below is what makes that claim atomic, so the
-- loser of a race gets a 23505 and skips instead of sending.
--
-- Safe to apply: outreach_sends, outreach_contacts, outreach_contact_lists,
-- outreach_campaigns and property_community_recommendations are all empty in
-- production (verified before writing this), so no existing row can violate
-- any of the new indexes and no existing value needs converting.

/* ---------------- one send per contact per campaign ---------------- */

-- Partial on purpose. A genuine provider failure leaves a FAILED row, and a
-- later retry must be allowed to make a new attempt for that contact; what
-- must never happen twice is a send that did NOT fail. This matches exactly
-- the predicate outreach-send already uses to build its exclusion list
-- (.neq('status','FAILED')), so the index and the query agree.
create unique index if not exists outreach_sends_campaign_contact_uidx
  on public.outreach_sends (campaign_id, contact_id)
  where contact_id is not null and status <> 'FAILED';

/* ---------------- one contact per address per list ---------------- */

-- Case-insensitive for email, because Alice@x.com and alice@x.com are one
-- inbox. Phones are already normalized to E.164 by contact-import before they
-- reach this column.
create unique index if not exists outreach_contacts_list_email_uidx
  on public.outreach_contacts (list_id, lower(email))
  where email is not null;

create unique index if not exists outreach_contacts_list_phone_uidx
  on public.outreach_contacts (list_id, phone)
  where phone is not null;

/* ---------------- rationale is an object, not a string ---------------- */

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'property_community_recommendations'
      and column_name = 'rationale'
      and data_type = 'text'
  ) then
    -- The table is empty, so the USING clause never actually runs. It is
    -- written to be correct anyway: a stored value that is already valid JSON
    -- keeps its structure, and anything else is preserved as a JSON string
    -- rather than discarded.
    alter table public.property_community_recommendations
      alter column rationale type jsonb
      using (
        case
          when rationale is null then null
          when rationale ~ '^\s*[{\[]' then rationale::jsonb
          else to_jsonb(rationale)
        end
      );
  end if;
end $$;

/* ---------------- campaign counters, derived not accumulated ----------------

   outreach-send updated its campaign counters with

     sent_count: (campaign.sent_count || 0) + sentCount

   where campaign.sent_count was read at the start of the invocation. Two
   overlapping batches both read the same starting value and the second write
   erases the first one's contribution -- the classic lost update, on the
   number the customer is shown as "how many people did we contact".

   outreach_sends is the record of what actually happened, so the counters are
   recomputed from it instead of accumulated. That is idempotent: calling this
   twice produces the same numbers, and a crashed batch cannot leave the
   counter permanently wrong.

   open_count, click_count, reply_count, complaint_count and
   unsubscribe_count are deliberately NOT touched here -- those come from
   provider webhooks and are not derivable from outreach_sends. */

create or replace function public.outreach_recompute_campaign_counters(p_campaign_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.outreach_campaigns c
     set sent_count      = s.sent,
         delivered_count = s.delivered,
         bounce_count    = s.bounced,
         cost_actual_usd = s.cost,
         updated_at      = now()
    from (
      select
        count(*) filter (where status <> 'FAILED')                          as sent,
        count(*) filter (where status in ('DELIVERED','COMPLETED'))         as delivered,
        count(*) filter (where status in ('BOUNCED','OPTED_OUT','SUPPRESSED')) as bounced,
        coalesce(sum(cost_usd), 0)                                         as cost
      from public.outreach_sends
      where campaign_id = p_campaign_id
    ) s
   where c.id = p_campaign_id;
end $$;

-- Callable only by the server. A campaign owner must not be able to rewrite
-- their own spend figure, and nothing in the frontend needs this.
revoke all on function public.outreach_recompute_campaign_counters(uuid) from public, anon, authenticated;
grant execute on function public.outreach_recompute_campaign_counters(uuid) to service_role;

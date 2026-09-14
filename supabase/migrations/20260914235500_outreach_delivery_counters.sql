-- HOMATCH — counters that can tell "sent" from "tried", and "all of it
-- failed" from "some of it failed".
--
-- sent_count counted every row that was not FAILED, which includes QUEUED --
-- a contact claimed but not yet dispatched. So a batch that crashed halfway
-- reported the whole audience as sent, and the number the campaign card shows
-- was the number of people the worker had got as far as thinking about.
--
-- failed_count did not exist at all, which is why a campaign where nine in
-- ten bounced was indistinguishable from one that worked: both were
-- COMPLETED, and the only count on the card was a sent_count that had
-- swallowed the failures.
--
-- Partially-failed is deliberately NOT a new status value. It is
-- sent_count > 0 and failed_count > 0, derived where it is displayed. A new
-- enum member would have to be understood by every query, guard and index
-- that already reads this column, and the fact is already in the two numbers.

create or replace function public.outreach_recompute_campaign_counters(p_campaign_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  update public.outreach_campaigns c
     set sent_count      = s.sent,
         delivered_count = s.delivered,
         bounce_count    = s.bounced,
         complaint_count = s.complained,
         failed_count    = s.failed,
         cost_actual_usd = s.cost,
         updated_at      = now()
    from (
      select
        /* DISPATCHED, not merely claimed. QUEUED is a contact this campaign
           has reserved and not yet contacted, and counting it as sent is how
           a half-finished batch came to report a finished one. */
        count(*) filter (where status in (
          'SENT','DELIVERED','COMPLETED','BOUNCED','COMPLAINED','OPTED_OUT','SUPPRESSED','DIALING','ANSWERED'
        )) as sent,
        count(*) filter (where status in ('DELIVERED','COMPLETED'))              as delivered,
        count(*) filter (where status in ('BOUNCED','OPTED_OUT','SUPPRESSED'))   as bounced,
        count(*) filter (where status = 'COMPLAINED')                            as complained,
        count(*) filter (where status = 'FAILED')                                as failed,
        coalesce(sum(cost_usd), 0)                                               as cost
      from public.outreach_sends
      where campaign_id = p_campaign_id
    ) s
   where c.id = p_campaign_id;
end $function$;

/*
 * Applying a provider delivery event to the send it belongs to.
 *
 * Keyed on the provider's own message id, which is the only identifier both
 * sides hold: the webhook knows nothing about our campaign or contact.
 *
 * Monotonic by design. Providers do not promise ordering, and a delivered
 * event arriving after a bounce must not overwrite the bounce -- the terminal
 * outcome is the true one, and a later, weaker event is dropped rather than
 * believed. Returns the campaign so the caller can recompute its counters.
 */
create or replace function public.outreach_apply_delivery_event(
  p_provider_message_id text,
  p_status text,
  p_raw text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_campaign uuid;
  v_current  text;
begin
  if p_provider_message_id is null or p_provider_message_id = '' then
    return null;
  end if;

  select campaign_id, status into v_campaign, v_current
    from public.outreach_sends
   where provider_message_id = p_provider_message_id
   order by created_at desc
   limit 1;

  if v_campaign is null then
    return null;
  end if;

  -- Terminal states stay put. BOUNCED and COMPLAINED are facts about what
  -- happened to the mail; DELIVERED arriving afterwards is late, not truer.
  if v_current in ('BOUNCED', 'COMPLAINED', 'OPTED_OUT', 'SUPPRESSED') then
    return v_campaign;
  end if;

  update public.outreach_sends
     set status              = p_status,
         provider_status_raw = coalesce(p_raw, provider_status_raw),
         delivered_at        = case when p_status = 'DELIVERED' then now() else delivered_at end,
         updated_at          = now()
   where provider_message_id = p_provider_message_id;

  return v_campaign;
end $function$;

revoke all on function public.outreach_apply_delivery_event(text, text, text) from public, anon, authenticated;

create index if not exists outreach_sends_provider_message_idx
  on public.outreach_sends (provider_message_id)
  where provider_message_id is not null;

-- A spam complaint had no status to be recorded under, so complaint_count
-- could only ever have been zero. Widened rather than repurposed: a complaint
-- is not a bounce, and a recipient who reports mail as spam is the single
-- most important signal a sending domain has.
alter table public.outreach_sends drop constraint if exists outreach_sends_status_check;
alter table public.outreach_sends add constraint outreach_sends_status_check
  check (status = any (array[
    'PENDING','QUEUED','SENDING','DIALING','RINGING','ANSWERED','SENT','DELIVERED','READ',
    'COMPLETED','FAILED','NO_ANSWER','BUSY','CANCELLED','BOUNCED','COMPLAINED','OPTED_OUT','SUPPRESSED'
  ]));

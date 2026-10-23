-- EMAIL MARKETING: provider DAILY capacity ceiling (2026-10-24).
--
-- The first full-access usage snapshot (2026-10-23 14:11 UTC, RESEND_MARKETING_API_KEY) shows the
-- Resend account on the FREE tier: 100 emails/day, 3,000/month, 3 domains. The day quota is shared
-- with authentication email, so marketing gets a provider-wide DAILY ceiling next to the monthly
-- one. email_quota_reserve is redefined unchanged except for that one added block.
-- Defaults (owner may change in Admin): 60/day and 2,000/month for marketing, leaving 40/day and
-- 1,000/month of the Free tier to authentication email. Both are re-sized when the plan changes.

/* Reserve quota for p_count emails. Idempotent on p_key while the reservation is open; a key
   whose reservation already settled is refused (STALE_KEY) and never re-grants allowance.
   Without overage consent only the included remainder (plus overage blocks already paid for)
   is granted. With consent, new overage blocks are counted as PENDING under the period lock
   and returned as blocksToBill; the caller charges them through email_quota_bill_overage
   BEFORE sending the overage part, or releases the reservation. */
create or replace function public.email_quota_reserve(
  p_owner uuid, p_count integer, p_key text, p_source text, p_allow_partial boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_existing public.email_quota_reservations;
  v_period_id uuid;
  v_period public.email_quota_periods;
  v_sub public.email_subscriptions;
  v_remaining integer;
  v_inc integer;
  v_over integer := 0;
  v_blocks integer := 0;
  v_paid integer;
  v_id uuid;
  v_cap numeric;
  v_window integer;
  v_room integer;
  v_cap_reason text;
begin
  if p_count is null or p_count <= 0 then raise exception 'INVALID_COUNT'; end if;
  if p_key is null or length(p_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;

  v_period_id := public.email_quota_current_period(p_owner);
  select * into v_period from public.email_quota_periods where id = v_period_id for update;
  select * into v_sub from public.email_subscriptions where owner_user_id = p_owner;

  /* Checked under the period lock: two calls with one key serialise here. */
  select * into v_existing from public.email_quota_reservations where idempotency_key = p_key;
  if found then
    if v_existing.status <> 'RESERVED' then
      return jsonb_build_object('reservationId', null, 'granted', 0, 'included', 0, 'overage', 0, 'blocksToBill', 0,
        'status', 'REFUSED', 'reason', 'STALE_KEY', 'duplicate', true);
    end if;
    return jsonb_build_object('reservationId', v_existing.id, 'granted', v_existing.included_part + v_existing.overage_part,
      'included', v_existing.included_part, 'overage', v_existing.overage_part,
      'blocksToBill', case when v_existing.blocks_state = 'PENDING' then v_existing.overage_blocks else 0 end,
      'status', v_existing.status, 'duplicate', true, 'periodId', v_existing.period_id);
  end if;

  v_remaining := greatest(v_period.included - v_period.used - v_period.reserved, 0);
  v_inc := least(p_count, v_remaining);
  v_paid := v_period.overage_blocks_billed + v_period.overage_blocks_pending;
  if p_count > v_inc and v_period.kind = 'MONTHLY' then
    if v_sub.overage_enabled and v_sub.overage_consented_at is not null then
      v_over := p_count - v_inc;
      if v_sub.overage_max_blocks is not null
         and ceil((v_period.overage_used + v_period.overage_reserved + v_over)::numeric / 1000)::integer > greatest(v_sub.overage_max_blocks, v_paid) then
        /* Over the customer's own cap: grant only what the cap (or blocks already paid) allows. */
        v_over := least(greatest(greatest(v_sub.overage_max_blocks, v_paid) * 1000 - v_period.overage_used - v_period.overage_reserved, 0), p_count - v_inc);
      end if;
    else
      /* Overage switched off: what is left of blocks already paid for this period still sends. */
      v_over := least(greatest(v_paid * 1000 - v_period.overage_used - v_period.overage_reserved, 0), p_count - v_inc);
    end if;
  end if;

  /*
   * SAFEGUARDS (admin_settings; 0 = off). A per-customer daily ceiling against bursts and abuse,
   * and a HOMATCH-wide monthly ceiling sized to the active Resend plan, so customer allowances
   * can never commit more sending than the provider account supports. Overage is trimmed first.
   * An open reservation counts in full; a settled or released one counts what it sent.
   */
  v_cap := nullif(public.billing_setting_num('email_marketing_tenant_daily_cap', 0), 0);
  if v_cap is not null then
    select coalesce(sum(case when status = 'RESERVED' then included_part + overage_part else coalesce(sent, 0) end), 0)::integer
      into v_window from public.email_quota_reservations
     where owner_user_id = p_owner and created_at >= date_trunc('day', now());
    v_room := greatest(v_cap::integer - v_window, 0);
    if v_inc + v_over > v_room then
      v_over := least(v_over, greatest(v_room - v_inc, 0));
      v_inc := least(v_inc, v_room);
      v_cap_reason := 'TENANT_DAILY_CAP';
    end if;
  end if;
  /* Provider DAILY ceiling (2026-10-24): the Resend account's day quota is shared with
     authentication email (sign-in, password reset). Marketing may only use part of it, so a
     campaign can never starve a customer's sign-in link. */
  v_cap := nullif(public.billing_setting_num('email_marketing_provider_daily_cap', 0), 0);
  if v_cap is not null then
    perform pg_advisory_xact_lock(hashtext('email_marketing_provider_daily_cap'));
    select coalesce(sum(case when status = 'RESERVED' then included_part + overage_part else coalesce(sent, 0) end), 0)::integer
      into v_window from public.email_quota_reservations
     where created_at >= date_trunc('day', now());
    v_room := greatest(v_cap::integer - v_window, 0);
    if v_inc + v_over > v_room then
      v_over := least(v_over, greatest(v_room - v_inc, 0));
      v_inc := least(v_inc, v_room);
      v_cap_reason := 'PROVIDER_DAILY_CAPACITY';
    end if;
  end if;
  v_cap := nullif(public.billing_setting_num('email_marketing_provider_monthly_cap', 0), 0);
  if v_cap is not null then
    /* The provider ceiling is shared by every owner: serialise its check across owners. */
    perform pg_advisory_xact_lock(hashtext('email_marketing_provider_monthly_cap'));
    select coalesce(sum(case when status = 'RESERVED' then included_part + overage_part else coalesce(sent, 0) end), 0)::integer
      into v_window from public.email_quota_reservations
     where created_at >= date_trunc('month', now());
    v_room := greatest(v_cap::integer - v_window, 0);
    if v_inc + v_over > v_room then
      v_over := least(v_over, greatest(v_room - v_inc, 0));
      v_inc := least(v_inc, v_room);
      v_cap_reason := 'PROVIDER_CAPACITY';
    end if;
  end if;
  v_blocks := case when v_over > 0
    then greatest(ceil((v_period.overage_used + v_period.overage_reserved + v_over)::numeric / 1000)::integer - v_paid, 0)
    else 0 end;

  if v_inc + v_over = 0 or (not p_allow_partial and v_inc + v_over < p_count) then
    return jsonb_build_object('reservationId', null, 'granted', 0, 'included', 0, 'overage', 0, 'blocksToBill', 0,
      'status', 'REFUSED', 'reason', coalesce(v_cap_reason,
        case when v_sub.overage_enabled and v_period.kind = 'MONTHLY' then 'OVERAGE_CAP_REACHED' else 'QUOTA_EXHAUSTED' end),
      'remaining', v_remaining);
  end if;

  insert into public.email_quota_reservations
    (owner_user_id, period_id, idempotency_key, source, requested, included_part, overage_part, overage_blocks, blocks_state)
  values (p_owner, v_period.id, p_key, left(coalesce(p_source, 'UNKNOWN'), 40), p_count, v_inc, v_over, v_blocks,
          case when v_blocks > 0 then 'PENDING' else 'NONE' end)
  returning id into v_id;
  update public.email_quota_periods
     set reserved = reserved + v_inc, overage_reserved = overage_reserved + v_over,
         overage_blocks_pending = overage_blocks_pending + v_blocks
   where id = v_period.id;

  return jsonb_build_object('reservationId', v_id, 'granted', v_inc + v_over, 'included', v_inc, 'overage', v_over,
    'blocksToBill', v_blocks, 'status', 'RESERVED', 'duplicate', false, 'periodId', v_period.id);
end;
$function$;

insert into public.admin_settings (key, value) values ('email_marketing_provider_daily_cap', '60'::jsonb)
on conflict (key) do nothing;
/* The monthly cap shipped as 0 (off) until the plan was known; it is known now. */
update public.admin_settings set value = '2000'::jsonb, updated_at = now()
 where key = 'email_marketing_provider_monthly_cap' and value = '0'::jsonb;

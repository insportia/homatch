-- HOMATCH PAY-AS-YOU-GO — part 1: the wallet starts at zero, and the card earns the bonus.
--
-- WHAT CHANGED IN THE BUSINESS, AND WHAT THAT DOES AND DOES NOT MEAN HERE
--
-- Subscriptions are gone from the product. That sounds like a demolition and
-- it is very nearly a no-op, because billing_current_plan() already returns
-- 'FREE' for anybody without a live subscription row, and FREE concedes
-- nothing: profit_share_to_customer_bps = 0. Production has never had a
-- subscription -- user_subscriptions is empty and no account has a non-FREE
-- plan -- so every price this system has ever quoted was already the
-- no-plan price. Retiring plans therefore changes no customer's economics.
--
-- WHAT IS DELIBERATELY NOT DROPPED
--
-- billing_plans and user_subscriptions STAY. usage_reservations.
-- plan_code_snapshot is NOT NULL REFERENCES billing_plans(code) and twenty
-- three historical reservations point at 'FREE'. Dropping the table to make
-- a point would break the audit trail of every search this product has ever
-- run, to remove a row nobody reads. They become what they now are: an empty
-- historical dimension, kept so the past still parses.
--
-- THE SIGNUP GRANT
--
-- 20260919152027 grants 50 promotional credits on registration. That is now
-- the wrong shape: an account is worth nothing until somebody proves they are
-- a real person, and a card is that proof. The grant is switched OFF through
-- the kill switch it already shipped with, rather than by dropping the
-- trigger -- the trigger is correct, idempotent and hung off the one canonical
-- registration funnel, and it is exactly what a future promotion would want.
-- It simply has nothing to do while the setting is false.
--
-- The two accounts that already received 50 credits KEEP them. Their lots are
-- untouched by this migration. Nothing here reaches backwards.

-- ── 1. Signup grants nothing ────────────────────────────────────────
update public.admin_settings
   set value = 'false'::jsonb,
       description = 'Whether a newly registered account receives a welcome credit grant. FALSE since the pay-as-you-go change: an account starts at zero and earns its first credits by adding a payment method (see card_activation_bonus_*). The trigger remains in place and idempotent for any future promotion.'
 where key = 'signup_welcome_credits_enabled';

-- ── 2. The card activation offer, as configuration ──────────────────
insert into public.admin_settings (key, value, description) values
  ('card_activation_bonus_enabled', 'true'::jsonb,
   'Whether adding a reusable payment method grants the one-time activation bonus.'),
  ('card_activation_bonus_credits', '10'::jsonb,
   'Credits granted once per account when a reusable payment method is confirmed by the provider. 10 credits = $1 of service value at credits_per_usd = 10.'),
  ('card_activation_reminder_cooldown_hours', '72'::jsonb,
   'Minimum hours between showing the activation reminder again after a customer dismisses it. The persistent dashboard entry point is always available and is not governed by this.'),
  ('card_activation_max_reminders', '3'::jsonb,
   'How many times the reminder may be re-shown after the first dismissal. Zero means never re-prompt; the persistent dashboard entry point still remains.')
on conflict (key) do nothing;

-- A new promotion KIND, which the table was explicitly designed to take:
-- "'FIRST_TOPUP' is the only kind today. New kinds are new rows, not new
-- tables." This one grants a flat number of credits rather than matching a
-- purchase, because there is no purchase to match -- the customer pays $0.
insert into public.promotions
  (code, name, kind, min_amount_cents, bonus_match_bps, max_bonus_credits, bonus_expires_after_days, max_redemptions_per_user)
values
  ('CARD_ACTIVATION', 'Add a card, get 10 credits', 'CARD_ACTIVATION', 0, 0, 10, NULL, 1)
on conflict (code) do nothing;

-- ── 3. Payment methods ──────────────────────────────────────────────
--
-- WHAT THIS TABLE MAY NEVER CONTAIN
--
-- A card number, a CVV, an expiry that could reconstruct one, or anything
-- else that would make Homatch a cardholder-data environment. What it holds
-- is a REFERENCE the provider issued plus the four display fields a human
-- needs to recognise which card they are looking at. If a future provider
-- cannot issue such a reference, it cannot back this feature, and that is a
-- capability question answered in code -- not a reason to store the number.
create table if not exists public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null,
  -- The provider's own identifiers. Opaque to Homatch.
  provider_customer_ref text,
  provider_method_ref text not null,
  -- Stable across accounts for the same physical instrument where the
  -- provider offers one. NULL is always allowed and is not a failure: the
  -- per-user unique index below still holds, and inventing an identifier
  -- would be worse than admitting we have none.
  instrument_fingerprint text,
  -- Display only. Never used for authorization or reconstruction.
  brand text,
  last4 text check (last4 is null or last4 ~ '^[0-9]{4}$'),
  exp_month smallint check (exp_month is null or exp_month between 1 and 12),
  exp_year smallint check (exp_year is null or exp_year between 2000 and 2100),
  status text not null default 'ACTIVE'
    check (status in ('PENDING','ACTIVE','FAILED','REMOVED')),
  -- How the provider proved this method is reusable. Recorded because the
  -- answer differs per provider and Admin must be able to see which one
  -- actually happened rather than assuming.
  setup_mode text not null default 'UNKNOWN'
    check (setup_mode in ('UNKNOWN','ZERO_AMOUNT_SETUP','VERIFICATION_CHARGE','FIRST_PAYMENT')),
  is_default boolean not null default false,
  failure_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz,
  removed_at timestamptz
);
-- The same provider reference cannot be attached twice.
create unique index if not exists uidx_payment_methods_provider_ref
  on public.payment_methods(provider, provider_method_ref);
create index if not exists idx_payment_methods_user
  on public.payment_methods(user_id, status, created_at desc);
-- One default per user, enforced rather than hoped for.
create unique index if not exists uidx_payment_methods_one_default
  on public.payment_methods(user_id) where is_default and status = 'ACTIVE';

comment on table public.payment_methods IS
  'Provider-issued references to reusable payment instruments. Contains no cardholder data: never a PAN, never a CVV. Removing a row does not make the account eligible for the activation bonus again -- promotion_redemptions is what governs that.';
comment on column public.payment_methods.instrument_fingerprint IS
  'Provider fingerprint for the physical instrument, stable across accounts. Feeds the anti-abuse index on promotion_redemptions. NULL when the provider offers none.';

alter table public.payment_methods enable row level security;
-- A customer may SEE their own cards. Every mutation is service-role only:
-- creating a payment method is something a provider webhook proves, never
-- something a client asserts.
create policy payment_methods_read_own on public.payment_methods
  for select to authenticated using (user_id = public.auth_user_id() or public.is_admin());
create policy payment_methods_service on public.payment_methods
  for all to service_role using (true) with check (true);

drop trigger if exists trg_payment_methods_touch on public.payment_methods;
create trigger trg_payment_methods_touch
  before update on public.payment_methods
  for each row execute function public.billing_touch_updated_at();

-- ── 4. The redemption can now point at a method, not only a payment ──
--
-- A $0 setup produces no payment row, so payment_id stays NULL for this
-- promotion and the instrument is what the redemption records instead.
alter table public.promotion_redemptions
  add column if not exists payment_method_id uuid references public.payment_methods(id) on delete set null;
create unique index if not exists uidx_promo_redemption_method
  on public.promotion_redemptions(payment_method_id) where payment_method_id is not null;

-- ── 5. Offer funnel ─────────────────────────────────────────────────
--
-- WHY NOT activity_events
--
-- activity_events is the customer's own product history, read by the customer
-- under RLS, and typed by the activity_event_type enum. These are conversion
-- states for one promotion -- shown, dismissed, started, failed -- which are
-- not things a customer did to their property portfolio and have no business
-- in that enum or on that screen. Keeping them apart is why neither has to
-- grow a "kind" column that means "ignore me on the other surface".
create table if not exists public.promotion_funnel_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  promo_code text not null references public.promotions(code),
  step text not null check (step in (
    'OFFER_SHOWN','OFFER_DISMISSED','CTA_CLICKED',
    'SETUP_STARTED','SETUP_SUCCEEDED','SETUP_FAILED','BONUS_GRANTED')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_promotion_funnel_user
  on public.promotion_funnel_events(user_id, promo_code, created_at desc);
create index if not exists idx_promotion_funnel_step
  on public.promotion_funnel_events(promo_code, step, created_at desc);

comment on table public.promotion_funnel_events IS
  'Append-only conversion trail for a promotion. Never used to decide eligibility -- promotion_redemptions and its unique indexes do that. This only answers "how many people saw it and how many finished".';

alter table public.promotion_funnel_events enable row level security;
create policy promotion_funnel_admin_read on public.promotion_funnel_events
  for select to authenticated using (public.is_admin());
create policy promotion_funnel_service on public.promotion_funnel_events
  for all to service_role using (true) with check (true);

-- ── 6. Recording a funnel step ──────────────────────────────────────
--
-- Callable by the signed-in customer for their OWN row only, because the
-- browser is the only place that knows the offer was rendered or dismissed.
-- It can therefore be lied to -- a customer could claim they saw it -- and
-- that is acceptable precisely because nothing downstream reads it: it grants
-- nothing, unlocks nothing and gates nothing.
create or replace function public.billing_record_offer_step(
  p_promo_code text,
  p_step text,
  p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_uid uuid := public.auth_user_id();
begin
  if v_uid is null then return; end if;
  if p_step not in ('OFFER_SHOWN','OFFER_DISMISSED','CTA_CLICKED') then
    -- The provider-side steps are recorded by the webhook under the service
    -- role. A client asserting SETUP_SUCCEEDED would be asserting something
    -- only the provider can know.
    raise exception 'STEP_NOT_CLIENT_REPORTABLE: %', p_step;
  end if;
  insert into public.promotion_funnel_events (user_id, promo_code, step, metadata)
  values (v_uid, p_promo_code, p_step, coalesce(p_metadata, '{}'::jsonb));
end;
$fn$;
revoke all on function public.billing_record_offer_step(text, text, jsonb) from public, anon;
grant execute on function public.billing_record_offer_step(text, text, jsonb) to authenticated;

-- ── 7. Granting the activation bonus ────────────────────────────────
--
-- Service role only. The caller is the webhook that has just been told by the
-- provider that a reusable method exists; nothing a browser says can reach
-- this. Idempotent three times over: the per-user index, the per-fingerprint
-- index (same card, second account, still one bonus) and the per-method
-- index, plus wallet_grant_credits' own (user, source_type, source_ref) key.
create or replace function public.billing_grant_card_activation(
  p_user_id uuid,
  p_payment_method_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_method record;
  v_credits numeric;
  v_grant record;
begin
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    raise exception 'SERVICE_ROLE_ONLY';
  end if;
  if p_user_id is null or p_payment_method_id is null then
    return jsonb_build_object('granted', false, 'reason', 'MISSING_ARGUMENT');
  end if;

  if not public.billing_setting_bool('card_activation_bonus_enabled', true) then
    return jsonb_build_object('granted', false, 'reason', 'PROMOTION_DISABLED');
  end if;

  select * into v_method from public.payment_methods
   where id = p_payment_method_id and user_id = p_user_id;
  if not found then
    return jsonb_build_object('granted', false, 'reason', 'UNKNOWN_PAYMENT_METHOD');
  end if;
  -- The bonus is for a method the PROVIDER confirmed. A row we created
  -- optimistically before the provider answered is not proof of anything.
  if v_method.status <> 'ACTIVE' then
    return jsonb_build_object('granted', false, 'reason', 'PAYMENT_METHOD_NOT_ACTIVE');
  end if;

  v_credits := public.billing_setting_num('card_activation_bonus_credits', 0);
  if v_credits is null or v_credits <= 0 then
    return jsonb_build_object('granted', false, 'reason', 'NO_CREDITS_CONFIGURED');
  end if;

  begin
    insert into public.promotion_redemptions
      (user_id, promo_code, payment_method_id, payment_fingerprint, credits_granted)
    values
      (p_user_id, 'CARD_ACTIVATION', p_payment_method_id, v_method.instrument_fingerprint, v_credits);
  exception when unique_violation then
    -- Already claimed: by this account, by this card on another account, or
    -- by this exact method. All three are the same answer.
    return jsonb_build_object('granted', false, 'reason', 'ALREADY_REDEEMED');
  end;

  select * into v_grant from public.wallet_grant_credits(
    p_user_id, 'PROMOTIONAL', v_credits, 'PROMOTIONAL_GRANT',
    'card_activation', p_payment_method_id::text,
    NULL, NULL, NULL,
    jsonb_build_object('promo_code', 'CARD_ACTIVATION',
                       'payment_method_id', p_payment_method_id,
                       'setup_mode', v_method.setup_mode));

  update public.promotion_redemptions
     set lot_id = v_grant.lot_id
   where user_id = p_user_id and promo_code = 'CARD_ACTIVATION';

  insert into public.promotion_funnel_events (user_id, promo_code, step, metadata)
  values (p_user_id, 'CARD_ACTIVATION', 'BONUS_GRANTED',
          jsonb_build_object('credits', v_credits, 'payment_method_id', p_payment_method_id));

  return jsonb_build_object(
    'granted', true,
    'credits', v_grant.credits_granted,
    'balance_after', v_grant.balance_after,
    'lot_id', v_grant.lot_id);
end;
$fn$;
revoke all on function public.billing_grant_card_activation(uuid, uuid) from public, anon, authenticated;

-- ── 8. What the customer's own screen needs to know ─────────────────
--
-- One read, answering: do they have a card, may they still claim, and how
-- many times have they waved the offer away. Everything the activation
-- surface decides is decided from this, server-side, so the offer cannot be
-- made to reappear by clearing browser storage.
create or replace function public.billing_my_activation_offer()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_uid uuid := public.auth_user_id();
  v_has_method boolean;
  v_redeemed boolean;
  v_dismissals integer;
  v_last_dismissed timestamptz;
begin
  if v_uid is null then return jsonb_build_object('eligible', false, 'reason', 'ANONYMOUS'); end if;

  select exists(select 1 from public.payment_methods
                 where user_id = v_uid and status = 'ACTIVE')
    into v_has_method;
  select exists(select 1 from public.promotion_redemptions
                 where user_id = v_uid and promo_code = 'CARD_ACTIVATION')
    into v_redeemed;
  select count(*), max(created_at)
    into v_dismissals, v_last_dismissed
    from public.promotion_funnel_events
   where user_id = v_uid and promo_code = 'CARD_ACTIVATION' and step = 'OFFER_DISMISSED';

  return jsonb_build_object(
    'eligible', public.billing_setting_bool('card_activation_bonus_enabled', true)
                and not v_redeemed,
    'already_claimed', v_redeemed,
    'has_payment_method', v_has_method,
    'credits', public.billing_setting_num('card_activation_bonus_credits', 0),
    'credits_per_usd', public.billing_setting_num('credits_per_usd', 10),
    'dismissals', coalesce(v_dismissals, 0),
    'max_reminders', public.billing_setting_num('card_activation_max_reminders', 3),
    'cooldown_hours', public.billing_setting_num('card_activation_reminder_cooldown_hours', 72),
    'last_dismissed_at', v_last_dismissed);
end;
$fn$;
revoke all on function public.billing_my_activation_offer() from public, anon;
grant execute on function public.billing_my_activation_offer() to authenticated;

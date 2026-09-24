-- HOMATCH PAY-AS-YOU-GO — part 2: the customer chooses the ceiling.
--
-- WHAT WAS ALREADY RIGHT, AND IS NOT TOUCHED
--
-- billing_budget_to_cogs_ceiling already derives the internal provider spend
-- ceiling from the AUTHORISED CREDITS and the margin policy, not from a plan
-- allowance:
--
--   effective_multiple = max(retail/COGS multiple, 1/(1 - margin_floor))
--   ceiling_cents      = authorised_cents / effective_multiple
--
-- With no plans the concession term is zero for everybody, so the expression
-- collapses to the product's own cost multiple with the margin floor underneath
-- it. Ten authorised credits on VERIFY authorise 23.6c of provider spend and
-- not a cent more. That is exactly the model the pay-as-you-go brief asks for,
-- it is already enforced before every provider call, and rebuilding it would
-- have been rewriting a working system to arrive back where it started.
--
-- WHAT WAS MISSING
--
-- The customer never explicitly chose the number. The offer computed one from
-- their balance and the estimate, which is a reasonable default and is not the
-- same thing as authorisation. A person with 100 credits must be able to say
-- "spend at most 20 of them on this" and have that be the binding ceiling.
--
-- So: presets, configurable, with one marked recommended. The RESERVATION is
-- still what binds -- usage_reservations.authorized_max_credits with its CHECK
-- that settlement cannot exceed it -- and these only decide which numbers the
-- customer is offered.

insert into public.admin_settings (key, value, description) values
  ('search_budget_presets', '[10, 20, 30, 40, 50, 100]'::jsonb,
   'The quick-choice campaign budgets, in credits, offered before a search. A custom amount is always available alongside them. Order is preserved; the list may be any length.'),
  ('search_budget_recommended', '20'::jsonb,
   'Which preset is marked Recommended. Must be one of search_budget_presets or it is ignored rather than added.'),
  ('search_budget_allow_custom', 'true'::jsonb,
   'Whether the customer may type an amount instead of choosing a preset. The minimum is still billable_products.min_viable_budget_credits and the maximum is still their balance.')
on conflict (key) do nothing;

-- ── What the customer is offered before a search ────────────────────
--
-- One read, returning only what a budget chooser needs. Deliberately
-- customer-safe: the provider ceiling this budget implies is NOT returned,
-- because it is our economics and the customer's decision does not depend on
-- it. billing_budget_to_cogs_ceiling stays service-role only.
create or replace function public.billing_my_budget_choices(p_product_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_uid uuid := public.auth_user_id();
  v_balance numeric := 0;
  v_product record;
  v_presets jsonb;
  v_recommended numeric;
  v_min numeric;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'ANONYMOUS');
  end if;

  select * into v_product from public.billable_products where code = p_product_code;
  if not found or not v_product.enabled then
    return jsonb_build_object('ok', false, 'reason', 'UNKNOWN_PRODUCT');
  end if;
  if not v_product.pricing_active then
    return jsonb_build_object('ok', false, 'reason', 'PRICING_INACTIVE');
  end if;

  select coalesce(balance, 0) into v_balance
    from public.credit_accounts where user_id = v_uid;
  v_balance := coalesce(v_balance, 0);

  v_presets := coalesce(
    (select value from public.admin_settings where key = 'search_budget_presets'),
    '[10, 20, 30, 40, 50, 100]'::jsonb);
  v_recommended := public.billing_setting_num('search_budget_recommended', 0);
  v_min := coalesce(v_product.min_viable_budget_credits, 0);

  return jsonb_build_object(
    'ok', true,
    'product_code', p_product_code,
    'balance', v_balance,
    /* Below this the product must not run at all: spending somebody's last
       two credits on a search that cannot produce anything useful is worse
       than telling them to top up. */
    'min_viable', v_min,
    'allow_custom', public.billing_setting_bool('search_budget_allow_custom', true),
    'recommended', v_recommended,
    'presets', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'credits', c,
        /* Affordable AND worth running. A preset the customer cannot pay for
           is shown as unavailable rather than hidden, so the ladder does not
           silently change shape as their balance moves. */
        'affordable', c <= v_balance,
        'viable', c >= v_min,
        'recommended', c = v_recommended
      ) order by c), '[]'::jsonb)
      from jsonb_array_elements_text(v_presets) as e(v)
      cross join lateral (select (e.v)::numeric as c) as x
    ));
end;
$fn$;
revoke all on function public.billing_my_budget_choices(text) from public, anon;
grant execute on function public.billing_my_budget_choices(text) to authenticated;

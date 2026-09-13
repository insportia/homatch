-- AN ADMIN CAN EDIT THE PRICE CARD -- AND NOBODY CAN EDIT MORE THAN THAT.
--
-- WHAT THIS WAS WRITTEN TO ADD
--
-- Admin > Pricing needs to change plan names, prices, Credit grants, badges,
-- order and visibility without a deploy, because the commercial packaging is
-- still being decided and a catalogue that moves only by shipping is one that
-- goes stale between conversations.
--
-- WHAT WAS FOUND ON THE WAY
--
-- `authenticated` already held table-wide INSERT, UPDATE and DELETE on
-- billing_plans. An earlier migration --
-- billable_products_column_grants_not_definer_view -- had been careful about
-- READS for exactly this table:
--
--   REVOKE SELECT ON public.billing_plans FROM anon, authenticated;
--   GRANT SELECT (code, name, monthly_price_cents, ...) TO anon, authenticated;
--
-- because profit_share_to_customer_bps is the internal margin lever and no
-- customer should be able to read it. It said nothing about writes, so the
-- blanket write privileges from the table's creation stayed in place. Every
-- signed-in account therefore held the privilege to rewrite the primary key,
-- the margin lever, and the catalogue itself.
--
-- It was never an open door: RLS is the second gate, and
-- billing_plans_admin_write restricts every row to is_admin(), so a non-admin
-- holding the privilege still matched no rows. But two gates exist so that one
-- of them failing is survivable, and a table-wide write privilege means one
-- mistake in one policy is the whole catalogue.
--
-- WHAT IS WRITABLE NOW
--
-- UPDATE on the price-card columns only -- the same ones already readable by
-- anyone and already rendered on /pricing. Three are deliberately excluded:
--
--   code                          the primary key that user_subscriptions and
--                                 product_plan_entitlements join on. Renaming
--                                 it in place orphans every row referencing it.
--   profit_share_to_customer_bps  internal. Not readable by authenticated, and
--                                 now not writable by them either; it moves in
--                                 a migration, where the change is reviewed.
--   config                        an untyped jsonb bag nothing reads a schema
--                                 from, so a typo fails at the point of use
--                                 rather than at the point of entry.
--
-- Row creation and removal are not granted at all. Adding or removing a plan
-- changes what a subscription can point at, and belongs in a migration beside
-- the product_plan_entitlements rows it needs -- not in a form with a save
-- button.
--
-- The existing RLS policy is still what authorises the write. These grants
-- only decide how far that policy is allowed to reach.

REVOKE INSERT, UPDATE, DELETE ON public.billing_plans FROM authenticated;

GRANT UPDATE (
  name,
  monthly_price_cents,
  membership_credits_grant,
  membership_rollover_cap,
  quality_tier,
  badge_key,
  priority_level,
  marketing_label_key,
  sort_order,
  enabled,
  updated_at
) ON public.billing_plans TO authenticated;

COMMENT ON POLICY billing_plans_admin_write ON public.billing_plans IS
  'Admins edit the price card from Admin > Pricing. Writes are column-scoped by the grants in 20260913120000: code, profit_share_to_customer_bps and config are not writable from the client, and row creation/removal is not granted at all.';

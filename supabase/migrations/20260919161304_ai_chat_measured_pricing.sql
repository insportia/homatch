-- AI CHAT, PRICED FROM WHAT IT ACTUALLY COST.
--
-- Seven real production responses, measured through the metering that
-- shipped with the product registration, all with billable=false:
--
--   bare greeting             7,442 in /   128 out / 0 search -> 0.1938c landed
--   cheap conversational      7,451 in /   129 out / 0 search -> 0.1941c
--   property guidance         8,174 in /   113 out / 0 search -> 0.2089c
--   context-heavy multi-turn  7,869 in /   300 out / 0 search -> 0.2282c  (median)
--   mortgage contextual       8,874 in /   202 out / 0 search -> 0.2380c
--   current-rate + web search 16,676 in /  313 out / 2 search -> 2.7979c
--   long explanation + search 25,176 in / 1,581 out / 2 search -> 3.1780c  (max)
--
--   min 0.1938  median 0.2282  mean 1.0056  p75 1.5180  max 3.1780
--
-- Seven samples calibrate a launch price. They do not describe a
-- population, and nothing here should be read as if they did.
--
-- THE DISTRIBUTION IS BIMODAL, AND THAT DECIDES THE REFERENCE.
--
-- An ordinary reply costs about a fifth of a cent; one that searches the
-- web costs fifteen times that. reference_landed_cogs_cents does two
-- jobs and only one of them is the price: settleExecution always prices
-- the MEASURED cost of the answer that actually ran, so the reference
-- fixes (a) the markup ratio and (b) the size of the hold taken before
-- the model is called. Sizing that hold on the median would mean every
-- searched answer settling against a reservation too small to cover it
-- and being clamped — undercharging precisely the answers that cost the
-- most. So the reference is the measured MAXIMUM, the hold covers the
-- worst case, and what is captured is still the real cost of the real
-- answer. A 2.03-Credit hold against a 50-Credit welcome grant is 4%,
-- and it is released the moment the answer lands.
--
-- THE MARKUP IS NOT A NEW NUMBER.
--
-- Every registered product carries the same house multiple: 50/11.8 for
-- Verify, 250/59 for Find Clients, 80/18.88 for Contract Intelligence,
-- 120/28.32 for Broker Finder — 4.2372881355932 to thirteen places. AI
-- Chat adopts it rather than inventing one, which is why the retail
-- figure is written as that ratio rather than as a constant.
--
-- WHAT A RESPONSE COSTS, THROUGH billing_price_quote ITSELF
--
--   0.1938c landed -> 0.80c retail -> 0.08 Credits
--   0.2089c        -> 0.90c        -> 0.09 Credits
--   0.2282c        -> 1.00c        -> 0.10 Credits
--   2.7979c        -> 11.90c       -> 1.19 Credits
--   3.1780c        -> 13.50c       -> 1.35 Credits
--
-- Nothing is rounded up to a whole Credit; the margin floor is never
-- reached. At 10 Credits to the dollar the welcome grant is roughly 500
-- ordinary answers.

-- WHY THE COLUMN HAD TO WIDEN.
--
-- standard_retail_cents was an integer, and the retail price of one chat
-- response is under a cent: 0.90c would have stored as 1 and silently
-- raised this product's markup by 15% while leaving every other
-- product's ratio intact — a pricing error invisible in every report.
-- numeric(14,6) is the narrowest fix. The existing values (50, 250, 80,
-- 120, 0) are unchanged by the cast, and billing_price_quote already
-- casts this column to numeric before dividing.
alter table public.billable_products
  alter column standard_retail_cents type numeric(14,6);

update public.billable_products
   set reference_landed_cogs_cents = 3.1780,
       standard_retail_cents       = round(3.1780 * (50.0 / 11.8), 6),
       min_viable_budget_credits   = 0.10,
       pricing_active              = true,
       config = config || jsonb_build_object(
         'cogs_sample', jsonb_build_object(
           'measured_at', '2026-09-19',
           'n', 7,
           'model', 'gpt-5.6-luna',
           'min_landed_cents', 0.1938,
           'median_landed_cents', 0.2282,
           'mean_landed_cents', 1.0056,
           'p75_landed_cents', 1.5180,
           'max_landed_cents', 3.1780,
           'note', 'Production responses through homatch-ai, recorded with '
                || 'billable=false before pricing was activated. The maximum is '
                || 'the reference because it sizes the reservation; the charge '
                || 'is always the measured cost of the answer that ran.'
         ),
         'scope_note', 'Priced from measured production COGS on 2026-09-19.'
       )
 where code = 'AI_CHAT_RESPONSE';

-- Measurement first, money second. This is the switch that was false
-- while the seven samples above were collected.
insert into public.admin_settings (key, value, description) values
  ('ai_chat_billing_enabled', 'true'::jsonb,
   'Whether an authenticated AI Chat response reserves and settles Credits. '
   || 'While false, usage is still measured and recorded with billable=false.')
on conflict (key) do update set value = excluded.value, updated_at = now();

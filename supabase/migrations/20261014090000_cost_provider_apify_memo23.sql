-- FIND BUYERS / FIND TENANTS: memo23 spend gets its own cost_provider value, so
-- it never mixes with the retired generic APIFY history (spend caps, monthly
-- provider totals, system health). Its own migration because a new enum value
-- cannot be used in the transaction that adds it; 20261014100000 uses it.
alter type public.cost_provider add value if not exists 'APIFY_MEMO23';

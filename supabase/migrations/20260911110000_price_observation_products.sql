-- Homatch — real products behind a renovation price.
--
-- renovation_price_observations already carried the observation itself
-- (value, unit, normalization, currency, source, collection, review state and
-- which item it was applied to). What it could not record is WHAT was priced:
-- a number without a product is not an observation, it is a rumour.
--
-- These columns exist so a published price can be traced to a specific thing
-- a specific supplier was selling on a specific date in a specific city:
--
--   supplier / brand / manufacturer / product name / model
--   specification and pack size, because "tile, 45 GEL" is meaningless
--     without knowing whether that is per square metre or per box
--   region, because Tbilisi is not Batumi
--   availability, because an out-of-stock price is not a market price
--
-- Nothing here publishes anything or relaxes the gate. The publication rules
-- (renovation_price_book_versions.status) are untouched, and an item still
-- cannot become a customer price without verified observations behind it.
--
-- Idempotent.

alter table public.renovation_price_observations
  add column if not exists supplier      text,
  add column if not exists brand         text,
  add column if not exists manufacturer  text,
  add column if not exists product_name  text,
  add column if not exists product_model text,
  add column if not exists specification text,
  -- How many normalized units one purchasable unit contains. A box of tile
  -- covering 1.44 m2 is the difference between a right answer and a price
  -- that is out by a factor of 1.44.
  add column if not exists pack_size     numeric(12,4),
  add column if not exists region        text,
  add column if not exists availability  text,
  add column if not exists product_url   text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.renovation_price_observations'::regclass
      and conname = 'renovation_price_observations_availability_ck'
  ) then
    alter table public.renovation_price_observations
      add constraint renovation_price_observations_availability_ck
      check (availability is null or availability in ('IN_STOCK','ORDER','OUT_OF_STOCK','UNKNOWN'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.renovation_price_observations'::regclass
      and conname = 'renovation_price_observations_pack_size_ck'
  ) then
    alter table public.renovation_price_observations
      add constraint renovation_price_observations_pack_size_ck
      check (pack_size is null or pack_size > 0);
  end if;
end $$;

-- Finding what still needs review, and reading a price's history per market.
create index if not exists renovation_price_observations_review_idx
  on public.renovation_price_observations (market, item_key, review_state, source_date desc);

create index if not exists renovation_price_observations_supplier_idx
  on public.renovation_price_observations (market, supplier, item_key);

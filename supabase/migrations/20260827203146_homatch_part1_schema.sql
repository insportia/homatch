
-- ================================================================
-- HOMATCH Part 1 — Full Schema Migration
-- ================================================================

-- Enable required extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pg_trgm";

-- ================================================================
-- ENUMS
-- ================================================================
create type transaction_type as enum ('SALE', 'RENT', 'INVESTMENT');
create type property_type as enum ('APARTMENT','HOUSE','VILLA','COMMERCIAL','LAND','OFFICE','PENTHOUSE','STUDIO','TOWNHOUSE','OTHER');
create type property_source_type as enum ('URL_IMPORT','PRIVATE_LISTING');
create type matching_status as enum ('ACTIVE','PAUSED','DRAFT','COMPLETED');
create type import_status as enum ('PENDING','PROCESSING','COMPLETED','FAILED','CACHED');
create type import_error_code as enum ('INVALID_URL','NOT_A_LISTING','SOURCE_BLOCKED','JS_RENDER_REQUIRED','RENDER_PROVIDER_UNAVAILABLE','EXTRACTION_FAILED','LOGIN_REQUIRED','RATE_LIMITED');
create type photo_visibility as enum ('PUBLIC','PRIVATE','AUTHENTICATED');
create type address_visibility as enum ('FULL','CITY_ONLY','HIDDEN');
create type activity_event_type as enum ('PROPERTY_ADDED','IMPORT_STARTED','IMPORT_COMPLETED','IMPORT_FAILED','PRIVATE_LISTING_CREATED','MATCHING_STARTED','MATCHING_PAUSED','PROPERTY_DELETED');
create type notification_type as enum ('IMPORT_COMPLETED','IMPORT_FAILED','MATCHING_STARTED','MATCHING_PAUSED','LOW_CREDITS','MATCH_FOUND');
create type condition_type as enum ('NEW','GOOD','NEEDS_RENOVATION','UNDER_CONSTRUCTION');
create type building_type as enum ('PANEL','BRICK','MONOLITH','WOOD','OTHER');
create type heating_type as enum ('CENTRAL','GAS','ELECTRIC','NONE','OTHER');
create type supported_language as enum ('en','ka','ru','tr','ar','he');

-- ================================================================
-- MARKETS
-- ================================================================
create table markets (
  id uuid primary key default uuid_generate_v4(),
  country_code text not null unique,
  country_name text not null,
  enabled boolean not null default false,
  launch_priority int not null default 99,
  default_currency text not null default 'USD',
  supported_languages supported_language[] not null default '{en}',
  query_pack_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Seed: Georgia as first active market
insert into markets (country_code, country_name, enabled, launch_priority, default_currency, supported_languages)
values
  ('GE', 'Georgia', true, 1, 'GEL', '{en,ka,ru,tr,ar,he}'),
  ('AE', 'UAE', false, 10, 'AED', '{en,ar}'),
  ('TR', 'Turkey', false, 11, 'TRY', '{en,tr}'),
  ('ES', 'Spain', false, 12, 'EUR', '{en}'),
  ('PT', 'Portugal', false, 13, 'EUR', '{en}'),
  ('GR', 'Greece', false, 14, 'EUR', '{en}'),
  ('CY', 'Cyprus', false, 15, 'EUR', '{en}'),
  ('IL', 'Israel', false, 16, 'ILS', '{en,he}'),
  ('US', 'United States', false, 20, 'USD', '{en}'),
  ('GB', 'United Kingdom', false, 21, 'GBP', '{en}');

-- ================================================================
-- USERS (internal Homatch user — decoupled from auth)
-- ================================================================
create table users (
  id uuid primary key default uuid_generate_v4(),
  auth_id uuid not null unique,  -- references auth.users(id) logically
  email text not null,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_users_auth_id on users(auth_id);

-- ================================================================
-- USER PREFERENCES
-- ================================================================
create table user_preferences (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  language supported_language not null default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id)
);

-- ================================================================
-- PROPERTIES
-- ================================================================
create table properties (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  source_type property_source_type not null,
  title text,
  transaction_type transaction_type,
  property_type property_type,
  matching_status matching_status not null default 'DRAFT',
  matchability_score int,
  cover_photo_url text,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_properties_user_id on properties(user_id);
create index idx_properties_status on properties(matching_status);
create index idx_properties_not_deleted on properties(user_id) where is_deleted = false;

-- ================================================================
-- PROPERTY FACTS
-- ================================================================
create table property_facts (
  id uuid primary key default uuid_generate_v4(),
  property_id uuid not null references properties(id) on delete cascade,
  -- Source
  source_url text,
  canonical_url text,
  external_listing_id text,
  -- Location
  country text,
  region text,
  city text,
  district text,
  neighborhood text,
  address text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  -- Price
  total_price numeric(16,2),
  price_per_sqm numeric(12,2),
  currency text default 'USD',
  -- Size
  area numeric(10,2),
  rooms int,
  bedrooms int,
  bathrooms int,
  floor int,
  total_floors int,
  -- Building
  construction_status condition_type,
  condition condition_type,
  new_build boolean,
  building_type building_type,
  -- Amenities
  parking boolean,
  balcony boolean,
  terrace boolean,
  elevator boolean,
  security boolean,
  concierge boolean,
  yard boolean,
  furnished boolean,
  heating heating_type,
  air_conditioning boolean,
  view text,
  -- Text
  description text,
  original_description text,
  features text[],
  -- Privacy
  photo_visibility photo_visibility not null default 'PUBLIC',
  address_visibility address_visibility not null default 'FULL',
  -- Listing dates
  listing_created_at timestamptz,
  listing_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(property_id)
);

create index idx_property_facts_property_id on property_facts(property_id);
create index idx_property_facts_city on property_facts(city);
create index idx_property_facts_country on property_facts(country);

-- ================================================================
-- PROPERTY PHOTOS
-- ================================================================
create table property_photos (
  id uuid primary key default uuid_generate_v4(),
  property_id uuid not null references properties(id) on delete cascade,
  storage_path text not null,
  public_url text,
  display_order int not null default 0,
  is_cover boolean not null default false,
  visibility photo_visibility not null default 'PUBLIC',
  original_filename text,
  file_size int,
  width int,
  height int,
  created_at timestamptz not null default now()
);

create index idx_property_photos_property_id on property_photos(property_id);

-- Enforce max 5 photos per property
create or replace function enforce_max_photos()
returns trigger language plpgsql as $$
begin
  if (select count(*) from property_photos where property_id = new.property_id) >= 5 then
    raise exception 'Maximum 5 photos allowed per property';
  end if;
  return new;
end;
$$;

create trigger trg_max_photos
  before insert on property_photos
  for each row execute function enforce_max_photos();

-- ================================================================
-- PROPERTY IMPORTS
-- ================================================================
create table property_imports (
  id uuid primary key default uuid_generate_v4(),
  property_id uuid references properties(id) on delete set null,
  user_id uuid not null references users(id) on delete cascade,
  source_url text not null,
  canonical_url text,
  status import_status not null default 'PENDING',
  error_code import_error_code,
  error_message text,
  pipeline_log jsonb,
  raw_html_sample text,
  extracted_data jsonb,
  render_provider_used text,
  mock_mode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_property_imports_user_id on property_imports(user_id);
create index idx_property_imports_status on property_imports(status);

-- ================================================================
-- SEARCH PROFILES
-- ================================================================
create table search_profiles (
  id uuid primary key default uuid_generate_v4(),
  property_id uuid not null references properties(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  transaction_type transaction_type,
  property_type property_type,
  country text,
  region text,
  city text,
  district text,
  min_price numeric(16,2),
  max_price numeric(16,2),
  currency text,
  min_area numeric(10,2),
  max_area numeric(10,2),
  min_bedrooms int,
  max_bedrooms int,
  new_build boolean,
  keywords text[],
  ai_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(property_id)
);

create index idx_search_profiles_user_id on search_profiles(user_id);

-- ================================================================
-- MATCHING CAMPAIGNS (placeholder — PART 2 extends this)
-- ================================================================
create table matching_campaigns (
  id uuid primary key default uuid_generate_v4(),
  property_id uuid not null references properties(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  status text not null default 'PENDING',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(property_id)
);

-- ================================================================
-- ACTIVITY EVENTS
-- ================================================================
create table activity_events (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  property_id uuid references properties(id) on delete set null,
  event_type activity_event_type not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index idx_activity_events_user_id on activity_events(user_id);
create index idx_activity_events_created_at on activity_events(created_at desc);

-- ================================================================
-- NOTIFICATIONS
-- ================================================================
create table notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  type notification_type not null,
  title text not null,
  body text,
  read boolean not null default false,
  property_id uuid references properties(id) on delete set null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index idx_notifications_user_id on notifications(user_id);
create index idx_notifications_unread on notifications(user_id) where read = false;

-- ================================================================
-- STORAGE BUCKET
-- ================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'property-photos',
  'property-photos',
  false,
  5242880,  -- 5MB
  array['image/jpeg','image/jpg','image/png','image/webp','image/gif']
)
on conflict (id) do nothing;

-- ================================================================
-- ROW LEVEL SECURITY
-- ================================================================

-- Helper: get internal user id from auth.uid()
create or replace function get_user_id()
returns uuid language sql stable security definer as $$
  select id from users where auth_id = auth.uid() limit 1;
$$;

-- Helper: check if user owns a property
create or replace function user_owns_property(p_id uuid)
returns boolean language sql stable security definer as $$
  select exists(
    select 1 from properties
    where id = p_id and user_id = get_user_id() and is_deleted = false
  );
$$;

-- MARKETS (public read)
alter table markets enable row level security;
create policy "markets_public_read" on markets for select using (true);

-- USERS
alter table users enable row level security;
create policy "users_insert_own" on users for insert with check (auth_id = auth.uid());
create policy "users_select_own" on users for select using (auth_id = auth.uid());
create policy "users_update_own" on users for update using (auth_id = auth.uid());

-- USER PREFERENCES
alter table user_preferences enable row level security;
create policy "prefs_select_own" on user_preferences for select using (user_id = get_user_id());
create policy "prefs_insert_own" on user_preferences for insert with check (user_id = get_user_id());
create policy "prefs_update_own" on user_preferences for update using (user_id = get_user_id());

-- PROPERTIES
alter table properties enable row level security;
create policy "props_select_own" on properties for select using (user_id = get_user_id());
create policy "props_insert_own" on properties for insert with check (user_id = get_user_id());
create policy "props_update_own" on properties for update using (user_id = get_user_id());
create policy "props_delete_own" on properties for delete using (user_id = get_user_id());

-- PROPERTY FACTS
alter table property_facts enable row level security;
create policy "facts_select_own" on property_facts for select using (user_owns_property(property_id));
create policy "facts_insert_own" on property_facts for insert with check (user_owns_property(property_id));
create policy "facts_update_own" on property_facts for update using (user_owns_property(property_id));
create policy "facts_delete_own" on property_facts for delete using (user_owns_property(property_id));

-- PROPERTY PHOTOS
alter table property_photos enable row level security;
create policy "photos_select_own" on property_photos for select using (user_owns_property(property_id));
create policy "photos_insert_own" on property_photos for insert with check (user_owns_property(property_id));
create policy "photos_update_own" on property_photos for update using (user_owns_property(property_id));
create policy "photos_delete_own" on property_photos for delete using (user_owns_property(property_id));

-- PROPERTY IMPORTS
alter table property_imports enable row level security;
create policy "imports_select_own" on property_imports for select using (user_id = get_user_id());
create policy "imports_insert_own" on property_imports for insert with check (user_id = get_user_id());
create policy "imports_update_own" on property_imports for update using (user_id = get_user_id());

-- SEARCH PROFILES
alter table search_profiles enable row level security;
create policy "sp_select_own" on search_profiles for select using (user_id = get_user_id());
create policy "sp_insert_own" on search_profiles for insert with check (user_id = get_user_id());
create policy "sp_update_own" on search_profiles for update using (user_id = get_user_id());
create policy "sp_delete_own" on search_profiles for delete using (user_id = get_user_id());

-- MATCHING CAMPAIGNS
alter table matching_campaigns enable row level security;
create policy "mc_select_own" on matching_campaigns for select using (user_id = get_user_id());
create policy "mc_insert_own" on matching_campaigns for insert with check (user_id = get_user_id());
create policy "mc_update_own" on matching_campaigns for update using (user_id = get_user_id());

-- ACTIVITY EVENTS
alter table activity_events enable row level security;
create policy "activity_select_own" on activity_events for select using (user_id = get_user_id());
create policy "activity_insert_own" on activity_events for insert with check (user_id = get_user_id());

-- NOTIFICATIONS
alter table notifications enable row level security;
create policy "notif_select_own" on notifications for select using (user_id = get_user_id());
create policy "notif_update_own" on notifications for update using (user_id = get_user_id());
create policy "notif_insert_own" on notifications for insert with check (user_id = get_user_id());

-- STORAGE POLICIES
create policy "photos_upload_own" on storage.objects
  for insert with check (
    bucket_id = 'property-photos' and
    auth.uid() is not null
  );

create policy "photos_select_own_storage" on storage.objects
  for select using (
    bucket_id = 'property-photos' and
    auth.uid() is not null
  );

create policy "photos_delete_own_storage" on storage.objects
  for delete using (
    bucket_id = 'property-photos' and
    auth.uid() is not null
  );

-- ================================================================
-- UPDATED_AT TRIGGER
-- ================================================================
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_users_updated_at before update on users for each row execute function update_updated_at();
create trigger trg_user_prefs_updated_at before update on user_preferences for each row execute function update_updated_at();
create trigger trg_properties_updated_at before update on properties for each row execute function update_updated_at();
create trigger trg_property_facts_updated_at before update on property_facts for each row execute function update_updated_at();
create trigger trg_property_imports_updated_at before update on property_imports for each row execute function update_updated_at();
create trigger trg_search_profiles_updated_at before update on search_profiles for each row execute function update_updated_at();
create trigger trg_markets_updated_at before update on markets for each row execute function update_updated_at();
create trigger trg_matching_campaigns_updated_at before update on matching_campaigns for each row execute function update_updated_at();

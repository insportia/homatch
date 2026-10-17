-- Extra stand-ins for the expansion (production: 20260930140000_broker_lifecycle).
create table public.broker_listing_purchases (id bigint generated always as identity primary key, listing_id uuid, user_id uuid, credits int);
insert into public.broker_listing_purchases (listing_id, user_id, credits) values (gen_random_uuid(), 'bbbbbbbb-0000-0000-0000-00000000000b', 10);

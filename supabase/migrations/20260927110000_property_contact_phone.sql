-- Homatch — a Homatch-native property carries a contact number.
--
-- WHY THE DATABASE AND NOT THE FORM
--
-- Properties are created by a direct authenticated insert under RLS. There is
-- no edge function in that path, so there is no server to validate at — which
-- means a React form, an HTML `required` and a client-side schema are, all
-- three, things a customer can skip by making the request themselves. A
-- trigger is the only place this can be true regardless of who is asking.
--
-- WHY A TRIGGER AND NOT A NOT NULL COLUMN
--
-- NOT NULL applies to every row, and the historical rows are real properties
-- belonging to real people. Fabricating numbers for them would be a lie,
-- deleting them would be destruction, and archiving them silently would be
-- both. BEFORE INSERT applies only to properties created from here on, which
-- is exactly the rule: new properties need a number, old properties are left
-- alone and asked at the point where the number is actually needed.
--
-- REQUIRED IS NOT PUBLIC
--
-- The column sits on `properties`, whose only SELECT policy is
-- `user_id = get_user_id()`. An anonymous visitor, another customer, and the
-- public site cannot read it at all — not because the frontend does not ask
-- for it, but because the row is not theirs. Anything that needs to disclose
-- the number to somebody else — an authorised match, say — has to go through
-- a function that decides whether they may have it, and disclose it there.
--
-- THREE COLUMNS FOR ONE NUMBER
--
--   contact_phone_e164     the canonical form, +995555123456, what we dial and
--                          what we compare. "+995 555 123 456" and
--                          "+995555123456" are the same contact and must not
--                          become two.
--   contact_phone_raw      exactly what the owner typed, kept so a number we
--                          could not parse can still be shown back to them
--                          rather than silently replaced by our reading of it.
--   contact_phone_country  the ISO country the parse resolved to, so a local
--                          number can be re-read later without guessing.
--
-- The parsing itself belongs to src/lib/comm/phone.ts and its generated edge
-- mirror — one libphonenumber, already in the repository, used by the campaign
-- import for the same job. The check below is a SHAPE guard, not a second
-- parser: it refuses anything that is not plausibly E.164 and leaves the
-- question of whether a number is real to the library that knows.

alter table public.properties
  add column if not exists contact_phone_e164    text,
  add column if not exists contact_phone_raw     text,
  add column if not exists contact_phone_country text;

comment on column public.properties.contact_phone_e164 is
  'The property contact number in canonical E.164. Owner-visible only: readable through the properties RLS policy, which is user_id = get_user_id(). Disclosure to anybody else goes through an authorising function.';
comment on column public.properties.contact_phone_raw is
  'What the owner actually typed, kept so an unparsed number can be shown back rather than replaced by our reading of it.';
comment on column public.properties.contact_phone_country is
  'The ISO-3166 alpha-2 the parse resolved to, so a locally written number can be re-read without guessing.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.properties'::regclass
      and conname = 'properties_contact_phone_e164_shape'
  ) then
    /* NOT VALID: historical rows are not examined. They have no number, which
       is null, which this permits anyway — but the intent is explicit. */
    alter table public.properties
      add constraint properties_contact_phone_e164_shape
      check (
        contact_phone_e164 is null
        or contact_phone_e164 ~ '^\+[1-9][0-9]{6,14}$'
      )
      not valid;
  end if;
end $$;

create or replace function public.require_property_contact_phone()
returns trigger
language plpgsql
as $$
begin
  if new.contact_phone_e164 is null or btrim(new.contact_phone_e164) = '' then
    /*
     * A distinct SQLSTATE so the interface can tell this apart from every
     * other insert failure and say the one useful thing — "add a contact
     * number" — instead of "could not save".
     */
    raise exception 'a Homatch property needs a contact phone number'
      using errcode = 'HM002',
            hint = 'Set contact_phone_e164 to the canonical form of the owner''s number.';
  end if;
  return new;
end $$;

drop trigger if exists properties_require_contact_phone on public.properties;
create trigger properties_require_contact_phone
  before insert on public.properties
  for each row execute function public.require_property_contact_phone();

-- WHAT IS DELIBERATELY NOT HERE
--
-- No UPDATE trigger. An owner editing a historical property must be able to
-- save other changes without being forced to supply a number in the same
-- action, and the place that genuinely needs one — starting a new discovery
-- campaign for buyers or tenants — asks for it there, where the reason is
-- visible.
--
-- No backfill. There is nothing true to write.

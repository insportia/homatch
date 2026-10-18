-- Behaviour of 20261113090000_find_buyers_hide_opened_contacts (applied twice before this runs,
-- after the clear-results checks: the property's one UNLOCKED match is still visible).
\set ON_ERROR_STOP on
insert into public.matches (property_id, status) values ('aaaaaaaa-0000-0000-0000-00000000c1eb', 'UNLOCKED');
do $$
declare
  prop uuid := 'aaaaaaaa-0000-0000-0000-00000000c1ea';
  prop2 uuid := 'aaaaaaaa-0000-0000-0000-00000000c1eb';
  res jsonb; n int; before_total int;
begin
  select count(*) into before_total from public.matches;
  /* a stranger cannot hide someone else's opened contacts */
  perform set_config('app.uid', '22222222-2222-2222-2222-222222222222', true);
  begin perform public.find_buyers_hide_opened_contacts(prop); raise exception 'stranger hid'; exception when others then
    if sqlerrm <> 'FORBIDDEN' then raise; end if; end;

  perform set_config('app.uid', '11111111-1111-1111-1111-111111111111', true);
  res := public.find_buyers_hide_opened_contacts(prop);
  if (res->>'openedHidden')::int <> 1 then raise exception 'hidden %', res; end if;
  select count(*) into n from public.matches where property_id = prop and status = 'UNLOCKED' and owner_cleared_at is null;
  if n <> 0 then raise exception 'opened contact still visible'; end if;
  /* only UNLOCKED rows of this property: the running search's legacy match stays */
  select count(*) into n from public.matches where property_id = prop and job_id = 'bbbbbbbb-0000-0000-0000-00000000d0e2' and owner_cleared_at is null;
  if n <> 1 then raise exception 'running search legacy match hidden'; end if;
  /* the stranger's opened contact is untouched; nothing was deleted */
  select count(*) into n from public.matches where property_id = prop2 and status = 'UNLOCKED' and owner_cleared_at is null;
  if n <> 1 then raise exception 'other property touched'; end if;
  select count(*) into n from public.matches;
  if n <> before_total then raise exception 'rows deleted'; end if;
  /* idempotent */
  res := public.find_buyers_hide_opened_contacts(prop);
  if (res->>'openedHidden')::int <> 0 then raise exception 'not idempotent %', res; end if;
end $$;
select has_function_privilege('anon', 'public.find_buyers_hide_opened_contacts(uuid)', 'execute') as anon_can_hide;
select 'FIND BUYERS HIDE OPENED CONTACTS CHECKS PASS';

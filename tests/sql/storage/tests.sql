-- 20261107090000_storage_r2_routing: authorisation, routing switch, inventory.
create or replace function pg_temp.as_user(p_auth uuid) returns void language sql as $$
  select set_config('request.jwt.claims', case when p_auth is null then '' else json_build_object('sub', p_auth, 'role', 'authenticated')::text end, false) $$;
create or replace function pg_temp.ok(p_cond boolean, p_what text) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FAIL: %', p_what; end if; raise notice 'ok  %', p_what; end $$;

do $$
declare
  k text := 'meta-ads-media/aaaaaaaa-0000-0000-0000-00000000000a/ai/11111111-1111-1111-1111-111111111111/1.png';
  r text;
begin
  perform pg_temp.as_user(null);
  perform pg_temp.ok(public.storage_authorize(k, 'READ') = 'UNAUTHENTICATED', 'meta-ads: anonymous is refused');

  perform pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
  perform pg_temp.ok(public.storage_authorize(k, 'READ') = 'ALLOW', 'meta-ads: owner reads');
  perform pg_temp.ok(public.storage_authorize(k, 'WRITE') = 'ALLOW', 'meta-ads: owner writes');
  perform pg_temp.ok(public.storage_authorize(k, 'DELETE') = 'ALLOW', 'meta-ads: owner removes');
  perform pg_temp.ok(public.storage_authorize('meta-ads-media/a0000000-0000-0000-0000-00000000000a/x.png', 'WRITE') = 'NOT_OWNER',
    'meta-ads: the prefix is users.id, not the auth uid');
  perform pg_temp.ok(public.storage_authorize('meta-ads-media/not-a-uuid/x.png', 'READ') = 'INVALID_KEY', 'meta-ads: scope must be a uuid');

  perform pg_temp.as_user('b0000000-0000-0000-0000-00000000000b');
  perform pg_temp.ok(public.storage_authorize(k, 'READ') = 'NOT_OWNER', 'meta-ads: another account cannot read');
  perform pg_temp.ok(public.storage_authorize(k, 'WRITE') = 'NOT_OWNER', 'meta-ads: another account cannot write');
  perform pg_temp.ok(public.storage_authorize(k, 'DELETE') = 'NOT_OWNER', 'meta-ads: another account cannot remove');

  perform pg_temp.as_user('c0000000-0000-0000-0000-00000000000c');
  perform pg_temp.ok(public.storage_authorize(k, 'READ') = 'ALLOW', 'meta-ads: admin may read');
  perform pg_temp.ok(public.storage_authorize(k, 'WRITE') = 'NOT_OWNER', 'meta-ads: admin may not write someone''s file');
  perform pg_temp.ok(public.storage_authorize(k, 'DELETE') = 'NOT_OWNER', 'meta-ads: admin may not remove someone''s file');

  -- other namespaces unchanged (spot checks; the full body is hash-pinned by the matrix test)
  perform pg_temp.ok(public.storage_authorize('voice-auditions/x.mp3', 'READ') = 'ALLOW', 'voice-auditions: admin reads (unchanged)');
  perform pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
  perform pg_temp.ok(public.storage_authorize('voice-auditions/x.mp3', 'READ') = 'NOT_ADMIN', 'voice-auditions: staff only (unchanged)');
  perform pg_temp.ok(public.storage_authorize('verify-evidence/x', 'READ') = 'INVALID_KEY', 'an unmapped namespace stays refused');
end $$;

do $$
declare v jsonb; n int;
begin
  perform pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
  perform pg_temp.ok(public.storage_write_target('meta-ads-media') = 'SUPABASE', 'routing: every bucket starts on SUPABASE');
  perform pg_temp.ok(public.storage_write_target('deal-room-documents') = 'SUPABASE', 'routing: Deal Room starts on SUPABASE');
  perform pg_temp.ok(public.storage_write_target('verify-evidence') = 'SUPABASE', 'routing: an unrouted bucket is SUPABASE');
  begin
    perform public.storage_admin_set_write_target('meta-ads-media', 'R2', 'x');
    perform pg_temp.ok(false, 'routing: a non-admin cannot switch');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'routing: a non-admin cannot switch'); end;
  begin
    perform public.storage_admin_inventory();
    perform pg_temp.ok(false, 'inventory: a non-admin is refused');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'inventory: a non-admin is refused'); end;

  perform pg_temp.as_user('c0000000-0000-0000-0000-00000000000c');
  v := public.storage_admin_set_write_target('meta-ads-media', 'R2', 'verified copy');
  perform pg_temp.ok(v ->> 'meta-ads-media' = 'R2' and v ->> 'deal-room-documents' = 'SUPABASE', 'routing: admin moves one bucket, only that bucket');
  perform pg_temp.ok(public.storage_write_target('meta-ads-media') = 'R2', 'routing: the switch is read back');
  select count(*) into n from public.admin_audit_log where action = 'STORAGE_WRITE_TARGET_CHANGED' and entity_id = 'meta-ads-media'
    and metadata ->> 'from' = 'SUPABASE' and metadata ->> 'to' = 'R2';
  perform pg_temp.ok(n = 1, 'routing: the change is in the audit log with before and after');
  begin
    perform public.storage_admin_set_write_target('verify-evidence', 'R2', null);
    perform pg_temp.ok(false, 'routing: an unrouted bucket cannot be switched');
  exception when others then perform pg_temp.ok(sqlerrm = 'STORAGE_BUCKET_NOT_ROUTABLE', 'routing: an unrouted bucket cannot be switched'); end;
  begin
    perform public.storage_admin_set_write_target('meta-ads-media', 'S3', null);
    perform pg_temp.ok(false, 'routing: only R2 or SUPABASE');
  exception when others then perform pg_temp.ok(sqlerrm = 'STORAGE_BAD_TARGET', 'routing: only R2 or SUPABASE'); end;
  perform public.storage_admin_set_write_target('meta-ads-media', 'SUPABASE', 'rollback');
  perform pg_temp.ok(public.storage_write_target('meta-ads-media') = 'SUPABASE', 'routing: rollback is one call');

  v := public.storage_admin_inventory();
  perform pg_temp.ok((v -> 'totals' ->> 'supabase_objects')::int = 3 and (v -> 'totals' ->> 'supabase_bytes')::int = 157, 'inventory: Supabase totals');
  perform pg_temp.ok((select (b ->> 'copied_to_r2')::int from jsonb_array_elements(v -> 'supabase') b where b ->> 'bucket' = 'meta-ads-media') = 1,
    'inventory: verified copies are counted per bucket');
  perform pg_temp.ok((v -> 'totals' ->> 'r2_objects')::int = 2 and jsonb_array_length(v -> 'r2') = 2, 'inventory: R2 by namespace and category');
end $$;

do $$
begin
  perform pg_temp.ok(not has_function_privilege('anon', 'public.storage_write_target(text)', 'execute'), 'privileges: anon cannot read the switch');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.storage_admin_inventory()', 'execute'), 'privileges: anon cannot read the inventory');
  perform pg_temp.ok(has_function_privilege('authenticated', 'public.storage_write_target(text)', 'execute'), 'privileges: signed-in uploaders can read the switch');
end $$;

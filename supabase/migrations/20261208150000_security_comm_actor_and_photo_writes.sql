-- Security (release audit 2026-10-30): three grants that trusted the caller.
--
-- 1. comm_set_conversation_mode(conversation, expected, new, p_actor, reason) is executable by
--    every signed-in user and takes the actor from the request: with p_actor NULL the owner
--    check is skipped entirely. It was also BROKEN: `v_ok boolean ... return v_ok > 0` has no
--    boolean > integer operator, so every call raised and rolled its update back (the inbox
--    "take over" and the whatsapp / email webhooks' mode switches have never worked; the hole
--    was therefore never exploitable). Now the row count is an integer, and a signed-in caller
--    always acts as itself (auth.uid(); comm_conversations.owner_id is an auth id, and the inbox
--    already passes exactly that). The service role (webhooks, whatsapp-send) keeps passing
--    its actor, or NULL for the system.
-- 2. comm_publish_agent(agent, p_actor) has the same shape and was granted to authenticated,
--    but its only caller is the comm-agent edge function with the service role: browser roles
--    lose EXECUTE.
-- 3. storage.objects, bucket property-photos: INSERT and DELETE were open to any signed-in
--    user for any key (photos_upload_own / photos_delete_own_storage only checked
--    auth.uid() IS NOT NULL). The browser never writes there itself (uploads are signed by
--    storage-sign with the service role, keys users/<public.users.id>/property-photos/...),
--    so a direct write is now limited to the caller's own users/<id>/ folder. READ is left as
--    it is: signed-in people see other people's listing photos, and storage_authorize
--    (20260918213214) governs signed reads.
--
-- Idempotent. Nothing else changes; no data is touched.

create or replace function public.comm_set_conversation_mode(
  p_conversation_id uuid, p_expected_mode text, p_new_mode text, p_actor uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rows integer;
begin
  -- Never the request's word: a signed-in caller acts as itself, and only the service role
  -- (webhooks, the system) may name an actor or none.
  if coalesce(auth.role(), '') <> 'service_role' then
    if auth.uid() is null then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
    p_actor := auth.uid();
  end if;
  update public.comm_conversations
     set mode = p_new_mode,
         mode_changed_by = p_actor,
         mode_changed_at = now(),
         mode_change_reason = p_reason,
         updated_at = now()
   where id = p_conversation_id
     and (p_expected_mode is null or mode = p_expected_mode)
     and (p_actor is null
          or owner_id = p_actor
          or exists (select 1 from public.comm_conversations c2 where c2.id = p_conversation_id and c2.assigned_to = p_actor));
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end
$function$;
revoke all on function public.comm_set_conversation_mode(uuid, text, text, uuid, text) from public, anon;
grant execute on function public.comm_set_conversation_mode(uuid, text, text, uuid, text) to authenticated, service_role;

revoke all on function public.comm_publish_agent(uuid, uuid) from public, anon, authenticated;
grant execute on function public.comm_publish_agent(uuid, uuid) to service_role;

drop policy if exists "photos_upload_own" on storage.objects;
create policy "photos_upload_own" on storage.objects for insert
  with check (bucket_id = 'property-photos'
              and (storage.foldername(name))[1] = 'users'
              and (storage.foldername(name))[2] = public.auth_user_id()::text);

drop policy if exists "photos_delete_own_storage" on storage.objects;
create policy "photos_delete_own_storage" on storage.objects for delete
  using (bucket_id = 'property-photos'
         and (storage.foldername(name))[1] = 'users'
         and (storage.foldername(name))[2] = public.auth_user_id()::text);

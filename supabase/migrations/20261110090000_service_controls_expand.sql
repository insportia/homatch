-- SERVICE CONTROL CENTER, EXPANDED — every manageable HOMATCH product, one table.
--
-- Inventory and reasoning: docs/claude/SERVICE_CONTROLS_INVENTORY.md.
--
-- PRODUCTION STATE IS PRESERVED EXACTLY.
--   * The six original rows (publishing, ai_call_center, ai_talk, whatsapp, live_chat,
--     design_studio) are not touched: same switches, same version, same reason.
--   * Every new row is a product that is live today, so it is seeded ON/ON. A product
--     that is dormant today is dormant through ITS OWN setting (find_property_social_enabled,
--     email_studio_sending_enabled, ...), which this migration does not read or write:
--     the switch here only sits in front of it.
--
-- NO GLOBAL KILL SWITCH. Pausing more than one service is per GROUP, and the caller
-- must type the group's name, checked here (service_control_pause_group). The old
-- service_control_pause_all keeps exactly its old reach: the original six keys.
--
-- Additive: one CHECK widened (same column, more allowed values), one column added with a
-- default, rows inserted with ON CONFLICT DO NOTHING, functions added or narrowed, one
-- BEFORE INSERT guard. Nothing is dropped, deleted or rewritten.

-- 1. The wider list of services.
alter table public.service_controls drop constraint service_controls_service_key_check;
alter table public.service_controls add constraint service_controls_service_key_check check (service_key in (
  'publishing', 'ai_call_center', 'ai_talk', 'whatsapp', 'live_chat', 'design_studio',
  'find_property', 'find_property_deep', 'find_buyers',
  'verify', 'contracts', 'mortgage', 'investment', 'for_expats',
  'meta_ads', 'email_campaigns',
  'ai_assistant',
  'brokers_directory', 'broker_desk', 'developers'));

-- 2. Groups, for the Admin layout and for group pause.
alter table public.service_controls add column service_group text not null default 'other';
update public.service_controls set service_group = case service_key
    when 'publishing' then 'publishing'
    when 'design_studio' then 'design'
    else 'communications' end
  where service_group = 'other';
alter table public.service_controls add constraint service_controls_group_check check (service_group in (
  'discovery', 'intelligence', 'marketing', 'communications', 'assistant', 'professionals', 'design', 'publishing', 'other'));

-- 3. The live products, seeded as they are today: visible and running.
insert into public.service_controls (service_key, frontend_enabled, backend_enabled, service_group, reason) values
  ('find_property',      true, true, 'discovery',     'Initial state: live (matches production)'),
  ('find_property_deep', true, true, 'discovery',     'Initial state: live (matches production; its own switch find_property_social_enabled still applies)'),
  ('find_buyers',        true, true, 'discovery',     'Initial state: live (matches production)'),
  ('verify',             true, true, 'intelligence',  'Initial state: live (matches production)'),
  ('contracts',          true, true, 'intelligence',  'Initial state: live (matches production)'),
  ('mortgage',           true, true, 'intelligence',  'Initial state: live (matches production)'),
  ('investment',         true, true, 'intelligence',  'Initial state: live (matches production)'),
  ('for_expats',         true, true, 'intelligence',  'Initial state: live (matches production)'),
  ('meta_ads',           true, true, 'marketing',     'Initial state: live (matches production; its own meta_ads_* switches still apply)'),
  ('email_campaigns',    true, true, 'marketing',     'Initial state: live (matches production; sending stays off through its own switches)'),
  ('ai_assistant',       true, true, 'assistant',     'Initial state: live (matches production)'),
  ('brokers_directory',  true, true, 'professionals', 'Initial state: live (matches production)'),
  ('broker_desk',        true, true, 'professionals', 'Initial state: live (matches production)'),
  ('developers',         true, true, 'professionals', 'Initial state: live (matches production)')
on conflict (service_key) do nothing;

-- 4. "Pause all six" keeps exactly its old reach. Same signature, same audit action.
create or replace function public.service_control_pause_all(p_reason text, p_request_id text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_admin uuid;
  v_row public.service_controls;
  v_changed text[] := '{}';
begin
  select u.id into v_admin from public.users u where u.auth_id = auth.uid() and u.is_admin = true;
  if v_admin is null then raise exception 'FORBIDDEN'; end if;
  if p_reason is not null and length(p_reason) > 500 then raise exception 'INVALID_ARGUMENT'; end if;
  if p_request_id is not null and length(p_request_id) > 100 then raise exception 'INVALID_ARGUMENT'; end if;
  for v_row in select * from public.service_controls
      where service_key in ('publishing', 'ai_call_center', 'ai_talk', 'whatsapp', 'live_chat', 'design_studio')
      order by service_key for update loop
    if v_row.frontend_enabled or v_row.backend_enabled then
      update public.service_controls set frontend_enabled = false, backend_enabled = false, version = version + 1,
        reason = nullif(btrim(coalesce(p_reason, '')), ''), updated_by = v_admin, updated_at = now()
       where service_key = v_row.service_key;
      insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
      values (v_admin, 'SERVICE_CONTROL_PAUSE_ALL', 'service_controls', v_row.service_key, jsonb_build_object(
        'result', 'CHANGED', 'request_id', p_request_id, 'reason', p_reason,
        'before', jsonb_build_object('frontend', v_row.frontend_enabled, 'backend', v_row.backend_enabled, 'version', v_row.version),
        'after', jsonb_build_object('frontend', false, 'backend', false, 'version', v_row.version + 1)));
      v_changed := v_changed || v_row.service_key;
    end if;
  end loop;
  return jsonb_build_object('result', case when cardinality(v_changed) = 0 then 'UNCHANGED' else 'CHANGED' end, 'changed', to_jsonb(v_changed));
end $$;

-- 5. Pause one group, with a typed confirmation. Never more than one group per call.
create function public.service_control_pause_group(p_group text, p_confirm text, p_reason text, p_request_id text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_admin uuid;
  v_row public.service_controls;
  v_changed text[] := '{}';
begin
  select u.id into v_admin from public.users u where u.auth_id = auth.uid() and u.is_admin = true;
  if v_admin is null then raise exception 'FORBIDDEN'; end if;
  if p_group is null or p_group = 'other' or not exists (select 1 from public.service_controls where service_group = p_group) then
    raise exception 'GROUP_UNKNOWN';
  end if;
  -- The confirmation is the group's own key, typed by the admin: a click alone cannot do this.
  if p_confirm is distinct from p_group then raise exception 'CONFIRMATION_REQUIRED'; end if;
  if p_reason is not null and length(p_reason) > 500 then raise exception 'INVALID_ARGUMENT'; end if;
  if p_request_id is not null and length(p_request_id) > 100 then raise exception 'INVALID_ARGUMENT'; end if;
  for v_row in select * from public.service_controls where service_group = p_group order by service_key for update loop
    if v_row.frontend_enabled or v_row.backend_enabled then
      update public.service_controls set frontend_enabled = false, backend_enabled = false, version = version + 1,
        reason = nullif(btrim(coalesce(p_reason, '')), ''), updated_by = v_admin, updated_at = now()
       where service_key = v_row.service_key;
      insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
      values (v_admin, 'SERVICE_CONTROL_PAUSE_GROUP', 'service_controls', v_row.service_key, jsonb_build_object(
        'result', 'CHANGED', 'group', p_group, 'request_id', p_request_id, 'reason', p_reason,
        'before', jsonb_build_object('frontend', v_row.frontend_enabled, 'backend', v_row.backend_enabled, 'version', v_row.version),
        'after', jsonb_build_object('frontend', false, 'backend', false, 'version', v_row.version + 1)));
      v_changed := v_changed || v_row.service_key;
    end if;
  end loop;
  return jsonb_build_object('result', case when cardinality(v_changed) = 0 then 'UNCHANGED' else 'CHANGED' end, 'group', p_group, 'changed', to_jsonb(v_changed));
end $$;
revoke all on function public.service_control_pause_group(text, text, text, text) from public, anon;
grant execute on function public.service_control_pause_group(text, text, text, text) to authenticated, service_role;

-- 6. BROKERS DIRECTORY: a new paid listing is written by broker_directory_purchase() in one
-- statement, so refusing the row rolls the whole purchase back, credits included.
-- Existing listings, renewals already paid, and the expiry sweep are untouched.
create trigger trg_0_service_control_guard before insert on public.broker_listing_purchases
  for each row execute function public.service_control_guard('brokers_directory');

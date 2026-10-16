-- Service Control Center: proofs on a throwaway database.
\set ON_ERROR_STOP on
create or replace function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if; raise notice 'PASS  %', msg; end $$;
create or replace function pg_temp.as_user(sub text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(sub, ''), false); end $$;
create or replace function pg_temp.raises(stmt text, code text) returns boolean language plpgsql as $$
begin execute stmt; return false; exception when others then return sqlerrm = code; end $$;

-- 1. initial state: exactly the six, all OFF
select pg_temp.ok((select count(*) = 6 and bool_and(not frontend_enabled and not backend_enabled) from public.service_controls), 'six services, all OFF at install');
select pg_temp.ok((select array_agg(service_key order by service_key) from public.service_controls) = array['ai_call_center','ai_talk','design_studio','live_chat','publishing','whatsapp'], 'exactly the six required keys');
select pg_temp.ok(pg_temp.raises($$insert into public.service_controls(service_key) values ('find_property')$$, 'new row for relation "service_controls" violates check constraint "service_controls_service_key_check"'), 'an unrelated product cannot be added');
select pg_temp.ok(pg_temp.raises($$update public.service_controls set frontend_enabled = true where service_key = 'ai_talk'$$, 'new row for relation "service_controls" violates check constraint "service_controls_visible_needs_backend"'), 'visible-but-not-running cannot be stored');

-- 2. permissions: anon / customer / admin
set role anon;
select pg_temp.ok((select count(*) = 6 from public.service_controls_public()), 'anon reads the public visibility');
select pg_temp.ok(pg_temp.raises($$select * from public.service_controls$$, 'permission denied for table service_controls'), 'anon cannot read the table');
select pg_temp.ok(pg_temp.raises($$select public.service_control_set('ai_talk', true, true, 1, null, null)$$, 'permission denied for function service_control_set'), 'anon cannot call the write');
select pg_temp.ok(pg_temp.raises($$select public.service_control_pause_all(null, null)$$, 'permission denied for function service_control_pause_all'), 'anon cannot pause all');
reset role;
select pg_temp.as_user('b0000000-0000-0000-0000-00000000000b');
set role authenticated;
select pg_temp.ok(pg_temp.raises($$select * from public.service_controls$$, 'permission denied for table service_controls'), 'a customer cannot read the full rows');
select pg_temp.ok(pg_temp.raises($$select public.service_control_set('ai_talk', true, true, 1, null, null)$$, 'FORBIDDEN'), 'a customer cannot change a service');
select pg_temp.ok(pg_temp.raises($$select public.service_control_pause_all(null, null)$$, 'FORBIDDEN'), 'a customer cannot pause all');
select pg_temp.ok(pg_temp.raises($$update public.service_controls set backend_enabled = true$$, 'permission denied for table service_controls'), 'a customer cannot write the table directly');
reset role;
select pg_temp.ok((select count(*) = 0 from public.admin_audit_log), 'refused callers leave no audit row and no change');

-- 3. admin: change, idempotent repeat, conflict, coupling, audit
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
set role authenticated;
select pg_temp.ok((select public.service_control_set('ai_talk', false, true, 1, 'backend first', 'req-1')->>'result') = 'CHANGED', 'admin enables the backend (version 1 → 2)');
select pg_temp.ok((select public.service_control_set('ai_talk', false, true, 2, 'double click', 'req-2')->>'result') = 'UNCHANGED', 'a repeated click is a no-op');
select pg_temp.ok((select public.service_control_set('ai_talk', true, true, 1, 'stale tab', 'req-3')->>'result') = 'CONFLICT', 'a stale version is refused');
reset role;
select pg_temp.ok((select frontend_enabled = false and backend_enabled = true and version = 2 from public.service_controls where service_key = 'ai_talk'), 'the stale write changed nothing');
set role authenticated;
select pg_temp.ok(pg_temp.raises($$select public.service_control_set('ai_talk', true, false, 2, null, null)$$, 'FRONTEND_REQUIRES_BACKEND'), 'frontend without backend is refused');
select pg_temp.ok(pg_temp.raises($$select public.service_control_set('find_property', false, false, 1, null, null)$$, 'SERVICE_UNKNOWN'), 'unknown service refused');
select pg_temp.ok((select public.service_control_set('ai_talk', true, true, 2, 'then visible', 'req-4')->>'result') = 'CHANGED', 'then the frontend (version 3)');
select pg_temp.ok((select public.service_control_set('design_studio', false, true, 1, null, 'req-5')->>'result') = 'CHANGED', 'a second service changes independently');
reset role;
select pg_temp.ok((select count(*) = 5 from public.admin_audit_log where action = 'SERVICE_CONTROL_SET'), 'every admin attempt is audited, including no-op and conflict');
select pg_temp.ok((select metadata->>'result' = 'CONFLICT' and metadata->>'request_id' = 'req-3' and metadata->'before'->>'version' = '2' from public.admin_audit_log where metadata->>'request_id' = 'req-3'), 'the conflict audit names the request and the real version');
select pg_temp.ok((select updated_by = 'aaaaaaaa-0000-0000-0000-00000000000a' and reason = 'then visible' from public.service_controls where service_key = 'ai_talk'), 'who and why are stored on the row');

-- 4. pause all: atomic, only the six, idempotent
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
set role authenticated;
select pg_temp.ok((select public.service_control_pause_all('owner pause', 'req-6')->'changed') = '["ai_talk", "design_studio"]'::jsonb, 'pause all switches off exactly the services that were on');
select pg_temp.ok((select public.service_control_pause_all('again', 'req-7')->>'result') = 'UNCHANGED', 'a second pause all is a no-op');
reset role;
select pg_temp.ok((select bool_and(not frontend_enabled and not backend_enabled) from public.service_controls), 'all six OFF after pause all');
select pg_temp.ok((select count(*) = 2 from public.admin_audit_log where action = 'SERVICE_CONTROL_PAUSE_ALL'), 'one audit row per service that changed');
select pg_temp.ok((select version = 4 from public.service_controls where service_key = 'ai_talk'), 'pause all bumps the version (stale tabs conflict afterwards)');

-- 5. service role (edge functions) can read; the public function never leaks who/why
set role service_role;
select pg_temp.ok((select count(*) = 6 from public.service_controls), 'the service role reads every row');
reset role;
select pg_temp.ok((select pg_get_function_result('public.service_controls_public'::regproc)) = 'TABLE(service_key text, frontend_enabled boolean, backend_enabled boolean)', 'the public read exposes only key / frontend / backend');

-- 6. Live Chat: the database refuses new messages/reactions while paused; history stays
select pg_temp.ok(pg_temp.raises($$insert into public.live_chat_messages(user_id, body) values ('bbbbbbbb-0000-0000-0000-00000000000b', 'new')$$, 'SERVICE_DISABLED'), 'paused Live Chat refuses a new message');
select pg_temp.ok(pg_temp.raises($$insert into public.live_chat_reactions(message_id, user_id, emoji) values (1, 'bbbbbbbb-0000-0000-0000-00000000000b', 'x')$$, 'SERVICE_DISABLED'), 'paused Live Chat refuses a new reaction');
select pg_temp.ok((select count(*) = 1 from public.burst_log), 'a refused message leaves no side effects (no burst strike)');
select pg_temp.ok((select count(*) = 1 from public.live_chat_messages), 'existing history is untouched');
select pg_temp.ok((select public.service_backend_enabled('live_chat')) = false and (select public.service_backend_enabled('nonsense')) = false, 'service_backend_enabled: paused and unknown are false');
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
set role authenticated;
select pg_temp.ok((select public.service_control_set('live_chat', false, true, 1, 'reopen', 'req-8')->>'result') = 'CHANGED', 'admin turns the Live Chat backend on');
reset role;
insert into public.live_chat_messages (user_id, body) values ('bbbbbbbb-0000-0000-0000-00000000000b', 'after reactivation');
select pg_temp.ok((select count(*) = 2 from public.live_chat_messages) and (select count(*) = 2 from public.burst_log), 'with the backend on, messages flow through the existing guards again');

-- 7. Design Studio: no new project while paused; existing projects remain
select pg_temp.ok(pg_temp.raises($$insert into public.ds_projects(owner_id, name) values ('bbbbbbbb-0000-0000-0000-00000000000b', 'new')$$, 'SERVICE_DISABLED'), 'paused Design Studio refuses a new project');
select pg_temp.ok((select count(*) = 1 from public.ds_projects), 'the existing project is untouched');
update public.ds_projects set name = 'renamed' where name = 'existing project';
select pg_temp.ok((select count(*) = 1 from public.ds_projects where name = 'renamed'), 'existing projects stay editable (only creation is paused)');

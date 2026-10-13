/** Generates transaction-only integration tests in pg_temp, with synthetic users.
 * No HOMATCH tables are written. Every created object disappears on ROLLBACK.
 * May run on local PostgreSQL or via the connected SQL tool; never treats this as a migration.
 */
import { readFileSync } from 'node:fs';
const source = readFileSync(
  new URL('../schema/proposed.sql', import.meta.url),
  'utf8',
);
let sql = source
  .replace(/^create schema if not exists publisher_private;\r?\n/m, '')
  .replace(
    /^revoke all on schema publisher_private from public, anon, authenticated;\r?\n/m,
    '',
  )
  .replace(
    /^grant usage on schema publisher_private to service_role;\r?\n/m,
    '',
  )
  .replaceAll('publisher_private.', 'pg_temp.')
  .replaceAll('public.', 'pg_temp.')
  .replaceAll('in schema publisher_private', 'in schema pg_temp')
  .replace('revoke all on all tables in schema pg_temp from public,anon,authenticated;',()=>"revoke all on pg_temp.sessions,pg_temp.controls,pg_temp.worker_health from public,anon,authenticated;")
  .replace(
    'grant all on all tables in schema pg_temp to service_role;',
    () =>
      "do $$ begin execute format('grant all on all tables in schema %I to service_role',pg_my_temp_schema()::regnamespace::text); end $$;",
  )
  .replaceAll('create table pg_temp.', 'create temporary table pg_temp.');
if (/\b(?:public|publisher_private)\./.test(sql) || /create schema/.test(sql))
  throw new Error('TEST_SCHEMA_ISOLATION_FAILED');
console.log(
  `begin;
set local statement_timeout='20s';
create temporary table publisher_test_results(test text primary key,passed boolean not null);
create temporary table users(id uuid primary key,auth_id uuid unique,is_admin boolean default false,suspended_at timestamptz);
create temporary table properties(id uuid primary key,user_id uuid references pg_temp.users(id),is_deleted boolean default false);
do $$ begin execute format('grant usage on schema %I to authenticated,service_role',pg_my_temp_schema()::regnamespace::text); end $$;
grant select on pg_temp.users,pg_temp.properties to authenticated;
grant all on pg_temp.users,pg_temp.properties,pg_temp.publisher_test_results to service_role;
grant select,insert on pg_temp.publisher_test_results to authenticated;
create function pg_temp.get_user_id() returns uuid language sql stable security invoker as 'select id from pg_temp.users where auth_id=auth.uid()';
create function pg_temp.assert_true(test_name text, valid boolean) returns void language plpgsql security invoker as $$
begin if valid is distinct from true then raise exception 'TEST_FAILED: %',test_name; end if;
insert into pg_temp.publisher_test_results values(test_name,true); end $$;
insert into pg_temp.users(id,auth_id) values
('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
('22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into pg_temp.properties(id,user_id) values('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111');
${sql}
set local role service_role;
insert into pg_temp.publisher_portals(id,domain,name,adapter_version,verification,permission,operations,enabled,maintenance)
values('myhome','myhome.ge','Synthetic test portal','test','MOCK_TESTED','verified','{"publish":true,"update":true,"remove":true,"status":true}',true,false);
insert into pg_temp.publisher_accounts(id,user_id,portal_id,status) values
('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','myhome','connected'),
('55555555-5555-4555-8555-555555555555','22222222-2222-4222-8222-222222222222','myhome','connected');
insert into pg_temp.publisher_versions(id,property_id,user_id,version,normalized,fingerprint)
values('66666666-6666-4666-8666-666666666666','33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',1,
'{"ownerId":"11111111-1111-4111-8111-111111111111","price":{"amount":160000,"currency":"USD"}}',repeat('a',64));
insert into pg_temp.publisher_selections(property_id,user_id,portal_ids) values('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',array['myhome']);
update pg_temp.controls set enabled=true;
create temporary table enqueued as select * from pg_temp.publisher_enqueue('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','66666666-6666-4666-8666-666666666666',array['myhome'],'publish','77777777-7777-4777-8777-777777777777');
select pg_temp.assert_true('enqueue selected portal only',(select count(*)=1 from pg_temp.enqueued));
perform_placeholder
select pg_temp.assert_true('idempotent confirmation',(select count(*)=1 from pg_temp.publisher_jobs));
do $$ begin
  begin perform pg_temp.publisher_enqueue('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','66666666-6666-4666-8666-666666666666',array['myhome'],'publish','88888888-8888-4888-8888-888888888888');
    raise exception 'UNEXPECTED_SUCCESS';
  exception when others then if SQLERRM<>'PROPERTY_NOT_OWNED' then raise; end if; end;
  perform pg_temp.assert_true('cross-user enqueue rejected',true);
  begin perform pg_temp.publisher_enqueue('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','66666666-6666-4666-8666-666666666666',array['myhome','ss'],'publish','88888888-8888-4888-8888-888888888888');
    raise exception 'UNEXPECTED_SUCCESS';
  exception when others then if SQLERRM<>'SELECTION_NOT_CONFIRMED' then raise; end if; end;
  perform pg_temp.assert_true('unselected portal rejected',true);
  begin update pg_temp.publisher_versions set normalized='{}'; raise exception 'UNEXPECTED_SUCCESS';
  exception when others then if SQLERRM<>'IMMUTABLE_PROPERTY_VERSION' then raise; end if; end;
  perform pg_temp.assert_true('versions immutable',true);
end $$;
create temporary table claimed as select * from pg_temp.publisher_claim('test-worker',120);
select pg_temp.assert_true('atomic claim returns leased job',(select count(*)=1 from pg_temp.claimed where state='running' and lease_token is not null and attempts=1));
select pg_temp.assert_true('second claim cannot take leased account',(select count(*)=0 from pg_temp.publisher_claim('second-worker',120)));
select pg_temp.assert_true('wrong lease cannot heartbeat',not pg_temp.publisher_heartbeat((select id from pg_temp.claimed),'99999999-9999-4999-8999-999999999999',120));
select pg_temp.assert_true('wrong lease cannot commit',not pg_temp.publisher_finish((select id from pg_temp.claimed),'99999999-9999-4999-8999-999999999999','failed'));
select pg_temp.assert_true('real lease heartbeat',pg_temp.publisher_heartbeat((select id from pg_temp.claimed),(select lease_token from pg_temp.claimed),120));
select pg_temp.assert_true('context preserves owner mapping',(pg_temp.publisher_context((select id from pg_temp.claimed),(select lease_token from pg_temp.claimed))->>'userId')='11111111-1111-4111-8111-111111111111');
select pg_temp.assert_true('worker enabled initially',pg_temp.publisher_allowed((select id from pg_temp.claimed),(select lease_token from pg_temp.claimed),'myhome'));
update pg_temp.controls set enabled=false;
select pg_temp.assert_true('kill switch revokes permission',not pg_temp.publisher_allowed((select id from pg_temp.claimed),(select lease_token from pg_temp.claimed),'myhome'));
update pg_temp.controls set enabled=true;
select pg_temp.publisher_event((select id from pg_temp.claimed),(select lease_token from pg_temp.claimed),'submitting',true);
select pg_temp.assert_true('potentially accepted mutation cannot be cancelled',not pg_temp.publisher_cancel('11111111-1111-4111-8111-111111111111',(select id from pg_temp.claimed)));
do $$ begin
  begin perform pg_temp.publisher_finish((select id from pg_temp.claimed),(select lease_token from pg_temp.claimed),'retry',null,now()+interval '1 minute'); raise exception 'UNEXPECTED_SUCCESS';
  exception when others then if SQLERRM<>'RECONCILIATION_REQUIRED' then raise; end if; end;
  perform pg_temp.assert_true('accepted submission cannot blindly retry',true);
  begin perform pg_temp.publisher_finish((select id from pg_temp.claimed),(select lease_token from pg_temp.claimed),'succeeded',null,null,'{"externalId":"synthetic","externalUrl":"https://evil.example/listing","status":"published"}'); raise exception 'UNEXPECTED_SUCCESS';
  exception when others then if SQLERRM<>'INVALID_PORTAL_RESULT' then raise; end if; end;
  perform pg_temp.assert_true('external URL domain checked',true);
end $$;
update pg_temp.publisher_jobs set leased_until=now()-interval '1 second';
update pg_temp.publisher_portals set next_start_at=now()-interval '1 second';
select * from pg_temp.publisher_claim('recovery-worker',120);
select pg_temp.assert_true('crash after submission requires reconciliation',(select bool_and(state='action_required') from pg_temp.publisher_jobs));
select pg_temp.assert_true('expired attempt closed',(select bool_and(ended_at is not null and outcome='lease_expired') from pg_temp.publisher_attempts));
select pg_temp.assert_true('owner can request reconciliation',pg_temp.publisher_retry('11111111-1111-4111-8111-111111111111',(select id from pg_temp.claimed)));
select pg_temp.assert_true('retry preserves ambiguous submission flag',(select bool_and(submission_started and state='retry') from pg_temp.publisher_jobs));
create temporary table reclaimed as select * from pg_temp.publisher_claim('reconciliation-worker',120);
select pg_temp.assert_true('reclaimed job has a fresh fenced attempt',(select count(*)=1 from pg_temp.reclaimed where attempts=2 and lease_token<>(select lease_token from pg_temp.claimed)));
select pg_temp.assert_true('old worker cannot commit reclaimed job',not pg_temp.publisher_finish((select id from pg_temp.claimed),(select lease_token from pg_temp.claimed),'failed'));
select pg_temp.assert_true('verified result commits transactionally',pg_temp.publisher_finish((select id from pg_temp.reclaimed),(select lease_token from pg_temp.reclaimed),'succeeded',null,null,'{"externalId":"synthetic-test-only","externalUrl":"https://www.myhome.ge/synthetic-test-only","externalVersion":"fixture-v1","status":"awaiting_moderation"}'));
select pg_temp.assert_true('moderation not presented as published',(select bool_and(status='awaiting_moderation' and current_price=160000 and current_currency='USD' and applied_version=1 and last_synced_at is not null) from pg_temp.publisher_publications));
select pg_temp.assert_true('job phase preserves moderation',(select bool_and(phase='awaiting_moderation' and state='succeeded') from pg_temp.publisher_jobs));
select pg_temp.assert_true('attempt outcomes closed',(select bool_and(ended_at is not null) from pg_temp.publisher_attempts));
do $$ begin
  begin update pg_temp.publisher_jobs set user_id='22222222-2222-4222-8222-222222222222'; raise exception 'UNEXPECTED_SUCCESS';
  exception when others then if SQLERRM<>'IMMUTABLE_JOB_IDENTITY' then raise; end if; end;
  perform pg_temp.assert_true('job tenant identity is immutable',true);
end $$;
update pg_temp.publisher_jobs set state='action_required',submission_started=false,error_code='VALIDATION_FAILED';
select pg_temp.assert_true('unsubmitted validation failure can be cancelled',pg_temp.publisher_cancel('11111111-1111-4111-8111-111111111111',(select id from pg_temp.claimed)));
select pg_temp.assert_true('safe cancellation releases mutation state',(select bool_and(state='cancelled') from pg_temp.publisher_jobs));
update pg_temp.properties set is_deleted=true;
update pg_temp.publisher_jobs set state='running',submission_started=true,lease_token='99999999-9999-4999-8999-999999999999',leased_until=now()-interval '1 second';
update pg_temp.publisher_portals set next_start_at=now()-interval '1 second';
select * from pg_temp.publisher_claim('deleted-property-cleanup',120);
select pg_temp.assert_true('deleted source cannot block lease recovery',(select bool_and(state='action_required') from pg_temp.publisher_jobs));
update pg_temp.properties set is_deleted=false;
update pg_temp.publisher_jobs set state='succeeded',phase='awaiting_moderation',lease_token=null,leased_until=null;
create temporary table normalized_snapshot as select pg_temp.publisher_snapshot('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','{"id":"33333333-3333-4333-8333-333333333333","ownerId":"11111111-1111-4111-8111-111111111111","version":1,"price":{"amount":155000,"currency":"USD"}}') value;
select pg_temp.assert_true('snapshot is versioned and returns API JSON',(select (value->>'version')::int=2 and value->>'id' is not null from pg_temp.normalized_snapshot));
select pg_temp.assert_true('identical snapshot deduplicated',(pg_temp.publisher_snapshot('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','{"id":"33333333-3333-4333-8333-333333333333","ownerId":"11111111-1111-4111-8111-111111111111","version":1,"price":{"amount":155000,"currency":"USD"}}')->>'id')=(select value->>'id' from pg_temp.normalized_snapshot));
do $$ begin
  begin perform pg_temp.publisher_admin('11111111-1111-4111-8111-111111111111','snapshot'); raise exception 'UNEXPECTED_SUCCESS';
  exception when others then if SQLERRM<>'ADMIN_REQUIRED' then raise; end if; end;
  perform pg_temp.assert_true('non-admin denied monitoring',true);
end $$;
update pg_temp.users set is_admin=true where id='11111111-1111-4111-8111-111111111111';
select pg_temp.assert_true('admin kill switch audited',(pg_temp.publisher_admin('11111111-1111-4111-8111-111111111111','kill_switch',null,false)->>'enabled')::boolean=false);
select pg_temp.assert_true('disconnect cleans authorized session state',pg_temp.publisher_disconnect('11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444'));
select pg_temp.assert_true('revoked account is disconnected',(select status='disconnected' and revoked_at is not null from pg_temp.publisher_accounts where id='44444444-4444-4444-8444-444444444444'));
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
select pg_temp.assert_true('owner sees own account',(select count(*)=1 from pg_temp.publisher_accounts));
select pg_temp.assert_true('owner sees own job',(select count(*)=1 from pg_temp.publisher_jobs));
select pg_temp.assert_true('owner sees own publication',(select count(*)=1 from pg_temp.publisher_publications));
select pg_temp.assert_true('owner sees own version',(select count(*)=2 from pg_temp.publisher_versions));
select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
select pg_temp.assert_true('other user cannot read jobs',(select count(*)=0 from pg_temp.publisher_jobs));
select pg_temp.assert_true('other user cannot read versions',(select count(*)=0 from pg_temp.publisher_versions));
select pg_temp.assert_true('other user cannot read publications',(select count(*)=0 from pg_temp.publisher_publications));
select pg_temp.assert_true('other user cannot read audit events',(select count(*)=0 from pg_temp.publisher_events));
select pg_temp.assert_true('authenticated cannot enqueue directly',not has_function_privilege('authenticated','pg_temp.publisher_enqueue(uuid,uuid,uuid,text[],text,uuid)','execute'));
select pg_temp.assert_true('authenticated cannot claim',not has_function_privilege('authenticated','pg_temp.publisher_claim(text,integer)','execute'));
select pg_temp.assert_true('authenticated cannot read encrypted sessions',not has_table_privilege('authenticated','pg_temp.sessions','select'));
select pg_temp.assert_true('authenticated cannot forge connected account',not has_table_privilege('authenticated','pg_temp.publisher_accounts','insert'));
select pg_temp.assert_true('authenticated cannot forge success',not has_table_privilege('authenticated','pg_temp.publisher_publications','update'));
select pg_temp.assert_true('anonymous cannot read accounts',not has_table_privilege('anon','pg_temp.publisher_accounts','select'));
reset role;
select jsonb_build_object('tests',(select count(*) from pg_temp.publisher_test_results),'passed',(select bool_and(passed) from pg_temp.publisher_test_results),'mode','temporary_objects_rollback','names',(select jsonb_agg(test order by test) from pg_temp.publisher_test_results)) as publisher_database_test_result;
rollback;`.replace(
    'perform_placeholder',
    `select * from pg_temp.publisher_enqueue('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','66666666-6666-4666-8666-666666666666',array['myhome'],'publish','77777777-7777-4777-8777-777777777777');`,
  ),
);

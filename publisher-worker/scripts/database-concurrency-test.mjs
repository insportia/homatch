// Full-schema transaction race test for the disposable CI PostgreSQL service only.
// Refuses non-local hosts and any database name other than publisher_test.
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
if (process.env.HOMATCH_PUBLISHER_DISPOSABLE_DB !== '1' || process.env.PGDATABASE !== 'publisher_test' || !['localhost','127.0.0.1'].includes(process.env.PGHOST)) throw new Error('DISPOSABLE_LOCAL_DATABASE_REQUIRED');
function psql(sql) {
  return new Promise((resolve,reject)=>{
    const child=spawn('psql',['-X','-A','-t','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    let output='';child.stdout.on('data',part=>{output+=part;});child.stderr.on('data',()=>{});
    child.once('error',()=>reject(new Error('PSQL_UNAVAILABLE')));
    child.once('exit',code=>code===0?resolve(output):reject(new Error('DATABASE_TEST_FAILED')));
    child.stdin.end(sql);
  });
}
const schema=readFileSync(new URL('../schema/proposed.sql',import.meta.url),'utf8');
await psql(`begin;
create table public.users(id uuid primary key,auth_id uuid unique,is_admin boolean default false,suspended_at timestamptz);
create table public.properties(id uuid primary key,user_id uuid references public.users(id),is_deleted boolean default false);
grant select on public.users,public.properties to authenticated;
grant all on public.users,public.properties to service_role;
create function public.get_user_id() returns uuid language sql stable as 'select id from public.users where auth_id=auth.uid()';
${schema}
insert into public.users(id,auth_id) values('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.properties(id,user_id) values('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111');
insert into public.publisher_portals(id,domain,name,adapter_version,verification,permission,operations,enabled,maintenance)
values('myhome','myhome.ge','Synthetic CI portal','test','MOCK_TESTED','verified','{"publish":true}',true,false);
insert into public.publisher_accounts(id,user_id,portal_id,status) values('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','myhome','connected');
insert into public.publisher_versions(id,property_id,user_id,version,normalized,fingerprint) values('66666666-6666-4666-8666-666666666666','33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',1,'{"ownerId":"11111111-1111-4111-8111-111111111111"}',repeat('a',64));
insert into public.publisher_selections(property_id,user_id,portal_ids) values('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',array['myhome']);
update publisher_private.controls set enabled=true;
select * from public.publisher_enqueue('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','66666666-6666-4666-8666-666666666666',array['myhome'],'publish','77777777-7777-4777-8777-777777777777');
commit;`);
await Promise.all(['race-worker-one','race-worker-two'].map(worker=>psql(`begin;set local role service_role;select * from public.publisher_claim('${worker}',120);select pg_sleep(0.5);commit;`)));
const count=await psql("select count(*) from public.publisher_jobs where state='running';");
assert.equal(count.trim(),'1','Two concurrent workers must not claim the same job/account');
const attempts=await psql('select count(*) from public.publisher_attempts;');
assert.equal(attempts.trim(),'1','Only the successful claim creates an attempt');
console.log('PASS: concurrent claims preserve one lease and one attempt');

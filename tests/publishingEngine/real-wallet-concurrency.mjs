import assert from 'node:assert/strict';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
if(process.env.PUBLISHING_REAL_WALLET_PROOF!=='isolated-postgres-17')throw Error('ISOLATED_DATABASE_REQUIRED');
const args=['-h','localhost','-U','postgres','-d','publishing_wallet_proof','-X','-qAt','-v','ON_ERROR_STOP=1'];
const run=sql=>execFileSync('psql',[...args,'-c',sql],{encoding:'utf8'}).trim();
const asyncExec=promisify(execFile),owner='11111111-1111-4111-8111-111111111111';
run(`begin;set local request.jwt.claims='{"role":"service_role"}';
select public.wallet_admin_adjust('${owner}',100,'Isolated concurrency test','publishing:concurrency:seed');
do $$declare l jsonb;begin
 l:=public.publishing_engine_save_draft('${owner}',null,0,'{"title":"Isolated concurrent billing fixture","portalTargets":["myhome","ssge"]}');
 perform public.publishing_engine_activate('${owner}',(l->>'id')::uuid,10,true);
 insert into public.publishing_engine_publications(listing_id,user_id,portal_id,external_id,observed_state,synced_revision,verified_at)
 select (l->>'id')::uuid,'${owner}',p,'ISOLATED-CONCURRENCY-'||p,'PUBLISHED',1,now() from unnest(array['myhome','ssge']) p;
end$$;commit;`);
const workers=await Promise.all(Array.from({length:8},()=>asyncExec('psql',[...args,'-c',`begin;set local request.jwt.claims='{"role":"service_role"}';select public.publishing_engine_bill_due(100);select pg_sleep(0.1);commit;`],{encoding:'utf8'})));
const settlements=workers.flatMap(x=>x.stdout.trim().split(/\s+/).filter(x=>/^\d+$/.test(x)).map(Number));
assert.equal(settlements.reduce((a,b)=>a+b,0),1,'eight actual PostgreSQL connections settle one canonical listing period');
const state=JSON.parse(run(`select json_build_object('balance',(select balance from public.credit_accounts where user_id='${owner}'),'reserved',(select reserved from public.credit_accounts where user_id='${owner}'),'events',(select count(*) from public.publishing_engine_billing_events),'captures',(select count(*) from public.credit_ledger where type='SERVICE_CAPTURE'),'consumed',(select sum(credits_consumed) from public.credit_lots where user_id='${owner}'));`));
assert.deepEqual(state,{balance:90,reserved:0,events:1,captures:1,consumed:10});
assert.equal(run(`begin;set local request.jwt.claims='{"role":"service_role"}';select public.publishing_engine_bill_due(100);commit;`),'0');
console.log('PASS: eight simultaneous billing workers, real production wallet functions and credit lots, one 10-credit charge across two fixture portals; duplicate retry charges zero.');

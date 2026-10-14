import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as lifecycle from '../../supabase/functions/publishing-engine/lifecycle.ts';
import {normalizeListing} from '../../supabase/functions/publishing-engine/listing-schema.js';
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
function setup(foreign=false){
 const writes=[],rpcs=[];
 const admin={from(table){let filters=[];const query={select(){return query;},eq(k,v){filters.push([k,v]);return query;},limit(){return query;},update(value){writes.push(value);return query;},async upsert(value){writes.push(value);return {error:null};},async maybeSingle(){return {data:table==='users'?{id:owner,is_admin:false}:foreign?null:{id,user_id:owner,version:1,payload:{portalTargets:['ssge'],photos:[]}},error:null};},then(resolve){return Promise.resolve({data:[],error:null}).then(resolve);}};return query;},async rpc(name,args){rpcs.push({name,args});return {data:name==='publishing_engine_save_draft'?{id,version:1}:[],error:null};}};
 const source=fs.readFileSync('supabase/functions/publishing-engine/v2.ts','utf8').replace(/^import .*;\r?\n/gm,'').replace('export async function handleV2','async function handleV2');
 // Capture the function in the same context without exporting a production test hook.
 const context={...lifecycle,URL,Error,Set,Date};vm.createContext(context);vm.runInContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText+'\nglobalThis.handle=handleV2;',context);
 const ctx={admin,owner:{id:owner},registry:{portals:[{id:'ssge',domains:['ss.ge'],browser:{},verifiedOperations:{}}]},normalize:normalizeListing,photos:async()=>[]};
 return {call:(path,body={})=>context.handle(path,body,ctx),writes,rpcs};
}
test('V2 saves an incomplete draft with server-resolved ownership',async()=>{const s=setup();const r=await s.call('/v2/save',{title:'Draft'});assert.equal(r.validation.valid,true);assert.equal(s.rpcs[0].args.p_owner,owner);assert.equal(s.rpcs[0].name,'publishing_engine_save_draft');});
test('V2 rejects foreign listing reads and unverified paid activation',async()=>{await assert.rejects(setup(true).call('/v2/activate',{listingId:id,version:1}),/OWNED_RECORD_REQUIRED/);const s=setup();await assert.rejects(s.call('/v2/activate',{listingId:id,version:1}),/CAPABILITY_UNVERIFIED/);assert.equal(s.rpcs.length,0);});
test('form access alone never becomes a verified connection',async()=>{const s=setup();await s.call('/v2/connection',{portalId:'ssge',result:{status:'FORM_ACCESSIBLE'}});assert.equal(s.writes[0].status,'ACTION_REQUIRED');assert.equal(s.writes[0].verified_at,null);});
test('browser commands cannot navigate arbitrary URLs or invoke management methods',async()=>{await assert.rejects(setup().call('/v2/browser',{type:'EXECUTE',portalId:'ssge',tabId:1,action:'deleteListing'}),/COMMAND_NOT_ALLOWED/);await assert.rejects(setup().call('/v2/browser',{type:'NAVIGATE',portalId:'ssge',url:'https://evil.test'}),/COMMAND_NOT_ALLOWED/);});
test('unverified adapters cannot obtain executable operation kinds',async()=>{const s=setup();await s.call('/v2/claim',{portalId:'ssge',tabId:1});assert.equal(s.rpcs[0].args.p_verified_kinds.length,0);});
test('admin inspection rejects ordinary owners',async()=>{await assert.rejects(setup().call('/v2/admin/overview'),/ADMIN_REQUIRED/);});

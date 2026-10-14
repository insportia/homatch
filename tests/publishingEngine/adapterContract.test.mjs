import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
test('browser and API registries match and the required interface accepts existing MyHome and SS.ge',()=>{
 const registry=JSON.parse(fs.readFileSync('publishing-extension/adapters/registry.json','utf8'));
 assert.deepEqual(registry,JSON.parse(fs.readFileSync('supabase/functions/publishing-engine/registry.json','utf8')));
 const scope={};vm.runInNewContext(fs.readFileSync('publishing-extension/adapters/portals.js','utf8'),scope);assert.deepEqual(JSON.parse(JSON.stringify(scope.HOMATCH_PORTAL_REGISTRY)),registry);
 vm.runInNewContext(fs.readFileSync('publishing-extension/adapters/contract.js','utf8'),scope);
 for(const portal of registry.portals){const context={};vm.runInNewContext(fs.readFileSync('publishing-extension/'+portal.browser.script,'utf8'),context);assert.equal(context.HOMATCH_ADAPTERS[portal.id].id,portal.id);for(const method of scope.HOMATCH_ADAPTER_CONTRACT.required)assert.equal(typeof context.HOMATCH_ADAPTERS[portal.id][method],'function');}
});
test('adding a future portal needs registry data and an adapter, without changing the router',async()=>{
 let listener;const registry=JSON.parse(fs.readFileSync('publishing-extension/adapters/registry.json','utf8'));
 registry.portals.push({id:'place',browser:{writeOrigins:['https://place.ge'],readOrigins:[],script:'adapters/place/adapter.js'}});
 let injected;const context={URL,Set,HOMATCH_PORTAL_REGISTRY:registry,chrome:{runtime:{id:'qa',onMessage:{addListener:f=>listener=f}},tabs:{query:async()=>[{id:7,url:'https://place.ge/new'}],get:async()=>({id:7,url:'https://place.ge/new'})},scripting:{executeScript:async args=>{if(args.files){injected=args.files[0];return [];}const scope={location:{origin:'https://place.ge'},HOMATCH_ADAPTERS:{place:{id:'place'}}};for(const key of context.HOMATCH_ADAPTER_CONTRACT.required)scope.HOMATCH_ADAPTERS.place[key]=()=>({status:'FORM_ACCESSIBLE'});return [{result:await vm.runInNewContext('('+args.func.toString()+')',scope)(...args.args)}];}}}};
 vm.runInNewContext(fs.readFileSync('publishing-extension/adapters/contract.js','utf8')+fs.readFileSync('publishing-extension/background.js','utf8').replace(/^importScripts.*\n/,''),context);
 const sender={id:'qa',frameId:0,tab:{url:'https://homatch.live/property/publish'}};const send=m=>new Promise(r=>listener(m,sender,r));
 assert.equal((await send({type:'CONNECT'})).tabs[0].portalId,'place');assert.equal((await send({type:'EXECUTE',portalId:'place',tabId:7,action:'checkAuthentication'})).result.status,'FORM_ACCESSIBLE');assert.equal(injected,'adapters/place/adapter.js');
 context.chrome.tabs.get=async()=>({id:7,url:'https://place.ge.evil.test/new'});assert.equal((await send({type:'EXECUTE',portalId:'place',tabId:7,action:'checkAuthentication'})).ok,false);
});

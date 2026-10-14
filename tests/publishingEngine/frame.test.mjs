// Real Chromium + deployed form assets with an owned, synthetic host fixture.
// This verifies transport and rendering; it does not claim a live portal connection.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { chromium } from 'playwright-core';

test('embedded premium form loads, preserves saved values, scopes messaging and keeps publishing disabled',async()=>{
 const server=http.createServer((req,res)=>{
  const assets={'/publishing-engine/index.html':['text/html','public/publishing-engine/index.html'],'/publishing-engine/app.js':['text/javascript','public/publishing-engine/app.js'],'/publishing-engine/app.css':['text/css','public/publishing-engine/app.css']};
  const asset=assets[req.url];
  if(asset){res.writeHead(200,{'Content-Type':asset[0],'X-Frame-Options':'SAMEORIGIN'});res.end(fs.readFileSync(asset[1]));return;}
  res.writeHead(200,{'Content-Type':'text/html'});
  res.end(`<!doctype html><title>Owned publishing host fixture</title><script>
  let listings=[],job;
  addEventListener('message',event=>{
    if(event.origin!==location.origin||event.source!==document.querySelector('iframe').contentWindow||event.data?.source!=='HOMATCH_PUBLISHING_FRAME')return;
    const m=event.data;let result;
    if(m.kind==='API'){
      if(m.url==='/session')result={lang:'en'};
      if(m.url==='/portals')result={portals:[{id:'myhome',name:'MyHome.ge',status:'NOT_LIVE_VERIFIED',capabilities:{fill:true}},{id:'ssge',name:'SS.ge',status:'NOT_LIVE_VERIFIED',capabilities:{fill:true}}]};
      if(m.url==='/listings'){if(m.body){const listing={...m.body,id:'22222222-2222-4222-8222-222222222222',version:1};listings=[listing];result={listing,validation:{valid:true}};}else result={listings};}
      if(m.url==='/jobs')result=m.body?{job:job={id:'33333333-3333-4333-8333-333333333333',listingId:m.body.listingId,portalId:m.body.portalId,revision:0,state:'CONNECT_BROWSER'}}:{jobs:[],publications:[]};
      if(m.url==='/jobs/transition')result={job:job={...job,state:m.body.state,revision:job.revision+1}};
    }else if(m.kind==='BROWSER'){window.lastCommand=m.command;result=m.command.type==='CONNECT'?{ok:true,tabs:[{id:5,portalId:'myhome',url:'https://statements.myhome.ge/create'},{id:6,portalId:'ssge',url:'https://home.ss.ge/create'}]}:{ok:true,result:{status:m.command.action==='checkAuthentication'?'FORM_ACCESSIBLE':'FORM_FILLED_REQUIRES_VERIFICATION'}};}
    event.source.postMessage({source:'HOMATCH_PUBLISHING_HOST',requestId:m.requestId,result},location.origin);
  });</script><iframe title="Property workspace" style="width:100%;height:2200px;border:0" src="/publishing-engine/index.html"></iframe>`);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/property/publish`);
  const frame=page.frameLocator('iframe');
  await frame.locator('#status').filter({hasText:'WORKSPACE_READY'}).waitFor();
  assert.equal(await frame.locator('#publish').isDisabled(),true);
  assert.equal(await frame.locator('[value=ssge]').isDisabled(),false);
  await frame.locator('[name=price]').fill('155000');
  await frame.locator('[name=city]').fill('თბილისი');
  await frame.locator('[name=description_ka]').fill('Synthetic owned fixture');
  await frame.locator('[value=myhome]').check();
  await frame.locator('button[type=submit]').click();
  await frame.locator('#saved').selectOption('22222222-2222-4222-8222-222222222222');
  assert.equal(await frame.locator('[name=price]').inputValue(),'155000');
  assert.equal(await frame.locator('[name=description_ka]').inputValue(),'Synthetic owned fixture');
  await frame.locator('#connect').click();
  await page.waitForFunction(()=>window.lastCommand?.type==='CONNECT');
  assert.equal(await frame.locator('#publish').isDisabled(),true);
  for(const lang of ['en','ka','ru','tr','ar','he']){
   await frame.locator('#language').evaluate((e,lang)=>{e.value=lang;e.dispatchEvent(new Event('change'));},lang);
   assert.equal(await frame.locator('html').getAttribute('lang'),lang);
   assert.equal(await frame.locator('[name=price]').inputValue(),'155000');
  }
  await frame.locator('[value=ssge]').check();await frame.locator('button[type=submit]').click();
  await frame.locator('#tab').selectOption('6');await frame.locator('#fill').click();
  await page.waitForFunction(()=>window.lastCommand?.action==='fillListing');
  assert.equal(await page.evaluate(()=>window.lastCommand.portalId),'ssge');
  assert.equal(await page.evaluate(()=>window.lastCommand.tabId),6);
  assert.equal(await page.evaluate(()=>window.lastCommand.listingId),'22222222-2222-4222-8222-222222222222');
  await frame.locator('#tab').selectOption('5');assert.equal(await frame.locator('#publish').isDisabled(),true);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});

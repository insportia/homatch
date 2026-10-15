import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const copy=JSON.parse(fs.readFileSync('src/publishingEngine/copy.json','utf8'));
test('publishing copy covers static and dynamic labels in all six languages',()=>{
 const catalogue=fs.readFileSync('src/i18n/translations.ts','utf8');for(const [key,values]of Object.entries(copy))for(const value of Object.values(values))assert.ok(catalogue.includes(key+': '+JSON.stringify(value)),key+' belongs to the shared catalogue');
 const keys=new Set();for(const f of ['ListingEditor','PublishingWorkspace','AdminPublishingPage'])for(const m of fs.readFileSync('src/publishingEngine/'+f+'.tsx','utf8').matchAll(/['"](pue_[a-zA-Z_]+)['"]/g))if(!m[1].endsWith('_'))keys.add(m[1]);
 for(const key of ['overview','listings','create','platforms','activity','billing'])keys.add('pue_tab_'+key);
 for(const key of ['CREATE','PUBLISH','EDIT','UPDATE_PHOTOS','HIDE','PAUSE','RESUME','REFRESH','DELETE','CHECK_STATUS','RECONCILE'])keys.add('pue_action_'+key);
 for(const key of ['generate','improve','shorter','professional','translate'])keys.add('pue_ai_'+key);
 for(const key of ['listings','connections','operations','subscriptions','billing_events','audit'])keys.add('pue_admin_'+key);
 for(const key of keys)for(const lang of ['en','ka','ru','tr','ar','he']){assert.ok(copy[key]?.[lang],key+':'+lang);const placeholders=s=>[...s.matchAll(/\{\w+\}/g)].map(m=>m[0]).sort();assert.deepEqual(placeholders(copy[key][lang]),placeholders(copy[key].en),key+':'+lang+' placeholders');}
});

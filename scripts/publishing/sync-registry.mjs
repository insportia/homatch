// Run from repository root after adding a reviewed portal entry and adapter.
import fs from 'node:fs';
const registry=JSON.parse(fs.readFileSync('publishing-extension/adapters/registry.json','utf8'));
fs.writeFileSync('publishing-extension/adapters/portals.js','globalThis.HOMATCH_PORTAL_REGISTRY='+JSON.stringify(registry)+';\n');
fs.writeFileSync('supabase/functions/publishing-engine/registry.json',JSON.stringify(registry,null,2)+'\n');
// TypeScript source maps retain the exact source required by production proof.
const dir='supabase/functions/publishing-engine/';
for(const name of ['engine','listing-schema'])fs.writeFileSync(dir+name+'.runtime.ts','// Generated from '+name+'.js; do not edit.\n// @ts-nocheck\n'+fs.readFileSync(dir+name+'.js','utf8').replace(/\r\n/g,'\n'));
fs.writeFileSync(dir+'registry.runtime.ts','// Generated from registry.json; do not edit.\nexport default '+fs.readFileSync(dir+'registry.json','utf8').trim()+';\n');

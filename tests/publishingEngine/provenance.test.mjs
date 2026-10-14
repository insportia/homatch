import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
test('deployable TS provenance retains exact canonical JS and registry sources',()=>{
 const d='supabase/functions/publishing-engine/';
 for(const n of ['engine','listing-schema'])assert.equal(fs.readFileSync(d+n+'.runtime.ts','utf8'),'// Generated from '+n+'.js; do not edit.\n// @ts-nocheck\n'+fs.readFileSync(d+n+'.js','utf8'));
 assert.equal(fs.readFileSync(d+'registry.runtime.ts','utf8'),'// Generated from registry.json; do not edit.\nexport default '+fs.readFileSync(d+'registry.json','utf8').trim()+';\n');
});

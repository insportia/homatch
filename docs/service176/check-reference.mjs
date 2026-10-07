import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const path=new URL('./reference-manifest.json',import.meta.url);
const manifest=JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const entry of manifest.files){
 const original=readFileSync(`${manifest.referenceRoot}/src/${entry.file}`);
 assert.equal(hash(original),entry.sourceSha256,'Standalone reference changed: '+entry.file);
 const integrated=readFileSync(new URL('../../official-worker/src/workflows/mygov/service176/'+entry.file,import.meta.url));
 entry.integrationSha256=hash(integrated.toString('utf8').replace(/\r\n/g,'\n'));
 entry.adaptation='TypeScript import extension .ts -> .js';
 if(['api.ts','napr-api.ts','napr.ts','document-references.ts'].includes(entry.file))entry.adaptation+='; explicit node:url URL import for HOMATCH local type shims';
 if(entry.file==='api.ts')entry.adaptation+='; fetch URL.href instead of URL object (same serialized URL)';
}
writeFileSync(path,JSON.stringify(manifest,null,2)+'\n');
console.log('All six standalone source hashes unchanged; integration manifest updated');

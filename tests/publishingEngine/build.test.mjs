// Build the changed publishing entry point. Full app build still runs in existing PR CI.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {build} from 'vite';
test('production publishing assets build with Vite',async()=>{
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'homatch-ssge-build-'));
 try{await build({configFile:false,root:path.resolve('public'),publicDir:false,logLevel:'error',build:{outDir:out,emptyOutDir:false,rollupOptions:{input:path.resolve('public/publishing-engine/index.html')}}});assert.ok(fs.existsSync(path.join(out,'publishing-engine/index.html')));assert.ok(fs.readdirSync(path.join(out,'assets')).some(n=>n.endsWith('.js')));
 }finally{if(!path.resolve(out).startsWith(path.resolve(os.tmpdir())+path.sep+'homatch-ssge-build-'))throw Error('UNSAFE_CLEANUP');fs.rmSync(out,{recursive:true});}
});

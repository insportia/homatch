// Run from repository root after adding a reviewed portal entry and adapter.
import fs from 'node:fs';
const registry=JSON.parse(fs.readFileSync('publishing-extension/adapters/registry.json','utf8'));
fs.writeFileSync('publishing-extension/adapters/portals.js','globalThis.HOMATCH_PORTAL_REGISTRY='+JSON.stringify(registry)+';\n');
fs.writeFileSync('supabase/functions/publishing-engine/registry.json',JSON.stringify(registry,null,2)+'\n');

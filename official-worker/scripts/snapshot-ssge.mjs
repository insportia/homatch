// Maintenance only: refresh accepted standalone source; never runs in production.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
const root = new URL('../src/marketplace/ssge/', import.meta.url);
const origin = process.argv[2];
const target = new URL('vendor/', root);
const modules = ['adapter','pagination','public-client','ssge-contract','http','public-session','discovery','normalize','locations','search-response','validation','diagnostics','gateway-http2','page-proof'];
fs.mkdirSync(target, { recursive: true });
if (origin) for (const name of modules) fs.copyFileSync(path.join(origin, 'src', name+'.mjs'), new URL(name+'.mjs', target));
const text = fs.readFileSync(new URL('../../src/research-core/normalize/place.ts', import.meta.url), 'utf8');
const literal = text.match(/const PLACES[^=]*= (\[[\s\S]*?\n\]);/)[1].replace(/\/\/[^\n]*/g, '').replaceAll("'", '"');
const rows = JSON.parse(literal.replace(/,\s*\]/g, ']'));
fs.writeFileSync(new URL('place-aliases.mjs', root), '// Names only; existing HOMATCH normalize/place.ts snapshot. Source IDs are resolved live.\nexport const placeAliases = '+JSON.stringify(rows, null, 2)+';\n');
const hashes = Object.fromEntries(modules.map(name => [name+'.mjs', crypto.createHash('sha256').update(fs.readFileSync(new URL(name+'.mjs', target))).digest('hex')]));
fs.writeFileSync(new URL('vendor-manifest.json', root), JSON.stringify({ source: 'standalone ssge-worker/src', acceptanceRun: '2026-10-07T16-39-36-205Z', files: hashes }, null, 2)+'\n');

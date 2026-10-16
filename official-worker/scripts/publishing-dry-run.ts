// REAL-PORTAL DRY RUN — run by the owner on a computer that can reach the portal.
//
//   cd official-worker && npm ci
//   npx tsx scripts/publishing-dry-run.ts myhome            # fill + verify, never publish
//   npx tsx scripts/publishing-dry-run.ts ssge --inspect    # record evidence page by page
//   options: --listing listing.json   --photo a.jpg --photo b.jpg   --out ./evidence
//
// A VISIBLE Chromium opens on the portal. YOU sign in to the HOMATCH account there
// (password, SMS, CAPTCHA typed by you; nothing is bypassed). Then:
//   dry run   the SAME adapter code the Railway worker runs fills the real form,
//             uploads the photos, reads every field back and checks the free-
//             publication control — and stops. It cannot press Publish: live
//             approval is false AND the submit door always answers "closed".
//   --inspect the script never clicks; you navigate (e.g. SS.ge: to the creation
//             form, then to its final publish step). Each Enter records the URL,
//             a screenshot and the control inventory (labels, names, buttons — no
//             values), which is the evidence the missing selectors need.
// Output: <out>/<portal>-<time>/ — screenshots, result.json, inventory-*.json.
// Nothing is uploaded anywhere; no cookie or password is written.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import readline from 'node:readline';
import { chromium } from 'playwright';
import { adapterFor } from '../src/publishing/adapters/index.js';
import type { OpContext, Task } from '../src/publishing/contract.js';
import { inventory } from '../src/publishing/form.js';
import { captureMasked } from '../src/publishing/runner.js';

const START: Record<string, string> = {
  myhome: 'https://statements.myhome.ge/ka/statement/create?referrer=myhome',
  ssge: 'https://home.ss.ge/ka/udzravi-qoneba',
};
const argv = process.argv.slice(2);
const portal = argv[0];
if (!START[portal]) { console.error(`usage: publishing-dry-run.ts <${Object.keys(START).join('|')}> [--inspect] [--listing f.json] [--photo p.jpg] [--out dir] [--create-url URL]`); process.exit(2); }
const flag = (n: string) => argv.includes(n);
const values = (n: string) => argv.flatMap((a, i) => (a === n && argv[i + 1] ? [argv[i + 1]] : []));
const out = resolve(values('--out')[0] ?? '.', `${portal}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(out, { recursive: true });
const ask = (q: string) => new Promise<string>((r) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); r(a); }); });

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ locale: 'ka-GE', timezoneId: 'Asia/Tbilisi', viewport: { width: 1366, height: 900 } });
const page = await context.newPage();
let n = 0;
const record = async (label: string) => {
  n++;
  writeFileSync(join(out, `${String(n).padStart(2, '0')}-${label}.png`), await captureMasked(page));
  writeFileSync(join(out, `inventory-${String(n).padStart(2, '0')}-${label}.json`), JSON.stringify(await inventory(page), null, 2));
  console.log(`  recorded ${label}: ${page.url().replace(/[?#].*$/, '')}`);
};
await page.goto(START[portal]);
console.log(`\nSign in to the HOMATCH ${portal} account in the window (you type everything).`);
await ask('Press Enter when signed in… ');

if (flag('--inspect')) {
  console.log('Inspect mode: navigate yourself; the script never clicks. Type a label + Enter to record the current page, or "done".');
  for (;;) {
    const label = (await ask('label (e.g. form, photos, publish-step) or done: ')).trim();
    if (!label || label === 'done') break;
    await record(label.replace(/[^a-z0-9-]/gi, '_').slice(0, 30));
  }
} else {
  const adapter = adapterFor(portal)!;
  const listing = values('--listing')[0] ? JSON.parse(readFileSync(values('--listing')[0], 'utf8')) : {
    version: 1, propertyType: 'APARTMENT', dealType: 'SALE', price: 100000, currency: 'USD', area: 60, rooms: 2, bedrooms: 1, bathrooms: null,
    floor: 3, totalFloors: 9, condition: '', city: 'თბილისი', district: '', street: '', streetNumber: '', amenities: [], title: 'HOMATCH dry run — do not publish', ownerName: 'HOMATCH Test',
  };
  const description = 'HOMATCH dry run — this listing is never published.\n\nსაკონტაქტო ინფორმაცია\nქონების მფლობელი: HOMATCH Test\nტელეფონი: +995 555 00 00 00\nგანცხადება გამოქვეყნებულია HOMATCH-ის მეშვეობით.';
  const phone = (await ask('HOMATCH account contact phone on this portal (E.164, e.g. +995555123456): ')).trim();
  const photos = values('--photo').map((p, i) => ({ name: `homatch-${i + 1}.${p.split('.').pop()}`, mimeType: /png$/i.test(p) ? 'image/png' : 'image/jpeg', buffer: readFileSync(p) }));
  const task: Task = {
    id: 'dry-run', leaseToken: 'dry-run', kind: 'CREATE', portalId: portal, attempt: 1, submitAlreadyStarted: false,
    session: null, account: { contactPhone: phone, liveSubmitApproved: false },
    portal: { createUrl: values('--create-url')[0] ?? START[portal], domains: [], maxPhotos: 16 },
    listing, copies: { ka: { title: listing.title, description, footer: '', contactPhone: phone } }, photos: [],
  };
  const ctx: OpContext = {
    page, task, photos,
    stage: async (s) => { console.log(`  stage ${s}`); },
    screenshot: (s) => record(s),
    markSubmitting: async () => false,   // the door is always closed in a dry run
    pause: (ms) => page.waitForTimeout(ms ?? 400),
  };
  let result: unknown;
  try { result = await adapter.run('CREATE', ctx); } catch (e) { result = { outcome: 'STOPPED', error: e instanceof Error ? e.message : String(e) }; await record('stopped'); }
  writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2));
  console.log('\nresult:', JSON.stringify(result));
  await ask('Review the window (nothing was published). Press Enter to close… ');
}
await browser.close();
console.log(`Evidence in ${out}`);

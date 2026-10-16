#!/usr/bin/env node
// CONNECT A HOMATCH PORTAL ACCOUNT — run by the owner on their own computer.
//
//   node scripts/publishing/capture-session.mjs myhome
//   node scripts/publishing/capture-session.mjs ssge
//
// 1. Opens a VISIBLE Chromium window on the portal. YOU sign in to the HOMATCH
//    portal account there yourself — password, SMS code, CAPTCHA: all typed by
//    you, in the portal's own page. Nothing is bypassed or automated.
// 2. When you press Enter here, the window's portal cookies (only those on the
//    portal's own domains) are sent over HTTPS to HOMATCH's publishing-engine
//    function, which seals them with AES-GCM server-side. They are never written
//    to disk here, never printed, and no password is ever read by this script.
// 3. The HOMATCH browser worker then checks the session against the real portal;
//    only that check marks the account "Connected" in Admin.
//
// HOMATCH sign-in: your HOMATCH admin e-mail and password are asked for in this
// terminal (hidden input) to obtain a normal user session for the admin call.
// Environment: HOMATCH_SUPABASE_URL and HOMATCH_SUPABASE_ANON_KEY (the public
// anon key the website uses), or VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.

import { createRequire } from 'node:module';
import readline from 'node:readline';

const require = createRequire(import.meta.url);
const PORTALS = {
  myhome: { start: 'https://statements.myhome.ge/ka/statement/create?referrer=myhome', domains: ['myhome.ge', 'tnet.ge'] },
  ssge: { start: 'https://home.ss.ge/ka/udzravi-qoneba', domains: ['ss.ge'] },
};

const portal = process.argv[2];
if (!PORTALS[portal]) { console.error(`usage: capture-session.mjs <${Object.keys(PORTALS).join('|')}>`); process.exit(2); }
const url = process.env.HOMATCH_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const anon = process.env.HOMATCH_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !anon) { console.error('Set HOMATCH_SUPABASE_URL and HOMATCH_SUPABASE_ANON_KEY (the website\'s public anon key).'); process.exit(2); }

function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (!s.startsWith(question)) rl.output.write(''); else rl.output.write(s); };
    rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a); });
  });
}

let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('playwright-core')); }

const email = await ask('HOMATCH admin e-mail: ');
const password = await ask('HOMATCH password (hidden): ', true);
const auth = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
if (!auth.ok) { console.error(`HOMATCH sign-in failed (HTTP ${auth.status}).`); process.exit(1); }
const { access_token: token } = await auth.json();

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ locale: 'ka-GE', viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
await page.goto(PORTALS[portal].start);
console.log(`\nSign in to the HOMATCH ${portal} account in the browser window (you type everything, including any SMS code).`);
console.log('When the account is signed in and you can see the listing form or your account page, come back here.');
await ask('Press Enter to send the session to HOMATCH (Ctrl+C to cancel)… ');

const state = await context.storageState();
await browser.close();
const onPortal = (host) => PORTALS[portal].domains.some((d) => String(host).replace(/^\./, '') === d || String(host).endsWith(`.${d}`));
const storageState = {
  cookies: state.cookies.filter((c) => onPortal(c.domain)),
  origins: state.origins.filter((o) => { try { return onPortal(new URL(o.origin).hostname); } catch { return false; } }),
};
if (!storageState.cookies.length) { console.error('No portal cookies — the account does not look signed in. Nothing was sent.'); process.exit(1); }

const r = await fetch(`${url}/functions/v1/publishing-engine`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, apikey: anon, 'Content-Type': 'application/json', Origin: 'https://homatch.live' },
  body: JSON.stringify({ action: 'admin.account.session', portalId: portal, storageState }),
});
const out = await r.json().catch(() => ({}));
if (!r.ok) { console.error(`HOMATCH refused the session: ${out.code ?? r.status}`); process.exit(1); }
console.log(`Sent ${out.cookies} portal cookie(s). HOMATCH is now checking the session against ${portal}; Admin → Integrations → Property portals shows the result.`);

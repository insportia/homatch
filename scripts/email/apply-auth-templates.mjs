#!/usr/bin/env node
/*
 * Supabase Auth email templates, through the Management API (config/auth).
 *
 *   node scripts/email/apply-auth-templates.mjs read    snapshot the live templates; report per template
 *                                                       the subject, the variables it uses and its logo
 *   node scripts/email/apply-auth-templates.mjs apply   snapshot first (rollback), then PATCH ONLY the
 *                                                       mailer_subjects_* / mailer_templates_*_content
 *                                                       fields from supabase/templates/auth, then read back
 *
 * Env: SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF. No other auth setting is sent or changed.
 * The snapshot (auth-templates-before.json) is written for the workflow to keep as an artifact.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(ROOT, 'supabase', 'templates', 'auth');
const NAMES = ['confirmation', 'recovery', 'magic_link', 'invite', 'email_change', 'reauthentication'];
const LOGO = 'https://www.homatch.live/images/logo/homatch-icon.png';
const mode = process.argv[2];
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;
if (!['read', 'apply'].includes(mode)) { console.error('usage: apply-auth-templates.mjs read|apply'); process.exit(2); }
if (!token || !ref) { console.error('SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF are required'); process.exit(2); }
const URL_ = `https://api.supabase.com/v1/projects/${ref}/config/auth`;
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const templateFields = (cfg) => Object.fromEntries(Object.entries(cfg).filter(([k]) => /^mailer_(subjects|templates)_/.test(k)));
const vars = (html) => [...new Set(String(html ?? '').match(/\{\{\s*\.[A-Za-z]+\s*\}\}/g) ?? [])].map((v) => v.replace(/\s+/g, '')).sort();
const imgs = (html) => [...String(html ?? '').matchAll(/<img[^>]+src="([^"]+)"/gi)].map((m) => m[1]);

async function getConfig() {
  const r = await fetch(URL_, { headers: H });
  if (!r.ok) throw new Error(`GET config/auth: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.json();
}
function report(cfg, label) {
  console.log(`\n== ${label}`);
  console.log(`mailer: ${cfg.smtp_host ? `custom SMTP (${cfg.smtp_host}, sender ${cfg.smtp_admin_email ?? '?'})` : 'Supabase built-in'}`);
  for (const n of NAMES) {
    const html = cfg[`mailer_templates_${n}_content`];
    console.log(`${n.padEnd(17)} subject=${JSON.stringify(cfg[`mailer_subjects_${n}`] ?? null)}`);
    console.log(`${''.padEnd(17)} custom=${!!html} vars=${vars(html).join(' ') || '-'} images=${imgs(html).join(' ') || 'none'}`);
  }
}

const before = await getConfig();
writeFileSync(join(ROOT, 'auth-templates-before.json'), `${JSON.stringify(templateFields(before), null, 2)}\n`);
report(before, 'LIVE (snapshot saved to auth-templates-before.json)');
if (mode === 'read') process.exit(0);

const subjects = JSON.parse(readFileSync(join(DIR, 'subjects.json'), 'utf8'));
const body = {};
for (const n of NAMES) {
  const html = readFileSync(join(DIR, `${n}.html`), 'utf8');
  // The live template's variables must all survive (a link or code the flow depends on).
  const lost = vars(before[`mailer_templates_${n}_content`]).filter((v) => !vars(html).includes(v) && v !== '{{.SiteURL}}' && v !== '{{.Email}}');
  if (lost.length) { console.error(`REFUSED: ${n} would drop ${lost.join(', ')} that the live template uses`); process.exit(1); }
  body[`mailer_templates_${n}_content`] = html;
  body[`mailer_subjects_${n}`] = subjects[n];
}
const r = await fetch(URL_, { method: 'PATCH', headers: H, body: JSON.stringify(body) });
if (!r.ok) { console.error(`PATCH config/auth: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`); process.exit(1); }
const after = await getConfig();
report(after, 'APPLIED');
const missing = NAMES.filter((n) => !imgs(after[`mailer_templates_${n}_content`]).includes(LOGO));
if (missing.length) { console.error(`logo missing after apply: ${missing.join(', ')}`); process.exit(1); }
console.log('\nall six Auth templates carry the HOMATCH logo');

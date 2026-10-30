// The HOMATCH email header and the Supabase Auth templates built from it (2026-10-30).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EMAIL_LOGO_URL, emailHeaderRow } from '../emailBrand.ts';
import { AUTH_TEMPLATES, buildAll } from '../../../../scripts/email/build-auth-templates.mjs';

const read = (p) => readFileSync(new URL(`../../../../${p}`, import.meta.url), 'utf8');

test('the logo is the website\'s own PNG on the host that serves it directly', () => {
  assert.equal(EMAIL_LOGO_URL, 'https://www.homatch.live/images/logo/homatch-icon.png');
  // The same file the site renders (HomatchLogo.tsx), not a regenerated mark, and not SVG.
  assert.match(read('src/components/common/HomatchLogo.tsx'), /src="\/images\/logo\/homatch-icon\.png"/);
  const png = readFileSync(new URL('../../../../public/images/logo/homatch-icon.png', import.meta.url));
  assert.deepEqual([...png.subarray(1, 4)].map((c) => String.fromCharCode(c)).join(''), 'PNG');
  assert.equal(png.readUInt32BE(16), 512); assert.equal(png.readUInt32BE(20), 512); // square: no crop at 40×40
});

test('the header: sized, alt text, wordmark as text, Outlook-safe dark band, RTL spacing', () => {
  const ltr = emailHeaderRow({ rtl: false });
  assert.match(ltr, /width="40" height="40" alt="HOMATCH" style="display:block;width:40px;height:40px;border:0/);
  assert.match(ltr, /<td bgcolor="#0C1119" style="background:#0C1119/);
  assert.match(ltr, />HOMATCH<\/td>/);
  assert.match(ltr, /padding-right:12px/);
  assert.match(emailHeaderRow({ rtl: true }), /padding-left:12px/);
});

test('the Auth templates on disk are exactly what the builder makes (no drift from the shared header)', () => {
  for (const [file, body] of Object.entries(buildAll())) assert.equal(read(`supabase/templates/auth/${file}`), body, file);
});

test('every Auth template carries the logo once and keeps the variable its flow needs', () => {
  for (const name of Object.keys(AUTH_TEMPLATES)) {
    const html = read(`supabase/templates/auth/${name}.html`);
    assert.equal((html.match(/<img /g) ?? []).length, 1, name);
    assert.ok(html.includes(emailHeaderRow({ rtl: false })), `${name}: the shared header`);
    assert.ok(!/src="http:|\.svg"|localhost|supabase\.co\/storage/.test(html), `${name}: a public HTTPS PNG only`);
    if (name === 'reauthentication') {
      assert.ok(html.includes('{{ .Token }}'), 'the code');
      assert.ok(!html.includes('{{ .ConfirmationURL }}'));
    } else {
      // Per language (ka, en): the button, and the fallback link's href and text: signUp → /auth/callback,
      // resetPasswordForEmail → /auth/reset-password.
      assert.equal((html.match(/\{\{ \.ConfirmationURL \}\}/g) ?? []).length, 6, name);
      assert.equal((html.match(/<a href="\{\{ \.ConfirmationURL \}\}"/g) ?? []).length, 4, `${name}: two buttons, two fallback links`);
    }
    assert.match(html, /lang="ka"/); assert.match(html, /lang="en"/);
  }
  assert.ok(read('supabase/templates/auth/email_change.html').includes('{{ .NewEmail }}'));
  const subjects = JSON.parse(read('supabase/templates/auth/subjects.json'));
  assert.deepEqual(Object.keys(subjects).sort(), Object.keys(AUTH_TEMPLATES).sort());
});

test('apply touches only template and subject fields, refuses to drop a live variable, and verifies the logo', () => {
  const src = read('scripts/email/apply-auth-templates.mjs');
  assert.match(src, /body\[`mailer_templates_\$\{n\}_content`\] = html;/);
  assert.match(src, /body\[`mailer_subjects_\$\{n\}`\] = subjects\[n\];/);
  assert.equal((src.match(/body\[/g) ?? []).length, 2, 'no other auth setting is ever sent');
  assert.match(src, /REFUSED: \$\{n\} would drop/);
  assert.match(src, /writeFileSync\(join\(ROOT, 'auth-templates-before\.json'\)/, 'a snapshot before any change');
  const wf = read('.github/workflows/auth-email-templates.yml');
  assert.match(wf, /workflow_dispatch:/); assert.ok(!/\n {2}push:|\n {2}pull_request:/.test(wf), 'manual only');
  assert.match(wf, /default: read/);
});

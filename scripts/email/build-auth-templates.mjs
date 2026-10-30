#!/usr/bin/env node
/*
 * Builds the Supabase Auth email templates (supabase/templates/auth/*.html + subjects.json)
 * from the same brand header as every HOMATCH transactional email
 * (supabase/functions/_shared/emailBrand.ts), so the logo can never drift between the two.
 *
 * Supabase sends these itself (signup confirmation, password reset, magic link, invite,
 * email change, reauthentication); they are hosted settings, not code, and are applied with
 * .github/workflows/auth-email-templates.yml (mode=apply). Auth mail has no per-user
 * language, so each template is Georgian first, then English.
 *
 * The Go-template variables are exactly the ones Supabase documents and the app relies on:
 * the link flows use {{ .ConfirmationURL }} (signUp → /auth/callback, resetPasswordForEmail →
 * /auth/reset-password); reauthentication sends a code, {{ .Token }}.
 *
 *   node scripts/email/build-auth-templates.mjs           write the files
 *   node scripts/email/build-auth-templates.mjs --check   fail if the files are stale
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMAIL_GOLD, emailHead, emailHeaderRow } from '../../supabase/functions/_shared/emailBrand.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'supabase', 'templates', 'auth');

/* Each template: Georgian and English copy, the action (a link button or a code), and why
   the person got it. The copy is the product's own voice, not generated. */
export const AUTH_TEMPLATES = {
  confirmation: {
    subject: 'HOMATCH — დაადასტურეთ ელფოსტა / Confirm your email',
    ka: { title: 'დაადასტურეთ ელფოსტა', body: 'HOMATCH-ზე ანგარიშის გასააქტიურებლად დაადასტურეთ თქვენი ელფოსტის მისამართი.', cta: 'ელფოსტის დადასტურება' },
    en: { title: 'Confirm your email', body: 'Confirm your email address to activate your HOMATCH account.', cta: 'Confirm email' },
    action: 'link',
    ignore: { ka: 'თუ ეს ანგარიში თქვენ არ შეგიქმნიათ, უბრალოდ უგულებელყავით ეს წერილი.', en: 'If you did not create this account, you can ignore this email.' },
  },
  recovery: {
    subject: 'HOMATCH — პაროლის აღდგენა / Reset your password',
    ka: { title: 'პაროლის აღდგენა', body: 'მივიღეთ მოთხოვნა თქვენი HOMATCH ანგარიშის პაროლის შესაცვლელად.', cta: 'ახალი პაროლის დაყენება' },
    en: { title: 'Reset your password', body: 'We received a request to reset the password of your HOMATCH account.', cta: 'Set a new password' },
    action: 'link',
    ignore: { ka: 'თუ ეს თქვენ არ მოგითხოვიათ, პაროლი არ შეიცვლება — უგულებელყავით ეს წერილი.', en: 'If you did not ask for this, your password stays the same — ignore this email.' },
  },
  magic_link: {
    subject: 'HOMATCH — შესვლის ბმული / Your sign-in link',
    ka: { title: 'შესვლა HOMATCH-ზე', body: 'შესასვლელად გამოიყენეთ ქვემოთ მოცემული ბმული.', cta: 'შესვლა' },
    en: { title: 'Sign in to HOMATCH', body: 'Use the link below to sign in.', cta: 'Sign in' },
    action: 'link',
    ignore: { ka: 'თუ შესვლა თქვენ არ მოგითხოვიათ, უგულებელყავით ეს წერილი.', en: 'If you did not ask to sign in, ignore this email.' },
  },
  invite: {
    subject: 'HOMATCH — მოწვევა / You have been invited',
    ka: { title: 'მოწვევა HOMATCH-ზე', body: 'თქვენ მოგიწვიეს HOMATCH-ზე. ანგარიშის შესაქმნელად მიჰყევით ბმულს.', cta: 'მოწვევის მიღება' },
    en: { title: 'You are invited to HOMATCH', body: 'You have been invited to HOMATCH. Follow the link to create your account.', cta: 'Accept the invitation' },
    action: 'link',
    ignore: { ka: 'თუ მოწვევას არ ელოდით, უგულებელყავით ეს წერილი.', en: 'If you were not expecting this invitation, ignore this email.' },
  },
  email_change: {
    subject: 'HOMATCH — ელფოსტის შეცვლის დადასტურება / Confirm your new email',
    ka: { title: 'ახალი ელფოსტის დადასტურება', body: 'დაადასტურეთ, რომ გსურთ HOMATCH ანგარიშის ელფოსტის შეცვლა მისამართზე {{ .NewEmail }}.', cta: 'შეცვლის დადასტურება' },
    en: { title: 'Confirm your new email', body: 'Confirm that you want to change your HOMATCH email to {{ .NewEmail }}.', cta: 'Confirm the change' },
    action: 'link',
    ignore: { ka: 'თუ ეს თქვენ არ მოგითხოვიათ, დაუყოვნებლივ შეცვალეთ პაროლი.', en: 'If you did not ask for this, change your password right away.' },
  },
  reauthentication: {
    subject: 'HOMATCH — დადასტურების კოდი / Your confirmation code',
    ka: { title: 'დადასტურების კოდი', body: 'მოქმედების დასადასტურებლად შეიყვანეთ ეს კოდი:', cta: null },
    en: { title: 'Your confirmation code', body: 'Enter this code to confirm the action:', cta: null },
    action: 'code',
    ignore: { ka: 'თუ ეს თქვენ არ მოგითხოვიათ, არავის გაუზიაროთ კოდი.', en: 'If you did not ask for this, do not share the code with anyone.' },
  },
};

const p = (text, style = '') => `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#222222;${style}">${text}</p>`;
const button = (label) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 16px"><tr>`
  + `<td bgcolor="${EMAIL_GOLD}" style="background:${EMAIL_GOLD};border-radius:8px"><a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:12px 20px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#161309;text-decoration:none">${label}</a></td>`
  + `</tr></table>`;
const code = () => `<p style="margin:6px 0 16px;font-family:'Courier New',Courier,monospace;font-size:28px;font-weight:bold;letter-spacing:.3em;color:#0C1119">{{ .Token }}</p>`;
const fallback = (lang) => p(lang === 'ka'
  ? 'თუ ღილაკი არ მუშაობს, გახსენით ეს ბმული:'
  : 'If the button does not work, open this link:', 'font-size:13px;color:#555555')
  + `<p style="margin:0 0 12px;font-size:13px;line-height:1.5;word-break:break-all"><a href="{{ .ConfirmationURL }}" style="color:#8a6a1f">{{ .ConfirmationURL }}</a></p>`;

function block(t, lang) {
  const c = t[lang];
  return `<h1 style="margin:0 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:20px;color:#0C1119">${c.title}</h1>`
    + p(c.body)
    + (t.action === 'link' ? button(c.cta) + fallback(lang) : code())
    + p(t.ignore[lang], 'font-size:13px;color:#555555');
}

export function renderAuthTemplate(name) {
  const t = AUTH_TEMPLATES[name];
  return `<!doctype html><html lang="ka"><head>${emailHead(t.ka.title)}</head>`
    + `<body style="margin:0;padding:0;background:#f5f5f2;font-family:Arial,Helvetica,sans-serif">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f5f2"><tr><td align="center" style="padding:24px 12px">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="max-width:560px;background:#ffffff;border-radius:12px">`
    + emailHeaderRow({ rtl: false })
    + `<tr><td style="padding:24px">${block(t, 'ka')}</td></tr>`
    + `<tr><td style="padding:0 24px"><hr style="border:0;border-top:1px solid #e6e3da;margin:0"></td></tr>`
    + `<tr><td style="padding:24px" lang="en">${block(t, 'en')}</td></tr>`
    + `<tr><td style="padding:0 24px 20px;font-size:12px;line-height:1.5;color:#777777">HOMATCH · homatch.live</td></tr>`
    + `</table></td></tr></table></body></html>\n`;
}

export function buildAll() {
  const files = {};
  for (const name of Object.keys(AUTH_TEMPLATES)) files[`${name}.html`] = renderAuthTemplate(name);
  files['subjects.json'] = `${JSON.stringify(Object.fromEntries(Object.entries(AUTH_TEMPLATES).map(([k, v]) => [k, v.subject])), null, 2)}\n`;
  return files;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const files = buildAll();
  if (process.argv.includes('--check')) {
    const stale = Object.entries(files).filter(([f, body]) => !existsSync(join(OUT, f)) || readFileSync(join(OUT, f), 'utf8') !== body).map(([f]) => f);
    if (stale.length) { console.error(`stale auth templates: ${stale.join(', ')} — run node scripts/email/build-auth-templates.mjs`); process.exit(1); }
    console.log('auth templates are current');
  } else {
    mkdirSync(OUT, { recursive: true });
    for (const [f, body] of Object.entries(files)) writeFileSync(join(OUT, f), body);
    console.log(`wrote ${Object.keys(files).length} files to supabase/templates/auth`);
  }
}

// The WhatsApp token is rejected in production. This keeps that fact honest.
//
// THE SITUATION, STATED PLAINLY
//
// Every META_WHATSAPP_* secret is configured. Graph answers both the
// phone-number read and the WABA read with HTTP 401. The credentials exist and
// Meta refuses them, which means the access token is expired or revoked. No
// change in this repository can fix that; it is reissued in Meta Business
// Manager by whoever owns the app.
//
// WHY THAT NEEDS A TEST AND NOT JUST A SENTENCE IN A REPORT
//
// There are exactly three ways this goes wrong, and all three are the kind of
// thing that gets reintroduced by a well-meaning edit:
//
//   1. The UI shows "not configured", sending an admin to re-enter five
//      secrets that were never missing.
//   2. The customer's channel keeps saying "Connected" while nothing can
//      send, because the row is only written on a SUCCESSFUL probe.
//   3. Someone "helpfully" includes Meta's error body in the detail string to
//      aid debugging — and Meta's error body quotes the request, which
//      contains a phone number.
//
// This file makes all three fail loudly. It reads the shipped source rather
// than mocking it, because the question is about what is deployed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const STATUS_FN = readFileSync(join(ROOT, 'supabase', 'functions', 'comm-provider-status', 'index.ts'), 'utf8');
const META = readFileSync(join(ROOT, 'supabase', 'functions', '_shared', 'comm', 'meta.ts'), 'utf8');

test('a 401 from Meta is classified as a rejected token, not as an unknown fault', () => {
  // classifyMetaError has to map both the HTTP status and Meta's own code 190,
  // because Graph sometimes returns 400 with code 190 rather than a clean 401.
  assert.match(META, /status === 401 \|\| code === 190/,
    'meta.ts must recognise both HTTP 401 and Meta error code 190 as an auth failure');
  assert.match(META, /code: 'AUTH'/, 'the auth failure must carry a distinct AUTH code');
});

test('the admin is told the credentials are present AND rejected', () => {
  assert.match(STATUS_FN, /const rejected = account\.error\?\.code === 'AUTH'/,
    'comm-provider-status must distinguish a rejected token from any other failure');

  // The two facts an admin acts on, as booleans rather than prose to parse.
  assert.match(STATUS_FN, /credentialsPresent: true/);
  assert.match(STATUS_FN, /credentialsRejected: rejected/);

  // And a sentence that sends them to the right place.
  assert.match(STATUS_FN, /expired or revoked/i,
    'the detail must say the token is expired or revoked, not just that something failed');
  assert.match(STATUS_FN, /Business Manager/,
    'the detail must name where the token is reissued; "contact support" is not an instruction');
});

test('a number that cannot send stops calling itself connected', () => {
  /*
   * The customer-facing regression, guarded at its source.
   *
   * comm_channel_accounts.status is what the Overview channel card reads. It
   * used to be written only on a successful probe, so a token that expired
   * last week left a green "Connected" card above a channel where every send
   * failed.
   */
  assert.match(STATUS_FN, /status: 'ACTION_REQUIRED'/,
    'a failed Meta probe must write ACTION_REQUIRED back to comm_channel_accounts');

  // The row has to be read BEFORE the success/failure branch, or the failure
  // path has nothing to correct.
  const lookup = STATUS_FN.indexOf("select('id, environment, status')");
  const failureBranch = STATUS_FN.indexOf('if (!account.ok) {');
  assert.ok(lookup > 0 && failureBranch > 0 && lookup < failureBranch,
    'the platform account row must be read before the failure branch, or a failed probe cannot correct it');
});

test('nothing about the failure leaks a secret or a phone number', () => {
  /*
   * §54 and §139. The report says WHETHER a credential is present. It must
   * never carry a value, and it must never echo the provider's raw body,
   * which quotes the request that failed — and that request contains the
   * number being messaged.
   */
  const forbidden = [
    { re: /detail:[^,\n]*account\.error\?\.message/, why: "Meta's own message is echoed into detail" },
    { re: /JSON\.stringify\(\s*account\.error/, why: "Meta's error object is serialised wholesale" },
    { re: /body:\s*await\s+res\.text\(\)/, why: 'a raw provider body is put on the report' },
    { re: /Deno\.env\.get\([^)]*\)\s*(?:\}|,|\))/, why: 'a secret value could reach the response' },
  ];
  const found = forbidden.filter(({ re }) => re.test(STATUS_FN)).map(({ why }) => why);
  assert.deepEqual(found, [], `comm-provider-status may expose only booleans and codes: ${found.join('; ')}`);

  /*
   * Every credential entry anywhere in the report is { name, present }, where
   * `present` is a boolean expression and never the secret itself.
   *
   * Checked across ALL providers, not just Meta: the leak this guards against
   * would be just as bad from the Cartesia or Vapi card, and a check that only
   * looked at one block would have missed it.
   */
  const entries = [...STATUS_FN.matchAll(/\{\s*name:\s*'([A-Z_0-9]+)',\s*present:\s*([^}]+?)\s*\}/g)];
  assert.ok(entries.length >= 7,
    `expected at least seven credentials reported by name, found ${entries.length}`);

  const metaNames = entries.map((e) => e[1]).filter((n) => n.startsWith('META_WHATSAPP_'));
  assert.deepEqual(metaNames.sort(), [
    'META_WHATSAPP_ACCESS_TOKEN',
    'META_WHATSAPP_APP_SECRET',
    'META_WHATSAPP_BUSINESS_ACCOUNT_ID',
    'META_WHATSAPP_PHONE_NUMBER_ID',
    'META_WHATSAPP_VERIFY_TOKEN',
  ], 'all five WhatsApp secrets must be reported, by name, as present-or-not');

  // `present` may only be a presence test. Anything that could evaluate to the
  // secret's VALUE — an env read, a slice, a length, a prefix — is refused.
  const bad = entries
    .filter(([, , expr]) => !/^(creds\.ok|webhook\.ok|hasSecret\('[A-Z_0-9]+'\)|Boolean\([^)]*\)|!!\w+)$/.test(expr.trim()))
    .map(([, name, expr]) => `${name}: present is "${expr.trim()}"`);
  assert.deepEqual(bad, [],
    'a credential "present" field must be a boolean presence test, never a value');

  // And where hasSecret is used, it must check the name it reports.
  for (const [, name, expr] of entries) {
    const m = /hasSecret\('([A-Z_0-9]+)'\)/.exec(expr);
    if (m) assert.equal(m[1], name, `${name} is reported under a different name than the one checked`);
  }
});

test('the probe never sends a message to prove the token works', () => {
  /*
   * §57. The obvious way to test a WhatsApp credential is to send a message.
   * That costs money, it messages a real person, and an admin who presses it
   * twice has messaged them twice. The probe reads the phone number and the
   * WABA instead, both free and invisible to any recipient.
   */
  assert.match(STATUS_FN, /describeAccount\(\)/, 'the Meta probe must be a read');
  assert.ok(!/sendMessage|sendTemplate|\/messages/.test(STATUS_FN),
    'the connection test must never send a WhatsApp message');
});

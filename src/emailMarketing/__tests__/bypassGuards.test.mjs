// Email Studio — the rules that must not be bypassable (owner brief 2026-10-24 §9–§11), pinned per
// sending path: approval, consent, suppression, risk and unsubscribe. Behavioural where the code is
// pure, source-level where it is a database guard or an edge path (the PGlite behaviour test of the
// migration lives with the release evidence; CI has no Postgres).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderCampaignEmail } from '../campaignTemplate.ts';
import { renderDesignBody } from '../designer/render.ts';
import { toBroadcastMergeFields } from '../../../supabase/functions/_shared/emailMarketing/broadcast.ts';

const read = (p) => readFileSync(p, 'utf8');
const MIGRATION = read('supabase/migrations/20261127120000_email_studio_review.sql');
const SEND = read('supabase/functions/outreach-send/index.ts');
const MARKETING = read('supabase/functions/email-marketing/index.ts');
const STUDIO_OLD = read('supabase/functions/_shared/emailStudio.ts');
const LAUNCH = read('supabase/functions/comm-campaign-launch/index.ts');
const SUBMIT = read('supabase/functions/_shared/emailMarketing/studioCampaigns.ts');

test('approval: the browser can neither approve nor keep an approval through an edit', () => {
  const guard = MIGRATION.slice(MIGRATION.indexOf('create or replace function public.outreach_campaigns_email_guard'));
  assert.match(guard, /security invoker/, 'the guard sees the real caller role');
  assert.match(guard, /v_client boolean := current_user in \('authenticated', 'anon'\)/);
  assert.match(guard, /EMAIL_STATUS_NOT_ALLOWED/, 'an insert can only be a draft');
  assert.match(guard, /EMAIL_REVIEW_FIELDS_READ_ONLY/, 'approval and risk columns are not client-writable');
  for (const col of ['approved_content_hash', 'approved_at', 'approved_by', 'risk_level', 'risk_score', 'risk_reasons', 'sent_count', 'send_eligibility', 'owner_id']) {
    assert.match(guard, new RegExp(`new\\.${col} is distinct from old\\.${col}`), `${col} is guarded`);
  }
  assert.match(guard, /new\.status := 'DRAFT'; new\.approved_content_hash := null/, 'a material edit drops the approval');
  for (const field of ['subject', 'preview_text', 'html_body', 'text_body', 'sender_name', 'sender_email', 'reply_to', 'contact_list_id', 'contact_list_ids', 'audience_filter', 'language']) {
    assert.match(MIGRATION, new RegExp(`c\\.${field}`), `${field} is part of the content hash`);
  }
  assert.match(MIGRATION, /if coalesce\(v_c\.risk_level, ''\) = 'BLOCKED' then raise exception 'HARD_PROHIBITION'/, 'an admin cannot approve a hard prohibition');
  assert.match(MIGRATION, /p_decision <> 'APPROVED' and v_reason is null then raise exception 'REASON_REQUIRED'/);
});

test('approval: every path that can start an email campaign is gated', () => {
  const gate = SEND.indexOf('const gate = emailSendGate(campaign)');
  assert.ok(gate > 0 && gate < SEND.indexOf('reserveQuota(') && gate < SEND.indexOf("update({ status: 'RUNNING'"), 'outreach-send gates before reserving or starting');
  const claim = MIGRATION.slice(MIGRATION.indexOf('create or replace function public.outreach_claim_due_campaigns'));
  assert.match(claim, /c2\.approved_content_hash = c2\.content_hash/, 'the scheduler claims approved, unchanged email only');
  assert.match(LAUNCH, /if \(kind\?\.campaign_type === 'EMAIL'\) return json\(\{ error: 'EMAIL_USES_EMAIL_STUDIO_REVIEW' \}, 409\)/, 'the comm launcher refuses email');
  assert.ok(LAUNCH.indexOf('EMAIL_USES_EMAIL_STUDIO_REVIEW') < LAUNCH.indexOf('decideLaunch('), 'before its own policy runs');
  assert.match(SUBMIT, /\.eq\('content_hash', c\.content_hash \?\? ''\)/, 'a submission is pinned to the content it assessed');
});

test('consent and suppression: the only email audience query requires both', () => {
  const batch = MIGRATION.slice(MIGRATION.indexOf('create or replace function public.outreach_email_campaign_batch'));
  for (const rule of ["oc.consent_status = 'CONSENTED'", 'not oc.suppressed', 'not coalesce(oc.do_not_contact, false)', 'not coalesce(oc.unsubscribed, false)', 'not coalesce(oc.is_duplicate, false)']) {
    assert.ok(batch.includes(rule), `the audience requires: ${rule}`);
  }
  assert.match(MIGRATION, /revoke all on function public\.outreach_email_campaign_batch\(uuid, integer\) from public, anon, authenticated/, 'the browser cannot call the batch');
  assert.match(SEND, /channel === 'EMAIL'\s*\? await supabase\.rpc\('outreach_email_campaign_batch'/, 'outreach-send uses it for email');
  /* …and every address is checked against the global suppression list right before its claim. */
  const supp = SEND.indexOf('await isSuppressed(supabase, emailCtx.owner, contact.email!)');
  assert.ok(supp > 0 && supp < SEND.indexOf("status: 'QUEUED', provider: null"), 'suppressed addresses are never claimed');
});

test('risk: hard prohibitions stop tests and sends on every email path', () => {
  assert.match(MARKETING, /const hard = statics\.findings\.filter\(\(f\) => f\.severity === 'BLOCK'\);\s*if \(hard\.length\) return json\(\{ ok: false, error: 'BLOCKED_CONTENT'/, 'Email Studio test send');
  assert.ok(SEND.indexOf('revalidateLinksBeforeDispatch(') > 0, 'links are followed again before the first dispatch');
  const test1 = STUDIO_OLD.indexOf('async function actionTest');
  const send1 = STUDIO_OLD.indexOf('async function actionSend');
  assert.ok(STUDIO_OLD.indexOf('hardBlock(campaign, property', test1) < STUDIO_OLD.indexOf("rpc('email_studio_record_test'", test1), 'property studio test: checked before anything is recorded');
  assert.ok(STUDIO_OLD.indexOf('hardBlock(campaign, property', send1) < STUDIO_OLD.indexOf("rpc('email_studio_begin_send'", send1), 'property studio send: checked before anything is claimed');
});

test('unsubscribe: every marketing email carries a working one-click link, whatever the body says', () => {
  const unsub = 'https://x.example/functions/v1/outreach-unsubscribe?contact=c1&token=t1';
  /* A plain body with no unsubscribe of its own. */
  const plain = renderCampaignEmail({ subject: 'S', bodyText: 'Hello', lang: 'en', unsubscribeUrl: unsub });
  assert.ok(plain.html.includes(unsub.replace(/&/g, '&amp;')) && plain.text.includes(unsub));
  /* A designed body whose author deleted every unsubscribe block. */
  const designed = renderDesignBody({ blocks: [{ type: 'text', text: 'Only text, no unsubscribe block' }] });
  const out = renderCampaignEmail({ subject: 'S', bodyHtml: designed.html, bodyText: designed.text, lang: 'ka', unsubscribeUrl: unsub });
  assert.ok(out.html.includes(unsub.replace(/&/g, '&amp;')), 'the shell adds it');
  assert.match(out.html, /გამოწერის გაუქმება/);
  /* Hand-written HTML (written straight to html_body) still gets the shell's link. */
  const raw = renderCampaignEmail({ subject: 'S', bodyHtml: '<p>raw</p>', lang: 'en', unsubscribeUrl: unsub });
  assert.ok(raw.html.includes(unsub.replace(/&/g, '&amp;')));
  /* Broadcast route: the designer block maps to Resend's per-contact link, and the footer has one. */
  assert.equal(toBroadcastMergeFields('<a href="{{unsubscribe_url}}">x</a>'), '<a href="{{{RESEND_UNSUBSCRIBE_URL}}}">x</a>');
  assert.match(read('supabase/functions/_shared/emailMarketing/broadcast.ts'), /RESEND_UNSUBSCRIBE_URL\}\}\}" style="color:#888">Unsubscribe/);
  /* And the transport carries the one-click header on every campaign send. */
  assert.match(SEND, /headers: listUnsubscribeHeaders\(unsubUrl\)/);
});

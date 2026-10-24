// Email Studio & Leads UX pass (2026-10-24): uploads are images by their BYTES and are served only
// when registered; the allowance shown is the one the server enforces; a lead is never opted in by
// being added; the workflow is Design → Sender → Recipients → Review; nothing sends without an
// explicit confirmation. Behavioural where the code is pure, source-level where it is SQL or a page
// (the PGlite behaviour run of the migration is part of the release evidence; CI has no Postgres).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeBase64, serveAsset, sniffImage } from '../../../supabase/functions/_shared/emailMarketing/assetFiles.ts';
import { buttonsMissingLink, imagesMissingAlt } from '../designer/checks.ts';
import { parseProposal } from '../copilot.ts';
import { campaignPath } from '../reviewState.ts';

const read = (p) => readFileSync(p, 'utf8');
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 2, 0x58, 0, 0, 1, 0x90, 8, 6, 0, 0, 0]);
const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x01, 0xc8, 0x00, 0, 0]);
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x01, 0x2c, 0x01, 0x90, 3, 0, 0, 0, 0, 0, 0]);

test('uploads: the type and size come from the bytes; SVG, HTML and look-alikes are refused', () => {
  assert.deepEqual(sniffImage(PNG), { type: 'image/png', ext: 'png', width: 600, height: 400 });
  assert.deepEqual(sniffImage(GIF), { type: 'image/gif', ext: 'gif', width: 320, height: 200 });
  assert.deepEqual(sniffImage(JPG), { type: 'image/jpeg', ext: 'jpg', width: 400, height: 300 });
  assert.equal(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null);
  assert.equal(sniffImage(new TextEncoder().encode('<html><body>x</body></html>')), null);
  assert.equal(sniffImage(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), null, 'WebP is converted in the browser, never stored');
  assert.deepEqual([...decodeBase64('data:image/png;base64,AQID')], [1, 2, 3]);
  assert.equal(decodeBase64('not base64!'), null);
});

test('delivery: only an ACTIVE registered image, by its id, with safe headers — nothing else in the bucket', async () => {
  const rows = { '11111111-1111-1111-1111-111111111111': { object_key: 'users/u/email-assets/a.png', content_type: 'image/png', byte_size: 3 } };
  const sb = { from: () => ({ select: () => ({ eq: (_c, id) => ({ eq: () => ({ maybeSingle: async () => ({ data: rows[id] ?? null }) }) }) }) }) };
  const keys = [];
  const get = async (key) => { keys.push(key); return new Response(Uint8Array.from([1, 2, 3])); };
  const url = (q) => new URL(`https://x.supabase.co/functions/v1/email-webhook?${q}`);
  const ok = await serveAsset(new Request(url('ema=11111111-1111-1111-1111-111111111111')), url('ema=11111111-1111-1111-1111-111111111111'), sb, get);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/png');
  assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');
  assert.match(ok.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(ok.headers.get('cache-control'), /immutable/);
  assert.deepEqual(keys, ['users/u/email-assets/a.png']);
  for (const q of ['ema=22222222-2222-2222-2222-222222222222', 'ema=../../secret', 'ema=users/u/email-assets/a.png']) {
    const r = await serveAsset(new Request(url(q)), url(q), sb, get);
    assert.equal(r.status, 404, q);
  }
  assert.equal(keys.length, 1, 'an unknown id never reaches storage');
  const head = await serveAsset(new Request(url('ema=11111111-1111-1111-1111-111111111111'), { method: 'HEAD' }), url('ema=11111111-1111-1111-1111-111111111111'), sb, get);
  assert.equal(head.status, 200); assert.equal(keys.length, 1, 'HEAD is answered from the registry');
  assert.equal((await serveAsset(new Request(url('ema=x'), { method: 'POST' }), url('ema=x'), sb, get)).status, 405);
  /* The public endpoint is the email webhook, routed before the signature check, read-only. */
  const hook = read('supabase/functions/email-webhook/index.ts');
  assert.ok(hook.indexOf('isAssetRequest(reqUrl)') < hook.indexOf('isStudioUnsubscribe(reqUrl)'));
});

test('upload path: confirmed write, indexed, registered — and removed again on any failure', () => {
  const src = read('supabase/functions/_shared/emailMarketing/assets.ts');
  assert.match(src, /const img = sniffImage\(bytes\);\s*if \(!img\) return json\(\{ ok: false, error: 'TYPE_NOT_ALLOWED' \}, 415\)/);
  assert.match(src, /facts\.size !== bytes\.byteLength/);
  assert.match(src, /if \(written\) await deleteObject\(key\)/);
  assert.match(src, /users\/\$\{owner\.userId\}\/email-assets\/\$\{id\}\.\$\{img\.ext\}/, 'key carries the account and a uuid, never the filename');
  assert.match(src, /checkRateLimit\(sb, 'email_asset_upload', 60, 3600/);
  assert.match(src, /error: 'ASSET_IN_USE'/, 'an image still in a campaign is never deleted');
  const mig = read('supabase/migrations/20261130090000_email_studio_ux.sql');
  assert.match(mig, /content_type in \('image\/png', 'image\/jpeg', 'image\/gif'\)/);
  assert.match(mig, /revoke all on public\.email_assets from anon, authenticated;\s*grant select on public\.email_assets to authenticated;/);
});

test('allowance: the panel reads the same ceilings the reservation enforces, and never invents one', () => {
  const mig = read('supabase/migrations/20261130090000_email_studio_ux.sql');
  const fn = mig.slice(mig.indexOf('create or replace function public.my_email_allowance'));
  for (const k of ['email_marketing_tenant_daily_cap', 'email_marketing_provider_daily_cap', 'email_marketing_provider_monthly_cap']) assert.ok(fn.includes(k), k);
  assert.match(fn, /'tenantDaily', case when v_tenant_cap is null then null/, 'a ceiling that is off is not shown');
  assert.match(fn, /'provider', case when v_snap\.usage is null then null/, 'no recent provider reading = unavailable, not guessed');
  assert.doesNotMatch(fn.slice(0, fn.indexOf('revoke all on function public.my_email_allowance')), /'providerDaily', case[^;]*'used'/, 'other accounts’ volume is never returned');
  /* The dispatch-time estimate is pinned to outreach-send's batch and the scheduler cadence. */
  assert.match(read('supabase/functions/outreach-send/index.ts'), /const BATCH_SIZE = 40;/);
  assert.match(read('src/services/emailCampaignStudio.ts'), /export const SEND_BATCH_SIZE = 40;\nexport const SEND_TICK_SECONDS = 30;/);
});

test('selected leads: ids are sanitized, scoped by the same audience predicate the send path uses', () => {
  /* studioCampaigns.ts imports the Deno Supabase client, so its sanitizer is pinned by source. */
  assert.match(read('supabase/functions/_shared/emailMarketing/studioCampaigns.ts'), /contactIds: strList\(o\.contactIds, 1000, UUID\)/);
  const mig = read('supabase/migrations/20261130090000_email_studio_ux.sql');
  assert.match(mig, /coalesce\(jsonb_array_length\(f->'contactIds'\), 0\) = 0 or oc\.id::text in/);
  assert.match(mig, /not suppressed and not globally_suppressed/, 'the estimate excludes global bounces/complaints, so eligible is what will send');
  const batch = read('supabase/migrations/20261127120000_email_studio_review.sql');
  assert.match(batch, /oc\.consent_status = 'CONSENTED'\s*and public\.email_audience_matches\(oc, c\.f\)/, 'the batch keeps requiring consent');
});

test('leads: adding or editing never opts a lead in; consent is recorded only with a basis, on the server', () => {
  const svc = read('src/services/emailLeads.ts');
  assert.match(svc, /source_kind: 'MANUAL', contact_detail_origin: 'OWNER_ENTERED', consent_status: 'UNKNOWN'/);
  assert.doesNotMatch(svc.slice(svc.indexOf('export async function createLead'), svc.indexOf('export async function deleteLeads')), /consent_status: 'CONSENTED'/);
  assert.match(svc, /patch\.consent_status = 'UNKNOWN'; patch\.consent_lawful_basis = null/, 'a changed address loses the old address’s consent');
  assert.match(svc, /setContactEmailConsent\(id, true, basis\)/);
  const dlg = read('src/components/emailStudio/LeadDialog.tsx');
  assert.match(dlg, /disabled=\{!basis \|\| !attest \|\| consentBusy\}/, 'consent needs a basis and the owner’s confirmation');
  const mig = read('supabase/migrations/20261130090000_email_studio_ux.sql');
  assert.match(mig, /and exists \(select 1 from public\.outreach_sends s where s\.contact_id = c\.id\)/, 'a contacted lead is kept, not deleted');
});

test('workflow: Design → Sender → Recipients → Review; old links still land; nothing sends without explicit confirmation', () => {
  const ws = read('src/pages/outreach/studio/EmailCampaignWorkspacePage.tsx');
  assert.match(ws, /const STEPS = \['design', 'sender', 'recipients', 'review'\] as const;/);
  assert.match(ws, /LEGACY_STEP: Record<string, Step> = \{ 1: 'design', 2: 'recipients', 3: 'sender', 4: 'design', 5: 'design', 6: 'review' \}/);
  assert.match(ws, /if \(!campaignId \|\| !sendAck\) return;/, 'send requires the acknowledgement checkbox');
  assert.match(ws, /<AlertDialogAction disabled=\{!sendAck\}/);
  assert.match(ws, /saveCampaign\(idRef\.current, toPatch\(working, fallbackName\), draftKey\.current, \{ baseUpdatedAt: baseRef\.current, version \}\)/,
    'every first save carries the draft key, and every save the version it edited (stale-save protection)');
  assert.match(ws, /if \(dirtyRef\.current\) void saveCampaign\(/, 'leaving the page saves pending work');
  const studio = read('supabase/functions/_shared/emailMarketing/studioCampaigns.ts');
  assert.match(studio, /String\(error\.code \?\? ''\) === '23505'/, 'a duplicate first save returns the existing draft');
  assert.match(studio, /if \(c\.design && buttonsMissingLink\(c\.design\)\.length\) p\.push\('BUTTON_LINK_MISSING'\)/);
  assert.equal(campaignPath({ id: 'c', status: 'DRAFT' }), '/outreach/email/campaigns/c?step=design');
  assert.equal(campaignPath({ id: 'c', status: 'UNDER_REVIEW' }), '/outreach/email/campaigns/c?step=review');
  assert.equal(campaignPath({ id: 'c', status: 'COMPLETED' }), '/outreach/email/campaigns/c/overview', 'a sent campaign opens its details, never the editor');
});

test('design checks: a labelled button without a link, an image without alt text', () => {
  const doc = { blocks: [
    { type: 'button', id: 'b1', label: 'Go', href: '' }, { type: 'button', id: 'b2', label: 'Go', href: 'https://a.example' },
    { type: 'banner', id: 'b3', buttonLabel: 'See', buttonHref: '' }, { type: 'image', id: 'i1', src: 'https://a.example/x.png', alt: '' },
    { type: 'columns', id: 'c1', columns: [[{ type: 'card', id: 'k1', buttonLabel: 'More', buttonHref: '', imageSrc: 'https://a.example/y.png', imageAlt: '' }], []] },
  ] };
  assert.deepEqual(buttonsMissingLink(doc).sort(), ['b1', 'b3', 'k1']);
  assert.deepEqual(imagesMissingAlt(doc).sort(), ['i1', 'k1']);
});

test('HOMI: a template recommendation is only ever one of the built-in kinds', () => {
  const req = { task: 'template', instruction: '', language: 'en', campaign: {}, blocks: [] };
  assert.equal(parseProposal({ message: 'For a launch', template: 'launch' }, req).template, 'LAUNCH');
  assert.equal(parseProposal({ message: 'x', template: 'CASINO_PROMO' }, req).template, undefined);
  assert.equal(parseProposal({ template: 'VIP' }, req).template, 'VIP', 'a bare recommendation is still a proposal');
});

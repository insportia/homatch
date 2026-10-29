// EMAIL MARKETING HIDDEN (owner, 2026-10-29). The public Email Marketing product is hidden
// and closed on the server under its own fail-closed key `email_marketing`; code and data
// are kept and Admin → Service Control Center brings it back. The lead flow is: find a match →
// view the authorised lead → COPY the email → write from your own mailbox.
//
// Source-reading proofs (the migration, the edge functions, every customer entry point) plus
// the real routing table and key lists. The pure pause decisions run for real in
// supabase/functions/_shared/__tests__/emailMarketingPause.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const load = (p) => import(pathToFileURL(join(ROOT, p)).href);
const front = await load('src/lib/serviceControls/core.ts');
const edge = await load('supabase/functions/_shared/serviceControl.ts');
const { serviceForPath } = await load('src/lib/serviceControls/routes.ts');
const { translations } = await load('src/i18n/translations.ts');
const MIGRATION = read('supabase/migrations/20261207140000_email_marketing_hidden.sql');
/** Executable code only: comments name the old behaviour on purpose. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

/* ── the key ─────────────────────────────────────────────────────────── */

test('email_marketing is its own key, fail closed on both sides, SMS keeps the historic key', () => {
  for (const side of [front, edge]) {
    assert.ok(side.PAID_CLOSED_BY_DEFAULT.includes('email_marketing'), 'fails closed');
    assert.ok(!side.LIVE_BY_DEFAULT.includes('email_marketing'), 'never live by default');
    assert.ok(side.LIVE_BY_DEFAULT.includes('email_campaigns'), 'the SMS key keeps its behaviour');
  }
  assert.deepEqual(front.HIDDEN_SNAPSHOT.services.email_marketing, { frontend: false, backend: false }, 'hidden before any answer');
  assert.deepEqual(front.toSnapshot([]).services.email_marketing, { frontend: false, backend: false }, 'a missing row is OFF');
  assert.deepEqual(front.initialSnapshot({ email_marketing: true }).services.email_marketing, { frontend: false, backend: false }, 'never taken from memory');
  assert.deepEqual(front.toSnapshot([{ service_key: 'email_marketing', frontend_enabled: true, backend_enabled: true }]).services.email_marketing,
    { frontend: true, backend: true }, 'an explicit ON brings it back');
  assert.equal(edge.defaultState('email_marketing').backend, false);
});

test('every email address belongs to email_marketing; platform and SMS addresses do not', () => {
  for (const p of ['/outreach/email', '/outreach/email/campaigns/new', '/outreach/email/inbox', '/outreach/email/plan',
    '/outreach/email/domains', '/outreach/email/contacts/import', '/email-studio', '/email-studio/abc', '/inbox/email']) {
    assert.equal(serviceForPath(p), 'email_marketing', p);
  }
  assert.equal(serviceForPath('/outreach/sms'), 'email_campaigns');
  for (const p of ['/outreach', '/outreach/campaigns', '/outreach/contacts', '/leads', '/property/1', '/chat', '/admin/communication/email']) {
    assert.notEqual(serviceForPath(p), 'email_marketing', p);
  }
});

test('the migration adds the key OFF with an audit row, flips no existing switch and re-points finance', () => {
  assert.match(MIGRATION, /check \(service_key in \([\s\S]*'email_campaigns', 'email_marketing'[\s\S]*\)\);/);
  assert.match(MIGRATION, /\('email_marketing', false, false, 'marketing',/);
  assert.match(MIGRATION, /on conflict \(service_key\) do nothing;/);
  assert.match(MIGRATION, /insert into public\.admin_audit_log[\s\S]*'SERVICE_CONTROL_SET', 'service_controls', 'email_marketing'[\s\S]*'actor', 'migration'/);
  assert.match(MIGRATION, /where not exists \(select 1 from public\.admin_audit_log/, 'the audit row is written once');
  const topLevel = MIGRATION.replace(/\$(function)?\$[\s\S]*?\$(function)?\$/g, '');
  assert.doesNotMatch(topLevel, /set (frontend|backend)_enabled/i, 'no existing switch is flipped (SMS and every other service unchanged)');
  assert.match(MIGRATION, /update public\.finance_services set service_control_key = 'email_marketing'/);
  assert.doesNotMatch(topLevel, /\b(drop table|delete from|truncate)\b/i, 'nothing is deleted');
});

/* ── database guards ─────────────────────────────────────────────────── */

test('DB guard: no new EMAIL campaign and no new schedule/start/resume while off; stopping stays possible', () => {
  const guard = MIGRATION.slice(MIGRATION.indexOf('function public.email_marketing_outreach_guard'), MIGRATION.indexOf('trg_0_service_control_email_marketing on public.outreach_campaigns'));
  assert.match(guard, /if new\.campaign_type is distinct from 'EMAIL' then return new; end if;/, 'SMS, calls, WhatsApp untouched');
  assert.match(guard, /if public\.service_backend_enabled\('email_marketing'\) then return new; end if;/);
  assert.match(guard, /if tg_op = 'INSERT' then\s+raise exception 'SERVICE_DISABLED'/);
  assert.match(guard, /new\.status in \('SCHEDULED', 'RUNNING'\)\s+and old\.status not in \('SCHEDULED', 'RUNNING'\)/, 'SCHEDULED <-> RUNNING (claim, re-arm) stays allowed');
  assert.match(MIGRATION, /create trigger trg_0_service_control_email_marketing\s+before insert or update on public\.outreach_campaigns/);

  const studio = MIGRATION.slice(MIGRATION.indexOf('function public.email_marketing_studio_guard'), MIGRATION.indexOf('trg_0_service_control_email_marketing on public.email_studio_campaigns'));
  assert.match(studio, /if tg_op = 'INSERT' then\s+raise exception 'SERVICE_DISABLED'/);
  assert.match(studio, /new\.scheduled_at is not null and new\.scheduled_at is distinct from old\.scheduled_at/, 'only a NEW schedule is refused');
  assert.match(MIGRATION, /create trigger trg_0_service_control_email_marketing\s+before insert or update on public\.email_studio_campaigns/);
  // service_backend_enabled() is false for a missing row: the database side fails closed too.
  assert.match(read('supabase/migrations/20261109090000_service_controls.sql'), /coalesce\(\(select c\.backend_enabled from public\.service_controls c where c\.service_key = p_key\), false\)/);
});

test('pause preserves work: the claims skip a paused service, a paused outcome keeps the Studio schedule', () => {
  const due = MIGRATION.slice(MIGRATION.indexOf('function public.outreach_claim_due_campaigns'), MIGRATION.indexOf('function public.outreach_claim_running_campaigns'));
  assert.match(due, /c2\.campaign_type <> 'EMAIL' or public\.service_backend_enabled\('email_marketing'\)/);
  assert.match(due, /c2\.campaign_type <> 'SMS' or public\.service_backend_enabled\('email_campaigns'\)/);
  assert.match(due, /c2\.campaign_type <> 'AI_CALL' or public\.service_backend_enabled\('ai_call_center'\)/);
  assert.match(due, /approved_content_hash = c2\.content_hash/, 'the review gate is kept');
  const running = MIGRATION.slice(MIGRATION.indexOf('function public.outreach_claim_running_campaigns'), MIGRATION.indexOf('function public.email_studio_claim_due_scheduled'));
  assert.match(running, /and public\.service_backend_enabled\('email_marketing'\)/);
  const studio = MIGRATION.slice(MIGRATION.indexOf('function public.email_studio_claim_due_scheduled'), MIGRATION.indexOf('function public.email_studio_schedule_outcome'));
  assert.match(studio, /if not public\.service_backend_enabled\('email_marketing'\) then return; end if;/, 'nothing due, no attempt stamped');
  const outcome = MIGRATION.slice(MIGRATION.indexOf('function public.email_studio_schedule_outcome'));
  assert.match(outcome, /when p_state in \('SENT', 'SENDING', 'SERVICE_PAUSED'\) then scheduled_at else null/);
  for (const f of ['outreach_claim_due_campaigns(integer)', 'outreach_claim_running_campaigns(integer)', 'email_studio_claim_due_scheduled(integer)', 'email_studio_schedule_outcome(uuid, text)']) {
    assert.match(MIGRATION, new RegExp(`revoke all on function public\\.${f.replace(/[()]/g, '\\$&')} from public, anon, authenticated;`), `${f} stays service-role only`);
  }
});

test('jobs-worker re-arms a campaign refused as SERVICE_DISABLED before any FAILED path', () => {
  const src = read('supabase/functions/jobs-worker/index.ts');
  const body = code(src.slice(src.indexOf('async function dispatchDueCampaigns'), src.indexOf('async function dispatchDueStudioSchedules')));
  const rearm = body.indexOf('isServiceDisabledReply(body)');
  assert.ok(rearm > 0, 'the paused reply is recognised');
  assert.ok(rearm < body.indexOf('if (body?.blocked)') && rearm < body.indexOf("status: 'FAILED'"), 'before the blocked/failed handling');
  assert.match(body.slice(rearm, rearm + 200), /rearmPausedCampaign\(sb as never, row\.id, continuing\.has\(row\.id\)\);\s+failed\+\+;\s+continue;/);
});

test('the scheduled Studio send keeps its schedule while paused (no outcome written)', () => {
  const src = code(read('supabase/functions/_shared/emailStudio.ts'));
  const at = src.indexOf("serviceBackendEnabled(sb, 'email_marketing')))", src.indexOf('async function handleScheduledSend'));
  assert.ok(at > 0);
  const branch = src.slice(at, src.indexOf('}', at));
  assert.doesNotMatch(branch, /email_studio_schedule_outcome/, 'a pause never clears the schedule');
  assert.match(branch, /SERVICE_PAUSED/);
  assert.doesNotMatch(src, /'email_campaigns'/, 'Email Studio answers to email_marketing only');
  assert.match(src, /if \(studioActionNeedsEmailMarketing\(body\) && !\(await serviceBackendEnabled\(sb, 'email_marketing'\)\)\)/);
});

/* ── edge functions ──────────────────────────────────────────────────── */

test('email-marketing refuses every customer action while off, before anything else runs', () => {
  const src = code(read('supabase/functions/email-marketing/index.ts'));
  const gate = src.indexOf("emailMarketingActionGated(action) && !(await serviceBackendEnabled(sb, 'email_marketing'))");
  assert.ok(gate > 0);
  assert.ok(gate < src.indexOf('await authenticate(req)'), 'refused before the caller, plan, wallet or provider is touched');
  assert.ok(gate < src.indexOf('switch (action)'));
  assert.ok(gate > src.indexOf("action === 'plan_renew_due' || action === 'usage_refresh_cron'"), 'the cron entry points are decided apart');
});

test('plan renewals charge nothing while Email Marketing is off and extend nothing', () => {
  const src = code(read('supabase/functions/email-marketing/index.ts'));
  const body = src.slice(src.indexOf('async function renewDue'), src.indexOf('/* ── domains'));
  assert.match(body, /const paused = !\(await serviceBackendEnabled\(sb, 'email_marketing'\)\);/);
  assert.match(body, /paused \? \{ data: \[\], error: null \} : await sb\.rpc\('email_plan_due_renewals'/, 'no due renewal is even read');
  assert.ok(body.indexOf('const paused') < body.indexOf('purchasePlan('), 'decided before any charge');
  assert.match(body, /renewalsPaused: paused/);
});

test('outreach-campaign-preview, comm-campaign-launch, outreach-send and the dispatcher ask the right key', () => {
  const preview = code(read('supabase/functions/outreach-campaign-preview/index.ts'));
  assert.match(preview, /campaign_type === 'EMAIL' \? 'email_marketing' : campaign_type === 'SMS' \? 'email_campaigns'/);
  assert.ok(preview.indexOf('serviceBackendEnabled(supabase, service)') < preview.indexOf("from('outreach_campaigns').insert"), 'refused before the draft insert');
  assert.match(code(read('supabase/functions/comm-campaign-launch/index.ts')), /typed\.campaign_type === 'EMAIL' \? 'email_marketing'/);
  assert.match(code(read('supabase/functions/outreach-send/index.ts')), /campaign\.campaign_type === 'EMAIL' \? 'email_marketing' : 'email_campaigns'/);
  assert.match(code(read('supabase/functions/comm-dispatch-worker/index.ts')), /campaign\.campaign_type === 'EMAIL' \? 'email_marketing'/);
});

test('unlock never creates or queues a campaign', () => {
  for (const f of ['supabase/functions/atomic-unlock/index.ts', 'src/services/matchingWorkspace.ts', 'src/services/homatchLeads.ts']) {
    const src = code(read(f));
    assert.doesNotMatch(src, /from\('outreach_campaigns'\)|from\('email_studio_campaigns'\)|outreach-campaign-preview|outreach-send/, `${f} creates or sends no campaign`);
  }
  const market = read('supabase/migrations/20261129090000_curated_leads_marketplace.sql');
  assert.doesNotMatch(market, /insert into public\.(outreach_campaigns|email_studio_campaigns)/i, 'the unlock RPCs write no campaign');
});

/* ── customer entry points ───────────────────────────────────────────── */

const GATED_CTAS = {
  'src/pages/property/MatchingWorkspacePage.tsx': [/useServiceVisible\('email_marketing'\)/, /onCreateCampaign=\{emailMarketing && \(success\.ids\.length \|\| success\.listId\)/, /view === 'unlocked' && emailMarketing \? \(/, /if \(creatingList \|\| !emailMarketing\) return;/],
  'src/components/leads/LeadDetailsDrawer.tsx': [/useServiceVisible\('email_marketing'\)/, /\{emailMarketing \? \(\s*<button[\s\S]{0,200}?\/email-studio\?/],
  'src/components/leads/LeadCard.tsx': [/onCreateEmail: \(\(\) => void\) \| null;/, /\{onCreateEmail \? \(/],
  'src/pages/property/HomatchLeadsPage.tsx': [/onCreateEmail=\{emailMarketing \?/],
  'src/pages/LeadsCrmPage.tsx': [/useServiceVisible\('email_marketing'\)/, /\{emailMarketing \? \(\s*<button[^>]*createEmailForSelected/, /if \(!emailMarketing\) return;/],
  'src/components/crm/CrmEntryDrawer.tsx': [/useServiceVisible\('email_marketing'\)/, /\{emailMarketing \? \(\s*<button[^>]*onClick=\{createEmail\}/, /if \(!entryId \|\| !emailMarketing\) return;/],
  'src/components/crm/LeadOutreachComposer.tsx': [/CHANNELS\.filter\(\(c\) => c !== 'EMAIL'\)/, /channel === 'EMAIL' && emailMarketing \?/],
  'src/components/home/sections/AISection.tsx': [/\]\.filter\(\(r\) => pathAvailable\(r\.to\)\);/],
  'src/components/home/sections/ActionLauncherSection.tsx': [/show\('email_marketing'\) &&/],
  'src/components/home/sections/SiteFooter.tsx': [/link_email'[^\n]*service: 'email_marketing'/],
  'src/site/render/SitePage.tsx': [/email_campaign: 'email_marketing',/],
  'src/pages/outreach/CampaignsPage.tsx': [/tab !== 'EMAIL' \|\| services\.email_marketing\.frontend/, /c\.campaign_type === 'EMAIL' && !emailShown \?/],
  'src/pages/outreach/ContactImportPage.tsx': [/useServiceVisible\('email_marketing'\)/, /\{!emailShown \? null :/],
  'src/components/communications/EmailConsentCard.tsx': [/contact\.email && pathAvailable\('\/inbox\/email'\)/],
  'src/components/crm/ActivityTimeline.tsx': [/d\.conversationId && inboxShown/],
  'src/components/jobs/JobCenter.tsx': [/resolveJobDestination\(job, pathAvailable\)/],
  'src/components/jobs/JobIndicator.tsx': [/resolveJobDestination\(job, pathAvailable\)/],
  'src/lib/homi/serviceVisibility.ts': [/EXTRA_PROMPT_SERVICE_KEYS = \['email_marketing'/],
};

test('every public email-campaign entry point obeys email_marketing (so turning it on brings them back)', () => {
  for (const [file, patterns] of Object.entries(GATED_CTAS)) {
    const src = read(file);
    for (const re of patterns) assert.match(src, re, `${file}: ${re}`);
  }
  assert.doesNotMatch(code(read('src/components/home/sections/ActionLauncherSection.tsx')), /'email_campaigns'/, 'the email tile no longer follows the SMS key');
});

test('links into email that are not gated per call site are covered by the route table', () => {
  // Shell nav, About grid, Outreach hub, Comms workspace, developer pages and drawers filter by address.
  for (const f of ['src/components/layouts/HomatchShell.tsx', 'src/components/home/sections/about.tsx', 'src/pages/outreach/OutreachHubPage.tsx',
    'src/pages/developer/DeveloperMarketingPage.tsx', 'src/components/developer/LeadDrawer.tsx']) {
    assert.match(read(f), /pathAvailable\(/, f);
  }
  assert.match(read('src/components/communications/CommsWorkspace.tsx'), /serviceForPath\(item\.to\)/);
  assert.match(read('src/routes.tsx'), /const service = serviceForPath\(route\.path\);[\s\S]*<ServiceGate service=\{service\}>/, 'every gated route renders "unavailable" while paused');
});

/* ── copy email ──────────────────────────────────────────────────────── */

test('Copy email sits next to every authorised lead email, copying only the server-returned field', () => {
  const surfaces = {
    'src/components/leads/LeadDetailsDrawer.tsx': /<CopyEmailButton email=\{contact\.email\}/,
    'src/components/crm/LeadProfileCard.tsx': /<CopyEmailButton email=\{contact\.email\}/,
    'src/components/matching/workspace/InternalRows.tsx': /<CopyEmailButton email=\{contact\.email\}/,
    'src/components/matching/workspace/CuratedRows.tsx': /<CopyEmailButton email=\{lead\.email\}/,
    'src/components/matching/ExternalContactUnlockModal.tsx': /<CopyEmailButton email=\{contact\.email\}/,
  };
  for (const [file, re] of Object.entries(surfaces)) {
    const src = read(file);
    assert.match(src, re, file);
    /* Where the address was a mailto link it stays one, next to the copy button. */
    if (!file.endsWith('ExternalContactUnlockModal.tsx')) assert.match(src, /mailto:/, `${file}: mailto stays as the secondary action`);
  }
  const btn = read('src/components/leads/CopyEmailButton.tsx');
  assert.match(btn, /if \(!address\) return null;/, 'no address, no button');
  assert.match(btn, /navigator\.clipboard\.writeText\(text\)/);
  assert.match(btn, /document\.execCommand\('copy'\)/, 'fallback for older in-app browsers');
  assert.match(btn, /aria-label=\{t\('lead_copy_email_aria', \{ email: address \}\)\}/);
  assert.match(btn, /role="status" aria-live="polite"/, 'the outcome is announced');
  assert.match(btn, /role="alert"/, 'a failed copy says so');
  assert.match(btn, /motion-safe:transition-colors/, 'reduced motion respected');
  assert.match(btn, /min-h-10|min-h-11/, 'touch target');
  assert.doesNotMatch(code(btn), /\.replace\(|mask|split\('@'\)/, 'the address is never rewritten or guessed');
});

test('copy and service strings exist in all six languages with their placeholders', () => {
  for (const key of ['lead_copy_email', 'lead_email_copied', 'lead_copy_email_aria', 'lead_copy_email_failed', 'mw_copy_hint',
    'svc_name_email_marketing', 'svc_desc_email_marketing']) {
    for (const lang of ['en', 'ka', 'ru', 'tr', 'ar', 'he']) {
      const v = translations[lang][key];
      assert.ok(v, `${key} in ${lang}`);
      if (lang !== 'en' && ['ka', 'ar', 'he'].includes(lang)) assert.notEqual(v, translations.en[key], `${key} is translated in ${lang}`);
    }
    if (key === 'lead_copy_email_aria') for (const lang of ['en', 'ka', 'ru', 'tr', 'ar', 'he']) assert.match(translations[lang][key], /\{\{email\}\}/);
  }
  assert.match(translations.en.svc_name_email_campaigns, /^SMS/, 'the historic key is labelled SMS in Admin');
  assert.match(translations.ka.svc_name_email_campaigns, /SMS/);
});

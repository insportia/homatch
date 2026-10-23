// EMAIL STUDIO — campaign actions on the server (routed through the email-marketing function).
//
//   campaign_save     create/update a draft: the design is normalized and RENDERED HERE; the HTML
//                     the client may hold is never stored. Writes go through the CALLER's client,
//                     so RLS and the database guard apply (a material edit of a submitted or
//                     approved campaign drops its approval, logged).
//   campaign_check    the full Campaign Risk Engine, links followed server-side, no state change.
//   campaign_submit   validation → risk → review policy: APPROVED (auto, low risk, policy allows),
//                     UNDER_REVIEW (a human decides) or REJECTED (hard prohibition). Pinned to the
//                     content hash it assessed; if the content changed meanwhile nothing is written.
//
// Hard prohibitions are code. The admin policy (email_review_policy) can only choose between
// "every campaign waits for an admin" and "low-risk campaigns are approved automatically".

import { json, checkRateLimit, logEvent } from '../comm/auth.ts';
import type { EmailSettings, Owner } from './core.ts';
import { inspectLinks } from './linkInspector.ts';
import { normalizeDoc } from '../../../../src/emailMarketing/designer/document.ts';
import { renderDesignBody } from '../../../../src/emailMarketing/designer/render.ts';
import { unfilledPlaceholders } from '../../../../src/emailMarketing/designer/templates.ts';
import { assessCampaign, reviewOutcome, type RiskInput, type RiskResult } from '../../../../src/emailMarketing/risk/engine.ts';
import { extractLinks } from '../../../../src/emailMarketing/risk/links.ts';

// deno-lint-ignore no-explicit-any
type Sb = any;

export const STUDIO_CAMPAIGN_ACTIONS = new Set(['campaign_save', 'campaign_check', 'campaign_submit']);

const LANGS = ['ka', 'en', 'ru', 'tr', 'ar', 'he'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s<>"']{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,}$/i;
const SUBMITTABLE = ['DRAFT', 'READY', 'CHANGES_REQUESTED', 'REJECTED'];

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max) : '');
const strList = (v: unknown, max: number, re?: RegExp) =>
  (Array.isArray(v) ? v : []).map((x) => str(x, 64)).filter((x) => x && (!re || re.test(x))).slice(0, max);

export function sanitizeAudienceFilter(v: unknown): Record<string, string[]> | null {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const f = {
    languages: strList(o.languages, 20, /^[a-z]{2,3}$|^unknown$/i).map((x) => x.toLowerCase()),
    countries: strList(o.countries, 60, /^[a-z]{2}$/i).map((x) => x.toUpperCase()),
    leadTypes: strList(o.leadTypes, 10, /^[A-Z_]{2,20}$/i).map((x) => x.toUpperCase()),
    sources: strList(o.sources, 6, /^(IMPORT|MANUAL|FIND_BUYERS|CURATED|INTERNAL_MATCH)$/i).map((x) => x.toUpperCase()),
    tags: strList(o.tags, 20),
    excludeListIds: strList(o.excludeListIds, 20, UUID),
  };
  return Object.values(f).some((x) => x.length) ? f : null;
}

interface Ctx { sb: Sb; callerSb: Sb; settings: EmailSettings; owner: Owner; body: Record<string, unknown> }

export async function handleStudioCampaignAction(action: string, ctx: Ctx): Promise<Response> {
  switch (action) {
    case 'campaign_save': return await save(ctx);
    case 'campaign_check': return await check(ctx);
    case 'campaign_submit': return await submit(ctx);
    default: return json({ ok: false, error: 'UNKNOWN_ACTION' }, 400);
  }
}

/* ── save ─────────────────────────────────────────────────────────────────────────────────── */
async function verifiedSender(sb: Sb, owner: Owner, senderEmail: string): Promise<{ ok: boolean; address: string | null }> {
  if (!senderEmail) return { ok: true, address: null }; /* HOMATCH's own verified sender */
  const domain = senderEmail.split('@')[1]?.toLowerCase() ?? '';
  const { data } = await sb.from('email_sending_domains').select('domain, status, sender_local_part')
    .eq('owner_user_id', owner.userId).eq('domain', domain).eq('status', 'VERIFIED').maybeSingle();
  const d = data as { domain: string; sender_local_part: string | null } | null;
  if (!d || !d.sender_local_part) return { ok: false, address: null };
  /* The provider sends as the domain's configured address; store exactly that. */
  return { ok: true, address: `${d.sender_local_part}@${d.domain}` };
}

async function save({ sb, callerSb, owner, body }: Ctx): Promise<Response> {
  const limit = await checkRateLimit(sb, 'email_studio_save', 600, 3600, { userId: owner.authId });
  if (!limit.allowed) return json({ ok: false, error: 'RATE_LIMITED' }, 429);
  const id = str(body.id, 40);
  if (id && !UUID.test(id)) return json({ ok: false, error: 'INVALID_ID' }, 400);
  const p = (body.campaign && typeof body.campaign === 'object' ? body.campaign : {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(p, k);

  if (has('name')) patch.name = str(p.name, 160) || 'Untitled campaign';
  if (has('objective')) patch.objective = str(p.objective, 300) || null;
  if (has('description')) patch.description = str(p.description, 1000) || null;
  if (has('language')) patch.language = LANGS.includes(String(p.language)) ? p.language : 'en';
  if (has('subject')) patch.subject = str(p.subject, 200) || null;
  if (has('preview_text')) patch.preview_text = str(p.preview_text, 200) || null;
  if (has('sender_name')) patch.sender_name = str(p.sender_name, 80).replace(/[<>"\r\n]/g, '') || null;
  if (has('reply_to')) {
    const r = str(p.reply_to, 254).toLowerCase();
    if (r && !EMAIL.test(r)) return json({ ok: false, error: 'INVALID_REPLY_TO' }, 422);
    patch.reply_to = r || null;
  }
  if (has('sender_email')) {
    const s = str(p.sender_email, 254).toLowerCase();
    if (s && !EMAIL.test(s)) return json({ ok: false, error: 'INVALID_SENDER' }, 422);
    const v = await verifiedSender(sb, owner, s);
    if (!v.ok) return json({ ok: false, error: 'SENDER_NOT_VERIFIED' }, 422);
    patch.sender_email = v.address;
  }
  if (has('contact_list_ids')) {
    const ids = strList(p.contact_list_ids, 20, UUID);
    if (ids.length) {
      const { data } = await sb.from('outreach_contact_lists').select('id').eq('owner_id', owner.authId).in('id', ids);
      const mine = new Set(((data ?? []) as Array<{ id: string }>).map((r) => r.id));
      if (ids.some((x) => !mine.has(x))) return json({ ok: false, error: 'LIST_NOT_FOUND' }, 404);
    }
    patch.contact_list_ids = ids.length ? ids : null;
    patch.contact_list_id = ids[0] ?? null;
  }
  if (has('audience_filter')) patch.audience_filter = sanitizeAudienceFilter(p.audience_filter);
  if (has('design')) {
    const doc = normalizeDoc(p.design);
    const lang = String(patch.language ?? p.language ?? 'en');
    const rendered = renderDesignBody(doc, { rtl: lang === 'ar' || lang === 'he' });
    patch.design = doc;
    patch.html_body = doc.blocks.length ? rendered.html : null;
    patch.text_body = doc.blocks.length ? rendered.text : null;
  }
  if (has('property_id')) patch.property_id = UUID.test(String(p.property_id ?? '')) ? p.property_id : null;
  patch.updated_at = new Date().toISOString();

  const cols = 'id, name, objective, description, language, subject, preview_text, sender_name, sender_email, reply_to, contact_list_id, contact_list_ids, audience_filter, design, status, content_hash, approved_content_hash, risk_level, risk_score, risk_reasons, review_note, scheduled_at, timezone, updated_at, created_at, sent_count, delivered_count, bounce_count, complaint_count, unsubscribe_count, failed_count, audience_count';
  if (!id) {
    const { data, error } = await callerSb.from('outreach_campaigns')
      .insert({ ...patch, owner_id: owner.authId, campaign_type: 'EMAIL', status: 'DRAFT', name: patch.name ?? 'Untitled campaign' })
      .select(cols).single();
    if (error) return dbError(error);
    logEvent('email-studio', 'campaign_created', {});
    return json({ ok: true, campaign: data });
  }
  const { data, error } = await callerSb.from('outreach_campaigns').update(patch).eq('id', id).eq('campaign_type', 'EMAIL').select(cols).maybeSingle();
  if (error) return dbError(error);
  if (!data) return json({ ok: false, error: 'CAMPAIGN_NOT_FOUND' }, 404);
  return json({ ok: true, campaign: data });
}

function dbError(error: { message?: string; code?: string }): Response {
  const m = String(error.message ?? '');
  if (/ALREADY_SENDING/.test(m)) return json({ ok: false, error: 'CAMPAIGN_ALREADY_SENDING' }, 409);
  if (/TRANSITION_NOT_ALLOWED|READ_ONLY|STATUS_NOT_ALLOWED/.test(m)) return json({ ok: false, error: 'NOT_ALLOWED' }, 409);
  return json({ ok: false, error: 'SAVE_FAILED' }, 500);
}

/* ── risk ─────────────────────────────────────────────────────────────────────────────────── */
interface CampaignRow {
  id: string; owner_id: string; status: string; name: string; subject: string | null; preview_text: string | null;
  html_body: string | null; text_body: string | null; sender_name: string | null; sender_email: string | null;
  contact_list_id: string | null; contact_list_ids: string[] | null; audience_filter: unknown; content_hash: string | null;
  property_id: string | null; language: string | null;
}

async function loadCampaign(sb: Sb, owner: Owner, id: string): Promise<CampaignRow | null> {
  if (!UUID.test(id)) return null;
  const { data } = await sb.from('outreach_campaigns')
    .select('id, owner_id, status, name, subject, preview_text, html_body, text_body, sender_name, sender_email, contact_list_id, contact_list_ids, audience_filter, content_hash, property_id, language, campaign_type')
    .eq('id', id).eq('owner_id', owner.authId).eq('campaign_type', 'EMAIL').maybeSingle();
  return (data as CampaignRow | null) ?? null;
}

const listIds = (c: CampaignRow) => (c.contact_list_ids?.length ? c.contact_list_ids : c.contact_list_id ? [c.contact_list_id] : []);

async function assess(ctx: Ctx, c: CampaignRow): Promise<{ risk: RiskResult; audience: Record<string, unknown> | null }> {
  const { sb, callerSb, owner, settings } = ctx;
  const sender = await verifiedSender(sb, owner, c.sender_email ?? '');
  const ids = listIds(c);
  const { data: est } = ids.length
    ? await callerSb.rpc('email_audience_estimate', { p_list_ids: ids, p_filter: c.audience_filter ?? null })
    : { data: null };
  const audience = (est ?? null) as Record<string, number> | null;
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const [{ count: blocked }, { data: stats }, { count: sent24 }, { data: tenantCap }] = await Promise.all([
    sb.from('email_campaign_reviews').select('id', { count: 'exact', head: true }).eq('owner_id', owner.authId).eq('action', 'BLOCKED').gte('created_at', since),
    sb.from('outreach_campaigns').select('sent_count, bounce_count, complaint_count').eq('owner_id', owner.authId).eq('campaign_type', 'EMAIL').gte('created_at', since),
    sb.from('outreach_sends').select('id', { count: 'exact', head: true }).eq('owner_id', owner.authId).eq('channel', 'EMAIL').gte('created_at', new Date(Date.now() - 86_400_000).toISOString()),
    sb.from('admin_settings').select('value').eq('key', 'email_marketing_tenant_daily_cap').maybeSingle(),
  ]);
  const totals = ((stats ?? []) as Array<{ sent_count: number | null; bounce_count: number | null; complaint_count: number | null }>)
    .reduce((a, r) => ({ s: a.s + (r.sent_count ?? 0), b: a.b + (r.bounce_count ?? 0), c: a.c + (r.complaint_count ?? 0) }), { s: 0, b: 0, c: 0 });
  const html = c.html_body ?? '';
  const links = await inspectLinks(extractLinks(html));
  const input: RiskInput = {
    subject: c.subject ?? '', previewText: c.preview_text, html, text: c.text_body,
    senderName: c.sender_name, senderEmail: sender.address ?? settings.defaultSender, senderVerified: sender.ok,
    audience: audience ? { total: Number(audience.reachable ?? 0), consented: Number(audience.eligible ?? 0) } : { total: 0, consented: 0 },
    account: {
      priorBlocked: blocked ?? 0,
      complaintRate: totals.s ? totals.c / totals.s : 0, bounceRate: totals.s ? totals.b / totals.s : 0,
      sentLast24h: sent24 ?? 0, dailyCap: Number((tenantCap as { value?: unknown } | null)?.value ?? 0) || undefined,
    },
    links, hasPropertyContext: Boolean(c.property_id),
  };
  return { risk: assessCampaign(input), audience };
}

async function check(ctx: Ctx): Promise<Response> {
  const limit = await checkRateLimit(ctx.sb, 'email_studio_check', 60, 3600, { userId: ctx.owner.authId });
  if (!limit.allowed) return json({ ok: false, error: 'RATE_LIMITED' }, 429);
  const c = await loadCampaign(ctx.sb, ctx.owner, str(ctx.body.id, 40));
  if (!c) return json({ ok: false, error: 'CAMPAIGN_NOT_FOUND' }, 404);
  const { risk, audience } = await assess(ctx, c);
  return json({ ok: true, risk, audience, problems: validationProblems(c, audience) });
}

/** What must be fixed before a campaign can be submitted (not risk; completeness). */
export function validationProblems(c: Pick<CampaignRow, 'subject' | 'html_body' | 'text_body' | 'contact_list_id' | 'contact_list_ids' | 'preview_text'>, audience: Record<string, unknown> | null): string[] {
  const p: string[] = [];
  if (!c.subject?.trim()) p.push('SUBJECT_MISSING');
  if (!c.html_body?.trim() && !c.text_body?.trim()) p.push('CONTENT_MISSING');
  if (!(c.contact_list_ids?.length || c.contact_list_id)) p.push('AUDIENCE_MISSING');
  else if (audience && Number(audience.eligible ?? 0) === 0) p.push('NO_ELIGIBLE_RECIPIENTS');
  const text = [c.subject ?? '', c.preview_text ?? '', c.text_body ?? '', (c.html_body ?? '').replace(/<[^>]+>/g, ' ')].join('\n');
  if (unfilledPlaceholders(text).length) p.push('PLACEHOLDERS_UNFILLED');
  return p;
}

async function submit(ctx: Ctx): Promise<Response> {
  const { sb, owner } = ctx;
  const limit = await checkRateLimit(sb, 'email_studio_submit', 30, 3600, { userId: owner.authId });
  if (!limit.allowed) return json({ ok: false, error: 'RATE_LIMITED' }, 429);
  const c = await loadCampaign(sb, owner, str(ctx.body.id, 40));
  if (!c) return json({ ok: false, error: 'CAMPAIGN_NOT_FOUND' }, 404);
  if (!SUBMITTABLE.includes(c.status)) return json({ ok: false, error: 'NOT_SUBMITTABLE', status: c.status }, 409);
  const { risk, audience } = await assess(ctx, c);
  const problems = validationProblems(c, audience);
  if (problems.length) return json({ ok: false, error: 'INCOMPLETE', problems, risk }, 422);

  const { data: pol } = await sb.from('admin_settings').select('value').eq('key', 'email_review_policy').maybeSingle();
  const policy = (pol as { value?: unknown } | null)?.value === 'AUTO_LOW_RISK' ? 'AUTO_LOW_RISK' : 'MANUAL_ALL';
  const outcome = reviewOutcome(risk, policy);
  const now = new Date().toISOString();
  const level = risk.level;
  const { data: updated, error } = await sb.from('outreach_campaigns').update({
    status: outcome, submitted_at: now, risk_level: level, risk_score: risk.score,
    risk_reasons: risk.findings.slice(0, 60), risk_checked_at: now,
    approved_content_hash: outcome === 'APPROVED' ? c.content_hash : null,
    approved_at: outcome === 'APPROVED' ? now : null, approved_by: null,
    review_note: outcome === 'REJECTED' ? 'Blocked by the Campaign Risk Engine' : null,
    audience_count: Number(audience?.eligible ?? 0), updated_at: now,
  }).eq('id', c.id).eq('content_hash', c.content_hash ?? '').in('status', SUBMITTABLE).select('id, status').maybeSingle();
  if (error) return json({ ok: false, error: 'SUBMIT_FAILED' }, 500);
  if (!updated) return json({ ok: false, error: 'CONTENT_CHANGED' }, 409);

  const rows = [
    { campaign_id: c.id, owner_id: owner.authId, actor_id: owner.authId, actor_kind: 'OWNER', action: 'SUBMITTED', content_hash: c.content_hash, risk_level: level, risk_score: risk.score },
    {
      campaign_id: c.id, owner_id: owner.authId, actor_id: null, actor_kind: 'SYSTEM',
      action: outcome === 'APPROVED' ? 'AUTO_APPROVED' : outcome === 'REJECTED' ? 'BLOCKED' : 'HELD_FOR_REVIEW',
      reason: outcome === 'UNDER_REVIEW' ? (policy === 'MANUAL_ALL' && risk.verdict === 'ALLOW' ? 'review policy: every campaign is reviewed' : 'risk findings need a human') : null,
      content_hash: c.content_hash, risk_level: level, risk_score: risk.score, risk_findings: risk.findings.slice(0, 60),
    },
  ];
  await sb.from('email_campaign_reviews').insert(rows);
  logEvent('email-studio', 'campaign_submitted', { outcome, level, score: risk.score });
  return json({ ok: true, status: outcome, risk, audience });
}

/** Before the FIRST dispatch: follow the links again (destinations change after approval). */
export async function revalidateLinksBeforeDispatch(html: string): Promise<{ blocked: boolean; findings: RiskResult['findings'] }> {
  const links = await inspectLinks(extractLinks(html));
  const findings = links.flatMap((l) => l.findings).filter((f) => f.severity === 'BLOCK');
  return { blocked: findings.length > 0, findings };
}

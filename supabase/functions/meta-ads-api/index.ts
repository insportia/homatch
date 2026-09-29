// META ADS — the orchestrator. Every consequential Meta Ads action lands
// here: capability status, asset selection, plan preview, preflight,
// LAUNCH (the only path that can move money), pause/resume, sync, lead
// export/import, audience terms + creation, deposits, funnel events and
// the admin probe. The browser edits drafts through RLS; everything that
// talks to Meta or to the ledger happens in this file under service role,
// behind the admin kill switches, with idempotency keys.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  buildPlan, validatePlanInput, computeTotals, classifySpecialAdCategories,
  canTransition, STRATEGY_VERSION, GOAL_TO_OBJECTIVE, type StrategyInput,
} from '../../../src/lib/metaAds/strategy.ts';
import { hashIdentifierRows, csvSafeCell, normalizeEmail, normalizePhone } from '../../../src/lib/metaAds/hashing.ts';
// Static, not `await import(...)`: the deploy prover walks static imports to
// compare the shipped bundle against this revision's closure, and a dynamic
// import made the deployed artifact carry a module the prover could not see.
import { getPaymentProvider } from '../_shared/payment_provider.ts';
import {
  metaMode, graph, MetaApiError, oauthStartUrl, mockExternalId, capabilityMatrix,
} from '../_shared/metaAds.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function setting(sb: any, key: string): Promise<unknown> {
  const { data } = await sb.from('admin_settings').select('value').eq('key', key).maybeSingle();
  return data?.value;
}
const asBool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const asNum = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

async function userToken(sb: any, userId: string): Promise<string | null> {
  const { data: conn } = await sb.from('meta_connections')
    .select('id,status').eq('user_id', userId).maybeSingle();
  if (!conn || conn.status !== 'CONNECTED') return null;
  const { data: tok } = await sb.from('meta_tokens')
    .select('access_token,expires_at').eq('connection_id', conn.id).maybeSingle();
  if (!tok) return null;
  if (tok.expires_at && new Date(tok.expires_at) < new Date()) {
    await sb.from('meta_connections').update({ status: 'EXPIRED' }).eq('id', conn.id);
    return null;
  }
  return tok.access_token as string;
}

async function selectedAsset(sb: any, userId: string, kind: string) {
  const { data } = await sb.from('meta_assets').select('*')
    .eq('user_id', userId).eq('kind', kind).eq('selected', true).maybeSingle();
  return data ?? null;
}

async function audit(sb: any, actorId: string | null, action: string, target: string, meta: unknown) {
  try {
    await sb.from('admin_audit_log').insert({
      admin_id: actorId, action, target_type: 'META_ADS', target_id: target,
      details: meta ?? {},
    });
  } catch { /* best effort */ }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? '');

  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'Invalid session' }, 401);
  const { data: me } = await sb.from('users').select('id,is_admin,email').eq('auth_id', user.id).maybeSingle();
  if (!me) return json({ error: 'User not found' }, 404);
  const uid = me.id as string;
  const mode = metaMode();

  if (asBool(await setting(sb, 'meta_ads_enabled'), true) === false && !me.is_admin) {
    return json({ error: 'META_ADS_DISABLED', code: 'META_ADS_DISABLED' }, 503);
  }

  try {
    switch (action) {
      /* ── STATUS: the one call the workspace boots from ─────────────── */
      case 'status': {
        const [{ data: conn }, { data: assets }, { data: wallet }] = await Promise.all([
          sb.from('meta_connections').select('status,granted_scopes,token_expires_at,last_error,meta_user_external_id').eq('user_id', uid).maybeSingle(),
          sb.from('meta_assets').select('id,kind,external_id,name,selected,status').eq('user_id', uid).order('kind'),
          sb.from('meta_wallet_balances').select('*').eq('user_id', uid).maybeSingle(),
        ]);
        const settings = {
          feePercent: asNum(await setting(sb, 'meta_ads_fee_percent'), 9),
          minDurationDays: asNum(await setting(sb, 'meta_ads_min_duration_days'), 2),
          minDailyCents: asNum(await setting(sb, 'meta_ads_daily_budget_min_cents'), 200),
          maxDailyCents: asNum(await setting(sb, 'meta_ads_daily_budget_max_cents'), 100000000),
          goalsEnabled: (await setting(sb, 'meta_ads_goals_enabled')) ?? ['LEADS_ON_META'],
          leadImportEnabled: asBool(await setting(sb, 'meta_ads_lead_import_enabled'), true),
          audienceCreationEnabled: asBool(await setting(sb, 'meta_ads_audience_creation_enabled'), true),
          retargetingEnabled: asBool(await setting(sb, 'meta_ads_retargeting_enabled'), true),
          aiAssistEnabled: asBool(await setting(sb, 'meta_ads_ai_assist_enabled'), true),
          publishingEnabled: asBool(await setting(sb, 'meta_ads_publishing_enabled'), true),
        };
        return json({
          mode, connection: conn ?? { status: 'DISCONNECTED' }, assets: assets ?? [],
          wallet: wallet ?? { available_cents: 0, reserved_cents: 0, spent_cents: 0, fees_cents: 0, deposited_cents: 0, currency: 'USD' },
          settings,
        });
      }

      /* ── CONNECT ───────────────────────────────────────────────────── */
      case 'oauth_start': {
        await sb.from('meta_funnel_events').insert({ event: 'meta_ads_authenticated', user_id: uid });
        if (mode === 'MOCK') return json({ mode, mockConnect: true });
        // State binds the callback to this HOMATCH user, HMAC-signed with
        // the app secret so it cannot be forged or replayed for another uid.
        const nonce = crypto.randomUUID();
        await sb.from('meta_connections').upsert(
          { user_id: uid, status: 'DISCONNECTED', last_error: nonce }, { onConflict: 'user_id' });
        const state = btoa(JSON.stringify({ uid, nonce }));
        return json({ mode, url: oauthStartUrl(state) });
      }

      case 'oauth_mock_connect': {
        // The sanctioned MOCK path (adapter has no credentials). Everything
        // it creates is unmistakably labelled TEST/mock_ and Admin shows
        // the integration mode; no metric is ever synthesized.
        if (mode !== 'MOCK') return json({ error: 'REAL mode active' }, 400);
        const { data: conn } = await sb.from('meta_connections').upsert({
          user_id: uid, status: 'CONNECTED', meta_user_external_id: mockExternalId('user'),
          granted_scopes: ['ads_management', 'leads_retrieval'], last_error: null,
          last_checked_at: new Date().toISOString(),
        }, { onConflict: 'user_id' }).select('id').single();
        await sb.from('meta_tokens').upsert({ connection_id: conn.id, access_token: `mock_${crypto.randomUUID()}` });
        const seed = [
          { kind: 'BUSINESS', name: 'TEST Business' },
          { kind: 'PAGE', name: 'TEST Page' },
          { kind: 'INSTAGRAM', name: 'TEST Instagram' },
          { kind: 'AD_ACCOUNT', name: 'TEST Ad Account' },
        ];
        for (const a of seed) {
          await sb.from('meta_assets').upsert({
            user_id: uid, kind: a.kind, external_id: mockExternalId(a.kind.toLowerCase()),
            name: a.name, selected: true, capabilities: { mock: true },
          }, { onConflict: 'user_id,kind,external_id', ignoreDuplicates: true });
        }
        await sb.from('meta_funnel_events').insert({ event: 'meta_connected', user_id: uid });
        return json({ ok: true, mode });
      }

      case 'assets_refresh': {
        const token = await userToken(sb, uid);
        if (!token) return json({ error: 'NOT_CONNECTED', code: 'NOT_CONNECTED' }, 400);
        if (mode === 'MOCK') return json({ ok: true, mode });
        const auditCtx = { sb, userId: uid };
        const [biz, pages, accts] = await Promise.all([
          graph('/me/businesses?fields=id,name', { token, audit: auditCtx }),
          graph('/me/accounts?fields=id,name,instagram_business_account{id,username}', { token, audit: auditCtx }),
          graph('/me/adaccounts?fields=id,name,account_status,currency,business', { token, audit: auditCtx }),
        ]);
        const up = async (kind: string, external_id: string, name: string, parent?: string, raw?: unknown) =>
          sb.from('meta_assets').upsert({
            user_id: uid, kind, external_id, name, parent_external_id: parent ?? null,
            raw: raw ?? null, updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id,kind,external_id' });
        for (const b of (biz.data as any[] ?? [])) await up('BUSINESS', b.id, b.name);
        for (const p of (pages.data as any[] ?? [])) {
          await up('PAGE', p.id, p.name);
          if (p.instagram_business_account) {
            await up('INSTAGRAM', p.instagram_business_account.id,
              p.instagram_business_account.username ?? 'Instagram', p.id);
          }
        }
        for (const a of (accts.data as any[] ?? [])) {
          await up('AD_ACCOUNT', a.id, a.name, a.business?.id, { account_status: a.account_status, currency: a.currency });
        }
        return json({ ok: true });
      }

      case 'select_asset': {
        const { kind, assetId } = body;
        if (!['BUSINESS', 'PAGE', 'INSTAGRAM', 'AD_ACCOUNT', 'PIXEL'].includes(kind)) return json({ error: 'bad kind' }, 400);
        await sb.from('meta_assets').update({ selected: false }).eq('user_id', uid).eq('kind', kind);
        const { error } = await sb.from('meta_assets').update({ selected: true })
          .eq('user_id', uid).eq('id', assetId).eq('kind', kind);
        if (error) return json({ error: 'asset not found' }, 404);
        return json({ ok: true });
      }

      /* ── PLAN + PREFLIGHT ──────────────────────────────────────────── */
      case 'plan_preview': {
        const input = await strategyInputFor(sb, uid, body.campaignId);
        if ('error' in input) return json(input, 400);
        const limits = await budgetLimits(sb);
        const issues = validatePlanInput(input.strategy, limits);
        const feePercent = asNum(await setting(sb, 'meta_ads_fee_percent'), 9);
        const totals = computeTotals(input.strategy.dailyBudgetCents, input.strategy.durationDays, feePercent);
        const plan = issues.length === 0 ? buildPlan(input.strategy) : null;
        return json({
          issues, totals,
          summary: plan ? {
            adSetCount: plan.adSets.length,
            creativeCount: plan.adSets.reduce((n, s) => n + s.creativeIds.length, 0),
            specialAdCategories: plan.specialAdCategories,
            placementsMode: plan.placements.mode,
          } : null,
        });
      }

      case 'preflight': {
        const { data: c } = await sb.from('meta_campaigns').select('*').eq('id', body.campaignId).eq('user_id', uid).maybeSingle();
        if (!c) return json({ error: 'not found' }, 404);
        const input = await strategyInputFor(sb, uid, c.id);
        if ('error' in input) return json(input, 400);
        const limits = await budgetLimits(sb);
        const checks: Array<{ key: string; ok: boolean; detail?: string }> = [];
        const planIssues = validatePlanInput(input.strategy, limits);
        checks.push({ key: 'plan', ok: planIssues.length === 0, detail: planIssues.map(i => i.code).join(',') || undefined });
        // Connection + assets the launch will need.
        const token = await userToken(sb, uid);
        checks.push({ key: 'connection', ok: !!token });
        const page = await selectedAsset(sb, uid, 'PAGE');
        const acct = await selectedAsset(sb, uid, 'AD_ACCOUNT');
        checks.push({ key: 'page_selected', ok: !!page });
        checks.push({ key: 'ad_account_selected', ok: !!acct });
        // Creatives: content rules, deterministic (an LLM never gates).
        const { data: creatives } = await sb.from('meta_creatives').select('*').eq('campaign_id', c.id);
        const BANNED = /(guaranteed profit|guaranteed roi|შემოსავალი გარანტირებულია|100% гарант)/i;
        let creativeOk = (creatives ?? []).length > 0;
        let manualReview = false;
        for (const cr of creatives ?? []) {
          const text = `${cr.headline}\n${cr.primary_text}`;
          const flags: string[] = [];
          if (BANNED.test(text)) flags.push('CLAIM_GUARANTEE');
          if (cr.destination_url && !String(cr.destination_url).startsWith('https://')) flags.push('URL_NOT_HTTPS');
          if ((cr.media ?? []).length === 0) flags.push('NO_MEDIA');
          const status = flags.includes('CLAIM_GUARANTEE') ? 'MANUAL_REVIEW'
            : flags.length ? 'NEEDS_CHANGES' : 'READY';
          if (status !== 'READY') creativeOk = false;
          if (status === 'MANUAL_REVIEW') manualReview = true;
          await sb.from('meta_creatives').update({
            safety_status: status, safety: { flags, checked_at: new Date().toISOString() },
          }).eq('id', cr.id);
          if (status === 'MANUAL_REVIEW') {
            await sb.from('meta_moderation_cases').insert({
              user_id: uid, campaign_id: c.id, creative_id: cr.id,
              reason: flags.join(','), severity: 'HIGH', findings: { flags }, status: 'OPEN',
            });
          }
        }
        checks.push({ key: 'creatives', ok: creativeOk });
        // Policy classification is recomputed here, never trusted from the client.
        const cats = classifySpecialAdCategories({
          isProperty: !!c.property_id || !!(c.offer && c.offer.isProperty !== false),
          dealKind: c.offer?.dealKind ?? (c.property_id ? 'SALE' : 'OTHER'),
        });
        checks.push({ key: 'policy_classified', ok: true, detail: cats.join(',') || 'NONE' });
        const allOk = checks.every(ch => ch.ok);
        const status = manualReview ? 'MANUAL_REVIEW' : allOk ? 'READY' : 'NEEDS_CHANGES';
        const plan = allOk ? buildPlan(input.strategy) : null;
        await sb.from('meta_campaigns').update({
          special_ad_categories: cats,
          objective: GOAL_TO_OBJECTIVE[c.goal as keyof typeof GOAL_TO_OBJECTIVE] ?? null,
          preflight: { status, checks, checked_at: new Date().toISOString() },
          plan, plan_version: plan ? STRATEGY_VERSION : null,
          status,
        }).eq('id', c.id);
        await sb.from('meta_funnel_events').insert({ event: 'preflight_completed', user_id: uid });
        return json({ status, checks });
      }

      /* ── LAUNCH: the only door to money and Meta ───────────────────── */
      case 'launch': {
        if (!asBool(await setting(sb, 'meta_ads_publishing_enabled'), true)) {
          return json({ error: 'PUBLISHING_DISABLED', code: 'PUBLISHING_DISABLED' }, 503);
        }
        const idem = String(body.idempotencyKey ?? '');
        if (!/^[0-9a-f-]{36}$/.test(idem)) return json({ error: 'idempotencyKey required' }, 400);
        const { data: c } = await sb.from('meta_campaigns').select('*').eq('id', body.campaignId).eq('user_id', uid).maybeSingle();
        if (!c) return json({ error: 'not found' }, 404);
        // Retried launch with the same key returns the same outcome.
        if (c.launch_idempotency_key === idem && c.external_campaign_id) {
          return json({ ok: true, already: true, status: c.status });
        }
        if (c.status !== 'READY' || c.preflight?.status !== 'READY') {
          return json({ error: 'NOT_READY', code: 'NOT_READY', status: c.status }, 409);
        }
        if (!canTransition(c.status, 'LAUNCHING')) return json({ error: 'BAD_TRANSITION' }, 409);
        const feePercent = asNum(await setting(sb, 'meta_ads_fee_percent'), 9);
        const totals = computeTotals(c.daily_budget_cents, c.duration_days, feePercent);
        const { data: wallet } = await sb.from('meta_wallet_balances').select('available_cents').eq('user_id', uid).maybeSingle();
        if ((wallet?.available_cents ?? 0) < totals.totalCents) {
          await sb.from('meta_campaigns').update({ status: 'PAYMENT_REQUIRED' }).eq('id', c.id);
          return json({ error: 'INSUFFICIENT_FUNDS', code: 'INSUFFICIENT_FUNDS', totals }, 402);
        }
        // Reserve media + take the fee, atomically enough: ledger inserts
        // are idempotent on the launch key, so a crashed retry cannot
        // double-charge.
        const claimed = await sb.from('meta_campaigns')
          .update({ status: 'LAUNCHING', launch_idempotency_key: idem })
          .eq('id', c.id).eq('status', 'READY').is('launch_idempotency_key', null)
          .select('id').maybeSingle();
        if (!claimed.data) return json({ error: 'LAUNCH_IN_PROGRESS', code: 'LAUNCH_IN_PROGRESS' }, 409);
        const r1 = await sb.from('meta_ads_ledger').insert({
          user_id: uid, entry_type: 'RESERVE', amount_cents: -totals.mediaCents,
          currency: c.currency, campaign_id: c.id, idempotency_key: `${idem}:reserve`,
        });
        const r2 = await sb.from('meta_ads_ledger').insert({
          user_id: uid, entry_type: 'HOMATCH_FEE', amount_cents: -totals.feeCents,
          currency: c.currency, campaign_id: c.id, idempotency_key: `${idem}:fee`,
        });
        if (r1.error && !String(r1.error.message).includes('duplicate')) throw r1.error;
        if (r2.error && !String(r2.error.message).includes('duplicate')) throw r2.error;
        await sb.from('meta_funnel_events').insert({ event: 'launch_requested', user_id: uid });
        try {
          const external = await publishCampaign(sb, uid, c, mode);
          await sb.from('meta_campaigns').update({
            external_campaign_id: external.campaignId,
            external_status: external.status,
            status: mode === 'MOCK' ? 'SUBMITTED' : 'META_REVIEW',
            last_synced_at: new Date().toISOString(), last_error: null,
          }).eq('id', c.id);
          await sb.rpc('notify_emit', {
            p_user_id: uid, p_type: 'META_CAMPAIGN_STATUS',
            p_title: 'Meta Ads', p_body: 'CAMPAIGN_SUBMITTED',
            p_deep_link: `/outreach/meta/campaigns/${c.id}`,
          }).catch?.(() => {});
          await sb.from('meta_funnel_events').insert({ event: 'published', user_id: uid });
          await audit(sb, uid, 'META_CAMPAIGN_LAUNCH', c.id, { totals, mode });
          return json({ ok: true, status: mode === 'MOCK' ? 'SUBMITTED' : 'META_REVIEW', totals, mode });
        } catch (err) {
          // Publication failed after the hold: give the money back and say so.
          await sb.from('meta_ads_ledger').insert({
            user_id: uid, entry_type: 'RELEASE', amount_cents: totals.mediaCents,
            currency: c.currency, campaign_id: c.id, idempotency_key: `${idem}:release`,
          });
          await sb.from('meta_ads_ledger').insert({
            user_id: uid, entry_type: 'REFUND', amount_cents: totals.feeCents,
            currency: c.currency, campaign_id: c.id, idempotency_key: `${idem}:feerefund`,
          });
          const norm = err instanceof MetaApiError ? err.normalized : null;
          await sb.from('meta_campaigns').update({
            status: 'FAILED', launch_idempotency_key: null,
            last_error: norm ? { key: norm.customerKey, code: norm.code } : { key: 'meta_err_generic' },
          }).eq('id', c.id);
          return json({ error: norm?.customerKey ?? 'meta_err_generic', code: 'LAUNCH_FAILED' }, 502);
        }
      }

      case 'pause': case 'resume': case 'archive': {
        const { data: c } = await sb.from('meta_campaigns').select('*').eq('id', body.campaignId).eq('user_id', uid).maybeSingle();
        if (!c) return json({ error: 'not found' }, 404);
        const to = action === 'pause' ? 'PAUSED' : action === 'resume' ? 'ACTIVE' : 'ARCHIVED';
        if (!canTransition(c.status, to)) return json({ error: 'BAD_TRANSITION', from: c.status }, 409);
        if (mode === 'REAL' && c.external_campaign_id && to !== 'ARCHIVED') {
          const token = await userToken(sb, uid);
          if (!token) return json({ error: 'NOT_CONNECTED' }, 400);
          await graph(`/${c.external_campaign_id}`, {
            token, method: 'POST', body: { status: to === 'PAUSED' ? 'PAUSED' : 'ACTIVE' },
            audit: { sb, userId: uid, campaignId: c.id },
          });
        }
        await sb.from('meta_campaigns').update({ status: to }).eq('id', c.id);
        await audit(sb, uid, `META_CAMPAIGN_${to}`, c.id, {});
        return json({ ok: true, status: to });
      }

      case 'sync': {
        const { data: c } = await sb.from('meta_campaigns').select('*').eq('id', body.campaignId).eq('user_id', uid).maybeSingle();
        if (!c?.external_campaign_id) return json({ error: 'not launched' }, 400);
        if (mode === 'MOCK') {
          // No fake numbers, ever: MOCK sync confirms the mock object and
          // reports that no delivery data exists.
          await sb.from('meta_campaigns').update({ last_synced_at: new Date().toISOString(), external_status: 'ACTIVE' }).eq('id', c.id);
          return json({ ok: true, mode, results: null });
        }
        const token = await userToken(sb, uid);
        if (!token) return json({ error: 'NOT_CONNECTED' }, 400);
        const auditCtx = { sb, userId: uid, campaignId: c.id };
        const info = await graph(`/${c.external_campaign_id}?fields=status,effective_status`, { token, audit: auditCtx });
        const insights = await graph(`/${c.external_campaign_id}/insights?fields=spend,impressions,reach,clicks,actions&date_preset=maximum`, { token, audit: auditCtx });
        const row = (insights.data as any[])?.[0] ?? null;
        const results = row ? {
          spend: row.spend, impressions: row.impressions, reach: row.reach,
          clicks: row.clicks, actions: row.actions, fetched_at: new Date().toISOString(),
        } : null;
        const spendCents = row ? Math.round(parseFloat(row.spend ?? '0') * 100) : c.spend_cents;
        await sb.from('meta_campaigns').update({
          external_status: info.effective_status ?? info.status,
          results, spend_cents: spendCents, last_synced_at: new Date().toISOString(),
          status: info.effective_status === 'ACTIVE' ? 'ACTIVE' : c.status,
        }).eq('id', c.id);
        return json({ ok: true, results, external_status: info.effective_status ?? info.status });
      }

      /* ── MONEY ─────────────────────────────────────────────────────── */
      case 'deposit_checkout': {
        const provider = getPaymentProvider();
        const amountCents = Math.round(asNum(body.amountCents, 0));
        if (amountCents < 500) return json({ error: 'MIN_DEPOSIT', minCents: 500 }, 400);
        const idem = crypto.randomUUID();
        const checkout = await provider.createCheckout({
          amountCents, currency: 'USD',
          successUrl: String(body.successUrl ?? 'https://www.homatch.live/outreach/meta?deposit=ok'),
          cancelUrl: String(body.cancelUrl ?? 'https://www.homatch.live/outreach/meta?deposit=cancel'),
          customerEmail: me.email,
          metadata: { user_id: uid, domain: 'META_ADS', idempotency_key: idem, amount_cents: String(amountCents) },
          description: 'HOMATCH Meta Ads balance',
        } as never);
        await sb.from('payments').insert({
          user_id: uid, amount_cents: amountCents, currency: 'USD', status: 'PENDING',
          provider: (provider as { name?: string }).name ?? 'provider',
          provider_id: checkout.providerCheckoutId, meta: { domain: 'META_ADS', idempotency_key: idem },
        }).catch?.(() => {});
        await sb.from('meta_funnel_events').insert({ event: 'checkout_started', user_id: uid });
        return json({ url: checkout.url });
      }

      /* ── LEADS ─────────────────────────────────────────────────────── */
      case 'leads_export': {
        let q = sb.from('meta_leads').select('*').eq('user_id', uid).order('received_at', { ascending: false }).limit(5000);
        if (body.campaignId) q = q.eq('campaign_id', body.campaignId);
        if (body.status) q = q.eq('status', body.status);
        if (body.from) q = q.gte('received_at', body.from);
        if (body.to) q = q.lte('received_at', body.to);
        const { data: leads } = await q;
        const cols = ['received_at', 'source', 'status', 'name', 'email', 'phone', 'note', 'campaign_id'];
        const lines = [cols.join(',')];
        for (const l of leads ?? []) {
          const f = l.fields ?? {};
          lines.push([
            l.received_at, l.source, l.status,
            f.full_name ?? f.name ?? '', f.email ?? '', f.phone_number ?? f.phone ?? '',
            l.note ?? '', l.campaign_id ?? '',
          ].map(csvSafeCell).join(','));
        }
        await sb.from('meta_lead_exports').insert({
          user_id: uid, filter: { campaignId: body.campaignId ?? null, status: body.status ?? null },
          row_count: (leads ?? []).length,
        });
        await audit(sb, uid, 'META_LEAD_EXPORT', uid, { rows: (leads ?? []).length });
        return json({ csv: lines.join('\r\n'), rows: (leads ?? []).length });
      }

      case 'lead_import': {
        if (!asBool(await setting(sb, 'meta_ads_lead_import_enabled'), true)) {
          return json({ error: 'IMPORT_DISABLED' }, 503);
        }
        const rows = Array.isArray(body.rows) ? body.rows.slice(0, 10000) : [];
        if (body.consent !== true) return json({ error: 'CONSENT_REQUIRED', code: 'CONSENT_REQUIRED' }, 400);
        if (rows.length === 0) return json({ error: 'EMPTY' }, 400);
        const { data: batch } = await sb.from('meta_lead_imports').insert({
          user_id: uid, filename: String(body.filename ?? 'upload.csv').slice(0, 200),
          row_count: rows.length, mapping: body.mapping ?? null,
          consent_confirmed_at: new Date().toISOString(), consent_version: 'v1',
          status: 'PROCESSING',
        }).select('id').single();
        let accepted = 0, dupes = 0, invalid = 0;
        const seen = new Set<string>();
        const { data: existing } = await sb.from('meta_leads')
          .select('fields').eq('user_id', uid).eq('source', 'IMPORT').limit(20000);
        for (const e of existing ?? []) {
          const k = `${(e.fields?.email ?? '').toLowerCase()}|${e.fields?.phone ?? ''}`;
          if (k !== '|') seen.add(k);
        }
        for (const r of rows) {
          const email = r.email ? normalizeEmail(String(r.email)) : null;
          const phone = r.phone ? normalizePhone(String(r.phone)) : null;
          if (!email && !phone) { invalid += 1; continue; }
          const key = `${email ?? ''}|${phone ?? ''}`;
          if (seen.has(key)) { dupes += 1; continue; }
          seen.add(key);
          await sb.from('meta_leads').insert({
            user_id: uid, source: 'IMPORT', import_batch_id: batch.id,
            fields: { name: r.name ? String(r.name).slice(0, 120) : null, email, phone },
            status: 'NEW',
          });
          accepted += 1;
        }
        await sb.from('meta_lead_imports').update({
          accepted_count: accepted, duplicate_count: dupes, invalid_count: invalid, status: 'READY',
        }).eq('id', batch.id);
        return json({ ok: true, importId: batch.id, accepted, duplicates: dupes, invalid });
      }

      /* ── AUDIENCES ─────────────────────────────────────────────────── */
      case 'audience_terms_accept': {
        const acct = await selectedAsset(sb, uid, 'AD_ACCOUNT');
        if (!acct) return json({ error: 'NO_AD_ACCOUNT' }, 400);
        await sb.from('meta_audience_terms').upsert({
          user_id: uid, ad_account_external_id: acct.external_id, terms_version: 'v1',
          evidence: { via: 'meta-ads-api', at: new Date().toISOString() },
        }, { onConflict: 'user_id,ad_account_external_id,terms_version', ignoreDuplicates: true });
        return json({ ok: true });
      }

      case 'audience_create': {
        if (!asBool(await setting(sb, 'meta_ads_audience_creation_enabled'), true)) {
          return json({ error: 'AUDIENCES_DISABLED' }, 503);
        }
        const acct = await selectedAsset(sb, uid, 'AD_ACCOUNT');
        if (!acct) return json({ error: 'NO_AD_ACCOUNT', code: 'NO_AD_ACCOUNT' }, 400);
        const { data: terms } = await sb.from('meta_audience_terms').select('accepted_at')
          .eq('user_id', uid).eq('ad_account_external_id', acct.external_id).maybeSingle();
        if (!terms) return json({ error: 'TERMS_REQUIRED', code: 'TERMS_REQUIRED' }, 428);
        const name = String(body.name ?? '').trim().slice(0, 80);
        const source = String(body.source ?? '');
        if (!name) return json({ error: 'NAME_REQUIRED' }, 400);
        if (!['UPLOADED_LIST', 'HOMATCH_LEADS', 'CAMPAIGN_LEADS'].includes(source)) {
          return json({ error: 'SOURCE_UNSUPPORTED' }, 400);
        }
        // Collect the people this audience is made of — always the owner's
        // own rows, never anyone else's.
        let q = sb.from('meta_leads').select('fields').eq('user_id', uid);
        if (source === 'UPLOADED_LIST') q = q.eq('source', 'IMPORT');
        if (source === 'CAMPAIGN_LEADS' && body.campaignId) q = q.eq('campaign_id', body.campaignId);
        const { data: people } = await q.limit(10000);
        const identifiers = (people ?? []).map((p: any) => ({
          email: p.fields?.email ?? null, phone: p.fields?.phone ?? p.fields?.phone_number ?? null,
        }));
        const hashed = await hashIdentifierRows(identifiers);
        if (hashed.accepted === 0) return json({ error: 'NO_VALID_IDENTIFIERS' }, 400);
        const { data: aud, error: audErr } = await sb.from('meta_audiences').insert({
          user_id: uid, name, source, source_ref: { campaignId: body.campaignId ?? null },
          known_record_count: hashed.accepted, ad_account_external_id: acct.external_id,
          sync_status: 'CREATING',
        }).select('id').single();
        if (audErr) return json({ error: 'NAME_TAKEN' }, 409);
        if (mode === 'MOCK') {
          await sb.from('meta_audiences').update({
            external_audience_id: mockExternalId('aud'), sync_status: 'READY',
          }).eq('id', aud.id);
          return json({ ok: true, audienceId: aud.id, mode, accepted: hashed.accepted, rejected: hashed.rejected });
        }
        const token = await userToken(sb, uid);
        if (!token) return json({ error: 'NOT_CONNECTED' }, 400);
        try {
          const created = await graph(`/${acct.external_id}/customaudiences`, {
            token, method: 'POST',
            body: { name, subtype: 'CUSTOM', customer_file_source: 'USER_PROVIDED_ONLY' },
            audit: { sb, userId: uid },
          });
          await graph(`/${created.id}/users`, {
            token, method: 'POST',
            body: { payload: { schema: hashed.schema, data: hashed.rows } },
            audit: { sb, userId: uid },
          });
          await sb.from('meta_audiences').update({
            external_audience_id: String(created.id), sync_status: 'READY',
          }).eq('id', aud.id);
          return json({ ok: true, audienceId: aud.id, accepted: hashed.accepted, rejected: hashed.rejected });
        } catch (err) {
          const norm = err instanceof MetaApiError ? err.normalized : null;
          await sb.from('meta_audiences').update({
            sync_status: 'FAILED', last_error: norm?.customerKey ?? 'meta_err_generic',
          }).eq('id', aud.id);
          return json({ error: norm?.customerKey ?? 'meta_err_generic' }, 502);
        }
      }

      /* ── FUNNEL + ADMIN ───────────────────────────────────────────── */
      case 'funnel': {
        const ev = String(body.event ?? '');
        await sb.from('meta_funnel_events').insert({ event: ev, user_id: uid }).catch?.(() => {});
        return json({ ok: true });
      }

      case 'admin_adjust': {
        // Audited manual ledger adjustment — the ONLY non-service write
        // path into the ads ledger, admin-gated and reason-required.
        if (!me.is_admin) return json({ error: 'forbidden' }, 403);
        const target = String(body.targetUserId ?? '');
        const amount = Math.round(asNum(body.amountCents, 0));
        const reason = String(body.reason ?? '').trim();
        if (!target || amount === 0 || !reason) return json({ error: 'target, amount, reason required' }, 400);
        const { error } = await sb.from('meta_ads_ledger').insert({
          user_id: target, entry_type: 'ADJUSTMENT', amount_cents: amount,
          note: reason, created_by: uid, idempotency_key: `adj:${crypto.randomUUID()}`,
        });
        if (error) return json({ error: 'insert failed' }, 500);
        await audit(sb, uid, 'META_ADS_ADJUSTMENT', target, { amount, reason });
        return json({ ok: true });
      }

      case 'admin_test_connection': {
        if (!me.is_admin) return json({ error: 'forbidden' }, 403);
        const rows = capabilityMatrix(mode);
        return json({
          mode,
          secretsConfigured: mode === 'REAL',
          webhookVerifyTokenConfigured: !!Deno.env.get('META_WEBHOOK_VERIFY_TOKEN'),
          capabilities: rows,
          checkedAt: new Date().toISOString(),
        });
      }

      default:
        return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (err) {
    if (err instanceof MetaApiError) {
      return json({ error: err.normalized.customerKey, code: err.normalized.code }, 502);
    }
    console.error('[meta-ads-api]', action, err);
    return json({ error: 'internal' }, 500);
  }
});

/* ── helpers ───────────────────────────────────────────────────────── */

async function budgetLimits(sb: any) {
  const g = async (k: string, d: number) => {
    const { data } = await sb.from('admin_settings').select('value').eq('key', k).maybeSingle();
    return typeof data?.value === 'number' ? data.value : d;
  };
  return {
    minDurationDays: await g('meta_ads_min_duration_days', 2),
    minDailyCents: await g('meta_ads_daily_budget_min_cents', 200),
    maxDailyCents: await g('meta_ads_daily_budget_max_cents', 100000000),
  };
}

async function strategyInputFor(sb: any, uid: string, campaignId: string):
  Promise<{ strategy: StrategyInput } | { error: string }> {
  const { data: c } = await sb.from('meta_campaigns').select('*').eq('id', campaignId).eq('user_id', uid).maybeSingle();
  if (!c) return { error: 'campaign not found' };
  const { data: creatives } = await sb.from('meta_creatives')
    .select('id,kind,safety_status,media').eq('campaign_id', c.id);
  let audienceExternalId: string | null = null;
  if (c.audience_id) {
    const { data: aud } = await sb.from('meta_audiences').select('external_audience_id,sync_status,user_id')
      .eq('id', c.audience_id).maybeSingle();
    if (!aud || aud.user_id !== uid) return { error: 'audience not found' };
    if (aud.sync_status !== 'READY') return { error: 'AUDIENCE_NOT_READY' };
    audienceExternalId = aud.external_audience_id;
  }
  const cats = classifySpecialAdCategories({
    isProperty: !!c.property_id || !!(c.offer && c.offer.isProperty !== false),
    dealKind: c.offer?.dealKind ?? (c.property_id ? 'SALE' : 'OTHER'),
  });
  return {
    strategy: {
      goal: c.goal,
      dailyBudgetCents: Number(c.daily_budget_cents ?? 0),
      durationDays: Number(c.duration_days ?? 0),
      currency: c.currency,
      specialAdCategories: cats,
      creatives: (creatives ?? []).map((cr: any) => ({
        id: cr.id, kind: cr.kind,
        ready: (cr.media ?? []).length > 0 && cr.safety_status !== 'BLOCKED',
      })),
      destination: c.destination ?? { type: c.goal === 'LEADS_ON_META' ? 'META_FORM' : 'WEBSITE' },
      audienceExternalId,
      placementsMode: c.placements?.mode === 'CUSTOM' ? 'CUSTOM' : 'RECOMMENDED',
      customPlacements: c.placements?.list ?? [],
    },
  };
}

/** Creates the campaign tree at Meta (REAL) or as clearly-mock externals.
 *  v26 requirements are encoded here once: is_adset_budget_sharing_enabled
 *  on the campaign, explicit advantage_audience on special-category sets. */
async function publishCampaign(sb: any, uid: string, c: any, mode: 'REAL' | 'MOCK') {
  const plan = c.plan;
  if (!plan) throw new Error('no plan');
  if (mode === 'MOCK') {
    const campaignId = mockExternalId('camp');
    for (const set of plan.adSets) {
      const setId = mockExternalId('adset');
      await sb.from('meta_ad_entities').insert({
        campaign_id: c.id, kind: 'AD_SET', external_id: setId,
        name: `TEST ${set.key}`, status: 'ACTIVE', config: set,
      });
      for (const crId of set.creativeIds) {
        await sb.from('meta_ad_entities').insert({
          campaign_id: c.id, kind: 'AD', external_id: mockExternalId('ad'),
          name: `TEST ad ${crId.slice(0, 6)}`, status: 'ACTIVE', config: { creativeId: crId },
        });
      }
    }
    return { campaignId, status: 'ACTIVE' };
  }
  const token = await userToken(sb, uid);
  if (!token) throw new Error('NOT_CONNECTED');
  const acct = await selectedAsset(sb, uid, 'AD_ACCOUNT');
  const page = await selectedAsset(sb, uid, 'PAGE');
  if (!acct || !page) throw new Error('ASSETS_MISSING');
  const auditCtx = { sb, userId: uid, campaignId: c.id };
  const camp = await graph(`/${acct.external_id}/campaigns`, {
    token, method: 'POST', audit: auditCtx,
    body: {
      name: c.name || `HOMATCH ${c.goal}`,
      objective: plan.objective,
      status: 'PAUSED',
      special_ad_categories: plan.specialAdCategories,
      is_adset_budget_sharing_enabled: false,
    },
  });
  const end = new Date(Date.now() + c.duration_days * 86400000).toISOString();
  for (const set of plan.adSets) {
    const targeting: Record<string, unknown> = {
      geo_locations: { countries: ['GE'] },
      targeting_automation: { advantage_audience: set.advantageAudience ? 1 : 0 },
    };
    if (plan.audienceExternalId) targeting.custom_audiences = [{ id: plan.audienceExternalId }];
    const adset = await graph(`/${acct.external_id}/adsets`, {
      token, method: 'POST', audit: auditCtx,
      body: {
        name: `HOMATCH ${set.key}`, campaign_id: camp.id,
        daily_budget: set.dailyBudgetCents, billing_event: 'IMPRESSIONS',
        optimization_goal: plan.objective === 'OUTCOME_LEADS' ? 'LEAD_GENERATION' : 'LINK_CLICKS',
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        end_time: end, status: 'PAUSED', targeting,
      },
    });
    await sb.from('meta_ad_entities').insert({
      campaign_id: c.id, kind: 'AD_SET', external_id: String(adset.id), name: `HOMATCH ${set.key}`, config: set,
    });
    for (const crId of set.creativeIds) {
      const { data: cr } = await sb.from('meta_creatives').select('*').eq('id', crId).maybeSingle();
      if (!cr) continue;
      const creative = await graph(`/${acct.external_id}/adcreatives`, {
        token, method: 'POST', audit: auditCtx,
        body: {
          name: `HOMATCH creative ${crId.slice(0, 6)}`,
          object_story_spec: {
            page_id: page.external_id,
            link_data: {
              message: cr.primary_text, name: cr.headline,
              link: cr.destination_url ?? 'https://www.homatch.live',
              call_to_action: { type: cr.cta ?? 'LEARN_MORE' },
            },
          },
        },
      });
      const ad = await graph(`/${acct.external_id}/ads`, {
        token, method: 'POST', audit: auditCtx,
        body: { name: cr.headline || 'HOMATCH ad', adset_id: adset.id, creative: { creative_id: creative.id }, status: 'PAUSED' },
      });
      await sb.from('meta_ad_entities').insert({
        campaign_id: c.id, kind: 'CREATIVE', external_id: String(creative.id), config: { creativeId: crId },
      });
      await sb.from('meta_ad_entities').insert({
        campaign_id: c.id, kind: 'AD', external_id: String(ad.id), config: { creativeId: crId },
      });
      await sb.from('meta_creatives').update({ external_creative_id: String(creative.id) }).eq('id', crId);
    }
  }
  // Everything created PAUSED, then the campaign is switched on once, so a
  // partial failure never leaves a half-built tree spending money.
  await graph(`/${camp.id}`, { token, method: 'POST', body: { status: 'ACTIVE' }, audit: auditCtx });
  return { campaignId: String(camp.id), status: 'IN_PROCESS' };
}

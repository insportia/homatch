// META ADS — the orchestrator. Every consequential Meta Ads action lands
// here: capability status, connection, asset discovery and selection, plan
// preview, preflight, LAUNCH (the only path that can move money), pause /
// resume, sync, lead export/import, audiences, inline AI copy, deposits,
// funnel events, the admin probe, and the scheduled maintenance pass. The
// browser edits drafts through RLS; everything that talks to Meta or to the
// ledger happens here under service role, behind the admin kill switches,
// with idempotency keys. The Meta-facing work itself is in engine.ts.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  buildPlan, validatePlanInput, computeTotals, canTransition, type MetaGoal,
} from '../../../src/lib/metaAds/strategy.ts';
import { GOAL_SPECS, launchCharge, missingRequirements, recommendedPlacements } from '../../../src/lib/metaAds/payload.ts';
import { hashIdentifierRows, csvSafeCell, normalizeEmail, normalizePhone } from '../../../src/lib/metaAds/hashing.ts';
// Static, not `await import(...)`: the deploy prover walks static imports to
// compare the shipped bundle against this revision's closure.
import { getPaymentProvider } from '../_shared/payment_provider.ts';
import {
  metaMode, graph, graphAll, MetaApiError, oauthStartUrl, mockExternalId, capabilityMatrix, signOAuthState,
  sealToken, openToken, scrubText, REQUIRED_SCOPES_BY_GOAL,
} from '../_shared/metaAds.ts';
import { ingestLead } from '../_shared/metaLeads.ts';
import { callLlm, llmAvailable } from '../_shared/comm/llm.ts';
import {
  loadSettings, userToken, selectedAsset, pageToken, strategyInputFor, limitsOf, configFingerprint,
  runPreflight, publishCampaign, syncCampaign, propertyAuthorized,
} from './engine.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function audit(sb: any, actorId: string | null, action: string, target: string, meta: unknown) {
  try {
    await sb.from('admin_audit_log').insert({
      admin_id: actorId, action, target_type: 'META_ADS', target_id: target, details: meta ?? {},
    });
  } catch { /* best effort */ }
}

const ASSET_KINDS = ['BUSINESS', 'PAGE', 'INSTAGRAM', 'AD_ACCOUNT', 'PIXEL', 'LEAD_FORM', 'WHATSAPP'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? '');
  const mode = metaMode();

  /* ── SCHEDULED MAINTENANCE (cron token, no user) ─────────────────────── */
  const cronToken = req.headers.get('x-cron-token');
  if (cronToken) {
    /* The expected value lives in Supabase Vault, never in admin_settings:
       the database compares it (service-role only RPC), so no copy of the
       secret is ever read into this function or any admin screen. */
    const { data: tokenOk } = await sb.rpc('meta_ads_maintenance_token_ok', { p_token: cronToken });
    if (tokenOk !== true || action !== 'maintenance') return json({ error: 'Forbidden' }, 403);
    return json(await maintenance(sb, mode));
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'Invalid session' }, 401);
  const { data: me } = await sb.from('users').select('id,is_admin,email,suspended_at').eq('auth_id', user.id).maybeSingle();
  if (!me) return json({ error: 'User not found' }, 404);
  const uid = me.id as string;
  const settings = await loadSettings(sb);

  if (!settings.enabled && !me.is_admin) return json({ error: 'META_ADS_DISABLED', code: 'META_ADS_DISABLED' }, 503);

  try {
    switch (action) {
      /* ── STATUS: the one call the workspace and builder boot from ───── */
      case 'status': {
        const [{ data: conn }, { data: assets }, { data: wallet }] = await Promise.all([
          sb.from('meta_connections').select('id,status,granted_scopes,declined_scopes,token_expires_at,last_checked_at,meta_user_external_id,oauth_nonce,oauth_started_at,last_error').eq('user_id', uid).maybeSingle(),
          sb.from('meta_assets').select('id,kind,external_id,name,selected,status,parent_external_id,capabilities').eq('user_id', uid).order('kind').order('name'),
          sb.from('meta_wallet_balances').select('*').eq('user_id', uid).maybeSingle(),
        ]);
        const granted: string[] = conn?.granted_scopes ?? [];
        const missingScopes = [...new Set(Object.values(REQUIRED_SCOPES_BY_GOAL).flat())].filter((s) => !granted.includes(s));
        const expiresAt = conn?.token_expires_at ? Date.parse(conn.token_expires_at) : NaN;
        /* "Connected" is a claim about a usable credential, not about a row:
           the stored token must exist and open with this deployment's key. */
        let tokenUsable = false;
        if (conn?.status === 'CONNECTED') {
          const { data: tok } = await sb.from('meta_tokens').select('access_token').eq('connection_id', conn.id).maybeSingle();
          tokenUsable = !!(tok && await openToken(tok.access_token));
        }
        const startedAt = conn?.oauth_started_at ? Date.parse(conn.oauth_started_at) : NaN;
        const connecting = !!conn?.oauth_nonce && Number.isFinite(startedAt) && Date.now() - startedAt < 15 * 60_000;
        const adAccounts = (assets ?? []).filter((a: any) => a.kind === 'AD_ACCOUNT');
        const health = !conn || conn.status === 'DISCONNECTED' || (!conn.status && !connecting) ? 'NOT_CONNECTED'
          : conn.status !== 'CONNECTED' && connecting ? 'CONNECTING'
          : conn.status === 'EXPIRED' || (Number.isFinite(expiresAt) && expiresAt < Date.now()) ? 'TOKEN_EXPIRED'
          : conn.status === 'REVOKED' ? 'REVOKED'
          : conn.status === 'ERROR' ? 'ERROR'
          : !tokenUsable ? 'RECONNECT_REQUIRED'
          : missingScopes.length ? 'PERMISSION_MISSING'
          : (assets ?? []).length > 0 && adAccounts.length === 0 ? 'NO_ELIGIBLE_AD_ACCOUNT'
          : 'CONNECTED';
        return json({
          mode,
          connection: conn
            ? { status: conn.status, health, granted_scopes: granted, missing_scopes: missingScopes,
              token_expires_at: conn.token_expires_at, last_checked_at: conn.last_checked_at,
              // A named reason only (e.g. TOKEN_ENCRYPTION_NOT_CONFIGURED), never a raw error.
              error_reason: typeof conn.last_error === 'string' && /^[A-Z_]{3,64}$/.test(conn.last_error) ? conn.last_error : null }
            : { status: 'DISCONNECTED', health: 'NOT_CONNECTED', granted_scopes: [], missing_scopes: [] },
          // Asset capabilities carry account status/currency, never a token.
          assets: (assets ?? []).map((a: any) => ({ ...a, capabilities: a.capabilities ?? {} })),
          wallet: wallet ?? { available_cents: 0, reserved_cents: 0, spent_cents: 0, fees_cents: 0, deposited_cents: 0, currency: 'USD' },
          settings: {
            feePercent: settings.feePercent, minDurationDays: settings.minDurationDays,
            minDailyCents: settings.minDailyCents, maxDailyCents: settings.maxDailyCents,
            goalsEnabled: settings.goalsEnabled, leadImportEnabled: settings.leadImportEnabled,
            audienceCreationEnabled: settings.audienceCreationEnabled, retargetingEnabled: settings.retargetingEnabled,
            aiAssistEnabled: settings.aiAssistEnabled && llmAvailable(), publishingEnabled: settings.publishingEnabled,
            whatsappEnabled: settings.whatsappEnabled, countries: settings.defaultCountries,
            budgetBilling: settings.budgetBilling,
          },
        });
      }

      /* ── CONNECT ───────────────────────────────────────────────────── */
      case 'oauth_start': {
        await sb.from('meta_funnel_events').insert({ event: 'meta_ads_authenticated', user_id: uid });
        if (mode === 'MOCK') return json({ mode, mockConnect: true });
        // Refuse BEFORE sending the owner through Meta's dialog: a token that
        // cannot be stored encrypted would be thrown away at the callback.
        if (!Deno.env.get('META_TOKEN_ENCRYPTION_KEY')) {
          return json({ error: 'TOKEN_ENCRYPTION_NOT_CONFIGURED', code: 'TOKEN_ENCRYPTION_NOT_CONFIGURED' }, 409);
        }
        const nonce = crypto.randomUUID();
        await sb.from('meta_connections').upsert(
          { user_id: uid, oauth_nonce: nonce, oauth_started_at: new Date().toISOString() },
          { onConflict: 'user_id' });
        return json({ mode, url: oauthStartUrl(await signOAuthState({ uid, nonce })) });
      }

      case 'oauth_mock_connect': {
        // The sanctioned MOCK path (adapter has no credentials). Everything it
        // creates is unmistakably TEST/mock_, and no money ever moves in MOCK.
        if (mode !== 'MOCK') return json({ error: 'REAL mode active' }, 400);
        const { data: conn } = await sb.from('meta_connections').upsert({
          user_id: uid, status: 'CONNECTED', meta_user_external_id: mockExternalId('user'),
          granted_scopes: [...new Set(Object.values(REQUIRED_SCOPES_BY_GOAL).flat())], last_error: null,
          last_checked_at: new Date().toISOString(),
        }, { onConflict: 'user_id' }).select('id').single();
        await sb.from('meta_tokens').upsert({ connection_id: conn.id, access_token: `mock_${crypto.randomUUID()}` });
        for (const a of [
          { kind: 'BUSINESS', name: 'TEST Business' }, { kind: 'PAGE', name: 'TEST Page' },
          { kind: 'INSTAGRAM', name: 'TEST Instagram' }, { kind: 'AD_ACCOUNT', name: 'TEST Ad Account' },
          { kind: 'PIXEL', name: 'TEST Pixel' }, { kind: 'LEAD_FORM', name: 'TEST Lead form' },
        ]) {
          await sb.from('meta_assets').upsert({
            user_id: uid, kind: a.kind, external_id: mockExternalId(a.kind.toLowerCase()),
            name: a.name, selected: true, capabilities: { mock: true },
          }, { onConflict: 'user_id,kind,external_id', ignoreDuplicates: true });
        }
        await sb.from('meta_funnel_events').insert({ event: 'meta_connected', user_id: uid });
        return json({ ok: true, mode });
      }

      case 'disconnect': {
        const { data: conn } = await sb.from('meta_connections').select('id').eq('user_id', uid).maybeSingle();
        if (!conn) return json({ ok: true });
        const token = await userToken(sb, uid);
        if (mode === 'REAL' && token) {
          try { await graph('/me/permissions', { token, method: 'DELETE', attempts: 1 }); } catch { /* revoke best-effort */ }
        }
        await sb.from('meta_tokens').delete().eq('connection_id', conn.id);
        await sb.from('meta_connections').update({ status: 'DISCONNECTED', granted_scopes: [], token_expires_at: null }).eq('id', conn.id);
        await sb.from('meta_assets').update({ selected: false }).eq('user_id', uid);
        await audit(sb, uid, 'META_DISCONNECT', uid, {});
        return json({ ok: true });
      }

      case 'assets_refresh': {
        const token = await userToken(sb, uid);
        if (!token) return json({ error: 'NOT_CONNECTED', code: 'NOT_CONNECTED' }, 400);
        if (mode === 'MOCK') return json({ ok: true, mode });
        const auditCtx = { sb, userId: uid };
        const [biz, pages, accts] = await Promise.all([
          graphAll('/me/businesses?fields=id,name&limit=100', { token, audit: auditCtx }),
          graphAll('/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100', { token, audit: auditCtx }),
          graphAll('/me/adaccounts?fields=id,name,account_status,currency,business,disable_reason&limit=100', { token, audit: auditCtx }),
        ]);
        const up = (kind: string, external_id: string, name: string, parent?: string | null, capabilities?: unknown) =>
          sb.from('meta_assets').upsert({
            user_id: uid, kind, external_id, name, parent_external_id: parent ?? null,
            capabilities: capabilities ?? {}, status: 'ACTIVE', updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id,kind,external_id' });
        const seen: Record<string, string[]> = {};
        const mark = (kind: string, id: string) => { (seen[kind] ??= []).push(id); };
        for (const b of biz as any[]) { await up('BUSINESS', b.id, b.name); mark('BUSINESS', b.id); }
        for (const p of pages as any[]) {
          await up('PAGE', p.id, p.name); mark('PAGE', p.id);
          if (p.instagram_business_account) {
            await up('INSTAGRAM', p.instagram_business_account.id, p.instagram_business_account.username ?? 'Instagram', p.id);
            mark('INSTAGRAM', p.instagram_business_account.id);
          }
          // Lead forms live on the Page and are read with its token, which is
          // used here and discarded — never stored.
          if (p.access_token) {
            try {
              const forms = await graphAll(`/${p.id}/leadgen_forms?fields=id,name,status,locale&limit=100`, { token: p.access_token }, 2);
              for (const f of forms as any[]) {
                if (String(f.status) !== 'ACTIVE') continue;
                await up('LEAD_FORM', f.id, f.name, p.id, { locale: f.locale ?? null });
                mark('LEAD_FORM', f.id);
              }
            } catch { /* the page may not allow lead forms; not fatal */ }
          }
        }
        for (const a of accts as any[]) {
          await up('AD_ACCOUNT', a.id, a.name, a.business?.id, { account_status: a.account_status, currency: a.currency, disable_reason: a.disable_reason ?? null });
          mark('AD_ACCOUNT', a.id);
          try {
            const pixels = await graphAll(`/${a.id}/adspixels?fields=id,name,last_fired_time&limit=100`, { token, audit: auditCtx }, 2);
            for (const px of pixels as any[]) {
              await up('PIXEL', px.id, px.name, a.id, { last_fired_time: px.last_fired_time ?? null });
              mark('PIXEL', px.id);
            }
          } catch { /* no pixel access is a state, not an error */ }
        }
        // Assets no longer granted are marked, not deleted.
        for (const kind of ['BUSINESS', 'PAGE', 'INSTAGRAM', 'AD_ACCOUNT', 'PIXEL', 'LEAD_FORM']) {
          const ids = seen[kind] ?? [];
          let q = sb.from('meta_assets').update({ status: 'UNAVAILABLE', selected: false }).eq('user_id', uid).eq('kind', kind);
          if (ids.length) q = q.not('external_id', 'in', `(${ids.map((i) => `"${i}"`).join(',')})`);
          await q;
        }
        await sb.from('meta_connections').update({ last_checked_at: new Date().toISOString() }).eq('user_id', uid);
        return json({ ok: true, counts: Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, v.length])) });
      }

      case 'select_asset': {
        const { kind, assetId } = body;
        if (!ASSET_KINDS.includes(kind)) return json({ error: 'bad kind' }, 400);
        const { data: asset } = await sb.from('meta_assets').select('*').eq('user_id', uid).eq('id', assetId).eq('kind', kind).maybeSingle();
        if (!asset || asset.status === 'UNAVAILABLE') return json({ error: 'asset not found' }, 404);
        await sb.from('meta_assets').update({ selected: false }).eq('user_id', uid).eq('kind', kind);
        await sb.from('meta_assets').update({ selected: true }).eq('id', asset.id);
        let subscribed: boolean | null = null;
        // A selected Page is subscribed to leadgen webhooks, or leads never arrive.
        if (kind === 'PAGE' && mode === 'REAL') {
          const token = await userToken(sb, uid);
          if (token) {
            try {
              const pt = await pageToken(token, asset.external_id, { sb, userId: uid });
              if (pt) {
                await graph(`/${asset.external_id}/subscribed_apps`, { token: pt, method: 'POST', body: { subscribed_fields: 'leadgen' }, attempts: 1 });
                subscribed = true;
              }
            } catch { subscribed = false; }
            await sb.from('meta_assets').update({ capabilities: { ...(asset.capabilities ?? {}), leadgen_subscribed: subscribed } }).eq('id', asset.id);
          }
        }
        return json({ ok: true, leadgenSubscribed: subscribed });
      }

      case 'create_lead_form': {
        // Guided Instant Form: name, privacy policy, standard fields. Meta
        // requires a privacy-policy URL on every lead form.
        const page = await selectedAsset(sb, uid, 'PAGE');
        if (!page) return json({ error: 'NO_PAGE', code: 'NO_PAGE' }, 400);
        const name = String(body.name ?? '').trim().slice(0, 100);
        const privacyUrl = String(body.privacyPolicyUrl ?? '').trim();
        if (!name) return json({ error: 'NAME_REQUIRED', code: 'NAME_REQUIRED' }, 400);
        if (!/^https:\/\//.test(privacyUrl)) return json({ error: 'PRIVACY_URL_REQUIRED', code: 'PRIVACY_URL_REQUIRED' }, 400);
        const allowed = ['FULL_NAME', 'EMAIL', 'PHONE'];
        const fields = (Array.isArray(body.fields) ? body.fields : allowed).map(String).filter((f: string) => allowed.includes(f));
        if (!fields.length) return json({ error: 'FIELDS_REQUIRED' }, 400);
        let externalId: string;
        if (mode === 'MOCK') externalId = mockExternalId('form');
        else {
          const token = await userToken(sb, uid);
          if (!token) return json({ error: 'NOT_CONNECTED', code: 'NOT_CONNECTED' }, 400);
          const pt = await pageToken(token, page.external_id, { sb, userId: uid });
          if (!pt) return json({ error: 'meta_err_permission', code: 'PAGE_TOKEN_UNAVAILABLE' }, 400);
          const created = await graph(`/${page.external_id}/leadgen_forms`, {
            token: pt, method: 'POST', audit: { sb, userId: uid },
            body: {
              name,
              questions: fields.map((type: string) => ({ type })),
              privacy_policy: { url: privacyUrl, link_text: String(body.privacyLinkText ?? 'Privacy policy').slice(0, 70) },
              locale: String(body.locale ?? 'en_US'),
              follow_up_action_url: String(body.followUpUrl ?? privacyUrl),
            },
          });
          externalId = String(created.id);
        }
        await sb.from('meta_assets').update({ selected: false }).eq('user_id', uid).eq('kind', 'LEAD_FORM');
        const { data: asset } = await sb.from('meta_assets').upsert({
          user_id: uid, kind: 'LEAD_FORM', external_id: externalId, name, parent_external_id: page.external_id,
          selected: true, status: 'ACTIVE', capabilities: { fields, created_by_homatch: true, mock: mode === 'MOCK' },
        }, { onConflict: 'user_id,kind,external_id' }).select('id,external_id,name').single();
        await audit(sb, uid, 'META_LEAD_FORM_CREATE', externalId, { fields });
        return json({ ok: true, form: asset, mode });
      }

      /* ── PLAN + PREFLIGHT ──────────────────────────────────────────── */
      case 'plan_preview': {
        const { data: c } = await sb.from('meta_campaigns').select('*').eq('id', body.campaignId).eq('user_id', uid).maybeSingle();
        if (!c) return json({ error: 'not found' }, 404);
        const input = await strategyInputFor(sb, uid, c, settings);
        if ('error' in input) return json(input, 400);
        const issues = validatePlanInput(input.strategy, limitsOf(settings));
        const totals = computeTotals(input.strategy.dailyBudgetCents, input.strategy.durationDays, settings.feePercent);
        const plan = issues.length === 0 ? buildPlan(input.strategy) : null;
        const [page, ig, pixel, form] = await Promise.all([
          selectedAsset(sb, uid, 'PAGE'), selectedAsset(sb, uid, 'INSTAGRAM'), selectedAsset(sb, uid, 'PIXEL'), selectedAsset(sb, uid, 'LEAD_FORM'),
        ]);
        const goal = c.goal as MetaGoal;
        const { data: crs } = await sb.from('meta_creatives').select('media').eq('campaign_id', c.id);
        const hasVideo = (crs ?? []).some((cr: any) => String(cr.media?.[0]?.mime ?? '').startsWith('video'));
        return json({
          issues, totals,
          requirements: missingRequirements(goal, {
            pageId: page?.external_id ?? '', instagramUserId: ig?.external_id ?? null, pixelId: pixel?.external_id ?? null,
            leadFormId: c.destination?.formId ?? form?.external_id ?? null, messagingApp: c.destination?.messagingApp ?? null,
            whatsappNumber: null, websiteUrl: c.destination?.url ?? null,
          }),
          goalSpec: { ...GOAL_SPECS[goal] },
          recommendedPlacements: recommendedPlacements({ hasInstagram: !!ig, hasVideo, goal }),
          summary: plan ? {
            adSetCount: plan.adSets.length,
            creativeCount: plan.adSets.reduce((n, s) => n + s.creativeIds.length, 0),
            specialAdCategories: plan.specialAdCategories,
            placementsMode: plan.placements.mode,
            objective: plan.objective,
          } : null,
        });
      }

      case 'preflight': {
        const { data: c } = await sb.from('meta_campaigns').select('*').eq('id', body.campaignId).eq('user_id', uid).maybeSingle();
        if (!c) return json({ error: 'not found' }, 404);
        if (!['DRAFT', 'CONNECTION_REQUIRED', 'CREATIVE_REQUIRED', 'AUDIENCE_REQUIRED', 'PREFLIGHT_REQUIRED', 'NEEDS_CHANGES', 'READY', 'PAYMENT_REQUIRED', 'FAILED', 'REJECTED'].includes(c.status)) {
          return json({ error: 'ALREADY_LAUNCHED', code: 'ALREADY_LAUNCHED', status: c.status }, 409);
        }
        return json(await runPreflight(sb, uid, c, settings, mode));
      }

      /* ── LAUNCH: the only door to money and Meta ───────────────────── */
      case 'launch': {
        if (!settings.publishingEnabled) return json({ error: 'PUBLISHING_DISABLED', code: 'PUBLISHING_DISABLED' }, 503);
        if (me.suspended_at) return json({ error: 'ACCOUNT_SUSPENDED', code: 'ACCOUNT_SUSPENDED' }, 403);
        const idem = String(body.idempotencyKey ?? '');
        if (!/^[0-9a-f-]{36}$/.test(idem)) return json({ error: 'idempotencyKey required' }, 400);
        const { data: c } = await sb.from('meta_campaigns').select('*').eq('id', body.campaignId).eq('user_id', uid).maybeSingle();
        if (!c) return json({ error: 'not found' }, 404);
        if (c.launch_idempotency_key === idem && c.external_campaign_id) {
          return json({ ok: true, already: true, status: c.status, mode });
        }
        /* One launch intent, one fee. A key that already carried a fee (a
           failed attempt, refunded) can never be reused: its ledger rows are
           unique, so a second attempt under it would go live with no fee. */
        {
          const { data: spent } = await sb.from('meta_ads_ledger').select('id').in('idempotency_key', [`${idem}:fee`, `${idem}:reserve`]).limit(1);
          if ((spent ?? []).length > 0) return json({ error: 'IDEMPOTENCY_KEY_USED', code: 'IDEMPOTENCY_KEY_USED', rotateKey: true }, 409);
        }
        if (!(await propertyAuthorized(sb, uid, c.property_id))) {
          return json({ error: 'PROPERTY_NOT_OWNED', code: 'PROPERTY_NOT_OWNED' }, 403);
        }
        if (c.status !== 'READY' || c.preflight?.status !== 'READY') {
          return json({ error: 'NOT_READY', code: 'NOT_READY', status: c.status }, 409);
        }
        if (!settings.goalsEnabled.includes(c.goal)) return json({ error: 'GOAL_DISABLED', code: 'GOAL_DISABLED' }, 409);
        // What was checked is what launches: any edit since preflight → check again.
        if ((await configFingerprint(sb, c)) !== c.preflight?.fingerprint || !c.plan) {
          await sb.from('meta_campaigns').update({ status: 'PREFLIGHT_REQUIRED' }).eq('id', c.id);
          return json({ error: 'PREFLIGHT_STALE', code: 'PREFLIGHT_STALE' }, 409);
        }
        if (!canTransition(c.status, 'LAUNCHING')) return json({ error: 'BAD_TRANSITION' }, 409);
        // Charged from the FROZEN plan — the same numbers Meta receives.
        const plan = c.plan;
        const dailyFromPlan = plan.adSets.reduce((s: number, a: { dailyBudgetCents: number }) => s + Number(a.dailyBudgetCents), 0);
        const totals = computeTotals(dailyFromPlan, Number(c.duration_days), settings.feePercent);
        /* What HOMATCH itself holds. With the customer's own ad account (the
           default) that is the fee alone: Meta bills the ad budget to that
           account directly, and holding it here as well would be a second
           charge for the same money. */
        const charge = launchCharge(totals, settings.budgetBilling);
        if (mode === 'REAL') {
          const { data: wallet } = await sb.from('meta_wallet_balances').select('available_cents').eq('user_id', uid).maybeSingle();
          if ((wallet?.available_cents ?? 0) < charge.requiredCents) {
            await sb.from('meta_campaigns').update({ status: 'PAYMENT_REQUIRED' }).eq('id', c.id);
            return json({ error: 'INSUFFICIENT_FUNDS', code: 'INSUFFICIENT_FUNDS', totals, requiredCents: charge.requiredCents, budgetBilling: settings.budgetBilling }, 402);
          }
        }
        const claimed = await sb.from('meta_campaigns')
          .update({ status: 'LAUNCHING', launch_idempotency_key: idem, launched_at: new Date().toISOString() })
          .eq('id', c.id).eq('status', 'READY').is('launch_idempotency_key', null)
          .select('id').maybeSingle();
        if (!claimed.data) return json({ error: 'LAUNCH_IN_PROGRESS', code: 'LAUNCH_IN_PROGRESS' }, 409);

        // MOCK never touches customer money.
        if (mode === 'REAL') {
          for (const row of [
            { entry_type: 'RESERVE', amount_cents: -charge.reserveCents, idempotency_key: `${idem}:reserve` },
            { entry_type: 'HOMATCH_FEE', amount_cents: -charge.feeCents, idempotency_key: `${idem}:fee` },
          ]) {
            if (row.amount_cents === 0) continue;
            const r = await sb.from('meta_ads_ledger').insert({ user_id: uid, currency: c.currency, campaign_id: c.id, ...row });
            if (r.error && String(r.error.message).includes('INSUFFICIENT_FUNDS')) {
              /* The database refused the debit (per-user lock + balance check):
                 a concurrent launch got there first. Give back whatever this
                 attempt already took and stop before anything reaches Meta. */
              await refundAttempt(sb, c, idem);
              await sb.from('meta_campaigns').update({ status: 'PAYMENT_REQUIRED', launch_idempotency_key: null, launched_at: null }).eq('id', c.id);
              return json({ error: 'INSUFFICIENT_FUNDS', code: 'INSUFFICIENT_FUNDS', totals, requiredCents: charge.requiredCents, budgetBilling: settings.budgetBilling, rotateKey: true }, 402);
            }
            if (r.error && !String(r.error.message).includes('duplicate')) throw r.error;
          }
        }
        await sb.from('meta_funnel_events').insert({ event: 'launch_requested', user_id: uid });
        try {
          const external = await publishCampaign(sb, uid, c, plan, mode, settings);
          await sb.from('meta_campaigns').update({
            external_campaign_id: external.campaignId, external_status: external.status,
            status: 'SUBMITTED', last_synced_at: new Date().toISOString(), last_error: null,
          }).eq('id', c.id);
          let after: Record<string, unknown> = { status: 'SUBMITTED' };
          if (mode === 'REAL') {
            try {
              const { data: fresh } = await sb.from('meta_campaigns').select('*').eq('id', c.id).single();
              after = await syncCampaign(sb, fresh, mode);
            } catch { /* the scheduled sync will catch up */ }
          }
          try {
            await sb.rpc('notify_emit', {
              p_user_id: uid, p_type: 'META_CAMPAIGN_STATUS', p_title: 'Meta Ads',
              p_body: 'CAMPAIGN_SUBMITTED', p_deep_link: `/outreach/meta/campaigns/${c.id}`,
            });
          } catch { /* best effort */ }
          await sb.from('meta_funnel_events').insert({ event: 'published', user_id: uid });
          await audit(sb, uid, 'META_CAMPAIGN_LAUNCH', c.id, { totals, charge, budgetBilling: settings.budgetBilling, mode, externalCampaignId: external.campaignId });
          return json({ ok: true, status: after.status ?? 'SUBMITTED', totals, charge, budgetBilling: settings.budgetBilling, mode, externalCampaignId: external.campaignId });
        } catch (err) {
          if (mode === 'REAL') await refundAttempt(sb, c, idem);
          const norm = err instanceof MetaApiError ? err.normalized : null;
          await sb.from('meta_campaigns').update({
            status: 'FAILED', launch_idempotency_key: null, external_campaign_id: null,
            last_error: norm ? { key: norm.customerKey, code: norm.code, detail: scrubText(norm.rawMessage).slice(0, 200) } : { key: 'meta_err_generic' },
          }).eq('id', c.id);
          return json({ error: norm?.customerKey ?? 'meta_err_generic', code: 'LAUNCH_FAILED', detail: norm?.rawMessage ? scrubText(norm.rawMessage).slice(0, 200) : null }, 502);
        }
      }

      case 'pause': case 'resume': case 'archive': {
        const { data: c } = await sb.from('meta_campaigns').select('*').eq('id', body.campaignId).eq('user_id', uid).maybeSingle();
        if (!c) return json({ error: 'not found' }, 404);
        const to = action === 'pause' ? 'PAUSED' : action === 'resume' ? 'ACTIVE' : 'ARCHIVED';
        const launched = !!c.external_campaign_id;
        const from = c.status;
        const allowed = to === 'PAUSED' ? ['SUBMITTED', 'META_REVIEW', 'ACTIVE'].includes(from)
          : to === 'ACTIVE' ? from === 'PAUSED'
          : canTransition(from, 'ARCHIVED') || ['PAUSED', 'COMPLETED', 'REJECTED', 'FAILED'].includes(from);
        if (!allowed) return json({ error: 'BAD_TRANSITION', from }, 409);
        if (mode === 'REAL' && launched && !String(c.external_campaign_id).startsWith('mock_')) {
          const token = await userToken(sb, uid);
          if (!token) return json({ error: 'NOT_CONNECTED', code: 'NOT_CONNECTED' }, 400);
          await graph(`/${c.external_campaign_id}`, {
            token, method: 'POST', body: { status: to === 'ARCHIVED' ? 'ARCHIVED' : to === 'PAUSED' ? 'PAUSED' : 'ACTIVE' },
            audit: { sb, userId: uid, campaignId: c.id },
          });
        }
        // Resume is not "ACTIVE" until Meta says so: set review, then read Meta.
        await sb.from('meta_campaigns').update({ status: to === 'ACTIVE' ? 'META_REVIEW' : to }).eq('id', c.id);
        let result: Record<string, unknown> = { status: to === 'ACTIVE' ? 'META_REVIEW' : to };
        // Archive syncs as well: the final spend is what settles the fee.
        if (mode === 'REAL' && launched && !String(c.external_campaign_id).startsWith('mock_')) {
          const { data: fresh } = await sb.from('meta_campaigns').select('*').eq('id', c.id).single();
          result = await syncCampaign(sb, fresh, mode);
        }
        await audit(sb, uid, `META_CAMPAIGN_${to}`, c.id, {});
        return json({ ok: true, ...result });
      }

      case 'sync': {
        const { data: c } = await sb.from('meta_campaigns').select('*').eq('id', body.campaignId).eq('user_id', uid).maybeSingle();
        if (!c?.external_campaign_id) return json({ error: 'not launched' }, 400);
        return json(await syncCampaign(sb, c, mode));
      }

      /* ── INLINE AI COPY: suggestions only, never written for the user ── */
      case 'ai_copy': {
        if (!settings.aiAssistEnabled || !llmAvailable()) return json({ error: 'AI_UNAVAILABLE', code: 'AI_UNAVAILABLE' }, 503);
        const { data: c } = await sb.from('meta_campaigns').select('*').eq('id', body.campaignId).eq('user_id', uid).maybeSingle();
        if (!c) return json({ error: 'not found' }, 404);
        // Model calls cost money: at most 30 suggestions per customer per hour.
        const { count: recent } = await sb.from('meta_funnel_events').select('id', { count: 'exact', head: true })
          .eq('user_id', uid).like('event', 'ai_copy_%').gte('created_at', new Date(Date.now() - 3_600_000).toISOString());
        if ((recent ?? 0) >= 30) return json({ error: 'AI_RATE_LIMITED', code: 'AI_RATE_LIMITED' }, 429);
        const op = String(body.op ?? 'GENERATE');
        if (!['GENERATE', 'IMPROVE', 'SHORTEN', 'PROFESSIONAL', 'ALTERNATIVES', 'TRANSLATE'].includes(op)) return json({ error: 'bad op' }, 400);
        const language = String(body.language ?? 'ka').slice(0, 5);
        const context = await copyContext(sb, uid, c);
        const current = {
          primaryText: String(body.current?.primaryText ?? '').slice(0, 2200),
          headline: String(body.current?.headline ?? '').slice(0, 255),
          description: String(body.current?.description ?? '').slice(0, 255),
        };
        const notes = String(body.notes ?? '').slice(0, 600);
        const result = await callLlm({
          system: COPY_SYSTEM,
          user: JSON.stringify({ op, targetLanguage: language, goal: c.goal, destinationType: c.destination?.type ?? null, context, current, notes }),
          json: true, maxTokens: 700, timeoutMs: 25_000,
        });
        const parsed = (result.parsed ?? {}) as { variants?: Array<Record<string, unknown>> };
        const variants = (parsed.variants ?? []).slice(0, 3).map((v) => ({
          primaryText: String(v.primaryText ?? '').slice(0, 2200),
          headline: String(v.headline ?? '').slice(0, 255),
          description: String(v.description ?? '').slice(0, 255),
        })).filter((v) => v.primaryText || v.headline)
          .filter((v) => !/(guaranteed|გარანტირებულ|гарантир|garantili|مضمون|מובטח)/i.test(`${v.primaryText} ${v.headline}`));
        if (!result.ok || variants.length === 0) return json({ error: 'AI_NO_RESULT', code: 'AI_NO_RESULT' }, 502);
        await sb.from('meta_funnel_events').insert({ event: `ai_copy_${op.toLowerCase()}`, user_id: uid });
        return json({ variants, usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens, model: result.model } });
      }

      /* ── MONEY ─────────────────────────────────────────────────────── */
      case 'deposit_checkout': {
        const provider = getPaymentProvider();
        const amountCents = Math.round(Number(body.amountCents) || 0);
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
        try {
          await sb.from('payments').insert({
            user_id: uid, amount_cents: amountCents, currency: 'USD', status: 'PENDING',
            provider: (provider as { name?: string }).name ?? 'provider',
            provider_id: checkout.providerCheckoutId, meta: { domain: 'META_ADS', idempotency_key: idem },
          });
        } catch { /* the webhook is the source of truth */ }
        await sb.from('meta_funnel_events').insert({ event: 'checkout_started', user_id: uid });
        return json({ url: checkout.checkoutUrl, mock: checkout.mock });
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
        if (!settings.leadImportEnabled) return json({ error: 'IMPORT_DISABLED' }, 503);
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
        if (!settings.audienceCreationEnabled) return json({ error: 'AUDIENCES_DISABLED' }, 503);
        const acct = await selectedAsset(sb, uid, 'AD_ACCOUNT');
        if (!acct) return json({ error: 'NO_AD_ACCOUNT', code: 'NO_AD_ACCOUNT' }, 400);
        const { data: terms } = await sb.from('meta_audience_terms').select('accepted_at')
          .eq('user_id', uid).eq('ad_account_external_id', acct.external_id).maybeSingle();
        if (!terms) return json({ error: 'TERMS_REQUIRED', code: 'TERMS_REQUIRED' }, 428);
        const name = String(body.name ?? '').trim().slice(0, 80);
        const source = String(body.source ?? '');
        if (!name) return json({ error: 'NAME_REQUIRED' }, 400);
        if (!['UPLOADED_LIST', 'HOMATCH_LEADS', 'CAMPAIGN_LEADS'].includes(source)) return json({ error: 'SOURCE_UNSUPPORTED' }, 400);
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
          await sb.from('meta_audiences').update({ external_audience_id: mockExternalId('aud'), sync_status: 'READY' }).eq('id', aud.id);
          return json({ ok: true, audienceId: aud.id, mode, accepted: hashed.accepted, rejected: hashed.rejected });
        }
        const token = await userToken(sb, uid);
        if (!token) return json({ error: 'NOT_CONNECTED' }, 400);
        try {
          const created = await graph(`/${acct.external_id}/customaudiences`, {
            token, method: 'POST', body: { name, subtype: 'CUSTOM', customer_file_source: 'USER_PROVIDED_ONLY' },
            audit: { sb, userId: uid },
          });
          await graph(`/${created.id}/users`, {
            token, method: 'POST', body: { payload: { schema: hashed.schema, data: hashed.rows } }, audit: { sb, userId: uid },
          });
          await sb.from('meta_audiences').update({ external_audience_id: String(created.id), sync_status: 'READY' }).eq('id', aud.id);
          return json({ ok: true, audienceId: aud.id, accepted: hashed.accepted, rejected: hashed.rejected });
        } catch (err) {
          const norm = err instanceof MetaApiError ? err.normalized : null;
          await sb.from('meta_audiences').update({ sync_status: 'FAILED', last_error: norm?.customerKey ?? 'meta_err_generic' }).eq('id', aud.id);
          return json({ error: norm?.customerKey ?? 'meta_err_generic' }, 502);
        }
      }

      /* ── FUNNEL + ADMIN ───────────────────────────────────────────── */
      case 'funnel': {
        try { await sb.from('meta_funnel_events').insert({ event: String(body.event ?? '').slice(0, 80), user_id: uid }); } catch { /* fine */ }
        return json({ ok: true });
      }

      case 'admin_adjust': {
        if (!me.is_admin) return json({ error: 'forbidden' }, 403);
        const target = String(body.targetUserId ?? '');
        const amount = Math.round(Number(body.amountCents) || 0);
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
        return json({
          mode,
          secretsConfigured: mode === 'REAL',
          webhookVerifyTokenConfigured: !!Deno.env.get('META_WEBHOOK_VERIFY_TOKEN'),
          tokenEncryptionConfigured: !!Deno.env.get('META_TOKEN_ENCRYPTION_KEY'),
          redirectUriConfigured: !!Deno.env.get('META_OAUTH_REDIRECT'),
          capabilities: capabilityMatrix(mode),
          checkedAt: new Date().toISOString(),
        });
      }

      case 'admin_sync': {
        if (!me.is_admin) return json({ error: 'forbidden' }, 403);
        const { data: c } = await sb.from('meta_campaigns').select('*').eq('id', body.campaignId).maybeSingle();
        if (!c?.external_campaign_id) return json({ error: 'not launched' }, 400);
        await audit(sb, uid, 'META_ADMIN_SYNC', c.id, {});
        return json(await syncCampaign(sb, c, mode));
      }

      default:
        return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (err) {
    if (err instanceof MetaApiError) {
      return json({ error: err.normalized.customerKey, code: err.normalized.code }, 502);
    }
    console.error('[meta-ads-api]', action, scrubText(err instanceof Error ? err.message : String(err)));
    return json({ error: 'internal' }, 500);
  }
});

/* ── MAINTENANCE: the scheduled pass ─────────────────────────────────── */

async function maintenance(sb: any, mode: 'REAL' | 'MOCK') {
  const report = { synced: 0, syncFailed: 0, recovered: 0, leadsRetried: 0, expired: 0 };
  // 1. Status + spend for everything that is live at Meta.
  const { data: live } = await sb.from('meta_campaigns').select('*')
    .in('status', ['SUBMITTED', 'META_REVIEW', 'ACTIVE', 'PAUSED'])
    .not('external_campaign_id', 'is', null)
    .order('last_synced_at', { ascending: true, nullsFirst: true }).limit(25);
  for (const c of live ?? []) {
    try { await syncCampaign(sb, c, mode); report.synced += 1; } catch { report.syncFailed += 1; }
  }
  // 2. A launch that died mid-flight: never leave money reserved against nothing.
  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data: stuck } = await sb.from('meta_campaigns').select('*').eq('status', 'LAUNCHING').lt('updated_at', cutoff).limit(10);
  for (const c of stuck ?? []) {
    if (c.external_campaign_id) {
      await sb.from('meta_campaigns').update({ status: 'SUBMITTED' }).eq('id', c.id);
      try { await syncCampaign(sb, { ...c, status: 'SUBMITTED' }, mode); } catch { /* next pass */ }
    } else {
      if (c.launch_idempotency_key) await refundAttempt(sb, c, c.launch_idempotency_key);
      await sb.from('meta_campaigns').update({ status: 'FAILED', launch_idempotency_key: null, last_error: { key: 'meta_err_generic', code: 'LAUNCH_INTERRUPTED' } }).eq('id', c.id);
    }
    report.recovered += 1;
  }
  // 3. Signed lead webhooks that failed to ingest (owner token hiccup etc.).
  const { data: failed } = await sb.from('meta_webhook_events').select('id,payload,error')
    .eq('signature_ok', true).is('processed_at', null).not('error', 'is', null)
    .gt('received_at', new Date(Date.now() - 3 * 86_400_000).toISOString()).limit(25);
  for (const ev of failed ?? []) {
    if (ev.payload?.field !== 'leadgen' || !ev.payload?.value?.leadgen_id || ev.error === 'LEAD_SYNC_DISABLED') continue;
    try {
      const r = await ingestLead(sb, ev.payload.value);
      await sb.from('meta_webhook_events').update({ processed_at: new Date().toISOString(), error: r.note }).eq('id', ev.id);
      report.leadsRetried += 1;
    } catch (err) {
      await sb.from('meta_webhook_events').update({ error: scrubText(err instanceof Error ? err.message : String(err)).slice(0, 400) }).eq('id', ev.id);
    }
  }
  // 4. Tokens past expiry become EXPIRED, so the UI asks to reconnect.
  const { data: tokens } = await sb.from('meta_tokens').select('connection_id').lt('expires_at', new Date().toISOString());
  for (const t of tokens ?? []) {
    const { data: u } = await sb.from('meta_connections').update({ status: 'EXPIRED' }).eq('id', t.connection_id).eq('status', 'CONNECTED').select('id');
    report.expired += (u ?? []).length;
  }
  return { ok: true, mode, ...report };
}

/* ── COPY CONTEXT ────────────────────────────────────────────────────── */

const COPY_SYSTEM = [
  'You write Meta (Facebook/Instagram) ad copy for HOMATCH customers — property owners, agents and small businesses in Georgia.',
  'Write in the requested targetLanguage. Be specific to the offer; use only facts present in context or current text or notes.',
  'Never invent prices, sizes, locations, amenities, discounts or deadlines. Never promise results, returns, approval or guaranteed income.',
  'For housing, never mention or target protected characteristics (race, religion, family status, disability, sex, age).',
  'primaryText: up to ~3 short lines; headline: up to 40 characters; description: optional, up to 30 characters.',
  'op GENERATE: write fresh copy. IMPROVE: improve current. SHORTEN: shorter version of current. PROFESSIONAL: more professional tone of current.',
  'ALTERNATIVES: three different angles. TRANSLATE: translate current faithfully to targetLanguage.',
  'Reply with JSON only: {"variants":[{"primaryText":"","headline":"","description":""}]} — 1 variant, or 3 for ALTERNATIVES.',
].join('\n');

async function copyContext(sb: any, uid: string, c: any): Promise<Record<string, unknown>> {
  const ctx: Record<string, unknown> = { offer: c.offer ?? null };
  if (c.property_id) {
    // property_id is the six-digit HOMATCH id; older drafts may hold the row uuid.
    const byHomatchId = /^\d{6}$/.test(String(c.property_id));
    const { data: prop } = await sb.from('properties').select('id,title,transaction_type,property_type,user_id')
      .eq(byHomatchId ? 'homatch_id' : 'id', byHomatchId ? Number(c.property_id) : c.property_id).maybeSingle();
    if (prop && prop.user_id === uid) {
      const { data: facts } = await sb.from('property_facts')
        .select('city,district,neighborhood,total_price,currency,area,rooms,bedrooms,floor,total_floors,condition,furnished,parking,balcony,view,new_build')
        .eq('property_id', prop.id).maybeSingle();
      // The contact phone and exact address are never sent to a model.
      ctx.property = { title: prop.title, transaction: prop.transaction_type, type: prop.property_type, ...(facts ?? {}) };
    }
  }
  return ctx;
}

/* ── ATTEMPT REFUND ──────────────────────────────────────────────────────
   A launch attempt that did not reach Meta gives back exactly what IT took,
   under keys derived from its own idempotency key: the campaign-level
   settlement keys stay free for the attempt that eventually goes live. */
async function refundAttempt(sb: any, c: any, idem: string) {
  const { data: rows } = await sb.from('meta_ads_ledger').select('entry_type,amount_cents,idempotency_key')
    .in('idempotency_key', [`${idem}:reserve`, `${idem}:fee`]);
  const took = (kind: string) => -(rows ?? []).filter((r: any) => r.entry_type === kind).reduce((n: number, r: any) => n + Number(r.amount_cents), 0);
  for (const row of [
    { entry_type: 'RELEASE', amount_cents: took('RESERVE'), idempotency_key: `${idem}:release`, note: 'launch did not reach Meta' },
    { entry_type: 'REFUND', amount_cents: took('HOMATCH_FEE'), idempotency_key: `${idem}:feerefund`, note: 'launch did not reach Meta' },
  ]) {
    if (row.amount_cents <= 0) continue;
    let { error } = await sb.from('meta_ads_ledger').insert({ user_id: c.user_id, currency: c.currency, campaign_id: c.id, ...row });
    if (error && !String(error.message).includes('duplicate')) {
      ({ error } = await sb.from('meta_ads_ledger').insert({ user_id: c.user_id, currency: c.currency, campaign_id: c.id, ...row }));
      if (error && !String(error.message).includes('duplicate')) {
        // Never silent: the money owed back is recorded for support.
        await audit(sb, c.user_id, 'META_REFUND_FAILED', c.id, { key: row.idempotency_key, cents: row.amount_cents });
      }
    }
  }
}

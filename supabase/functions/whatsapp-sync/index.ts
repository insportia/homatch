// HOMATCH — pulling WhatsApp truth back from Meta.
//
// Two things drift, and both matter:
//
//   TEMPLATE STATUS  Meta approves, rejects, pauses and disables templates on
//                    its own schedule. The webhook tells us when it happens
//                    while we are listening; this is how we find out about
//                    everything that happened while we were not.
//   ACCOUNT FACTS    quality rating, messaging tier, display name and
//                    verification state. §33: only what Meta supplies, never
//                    a plausible-looking default.
//
// Callable by an admin, and by the worker on a tick. Read-only against Meta:
// it sends nothing and creates nothing there.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { notify } from '../_shared/notify.ts';
import { requireAdmin, isInternalWorker, serviceClient, json, preflight, logEvent } from '../_shared/comm/auth.ts';
import {
  createMetaProvider, metaConfigFromEnv, metaCredentialsPresent, type RemoteTemplate,
} from '../_shared/comm/meta.ts';

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // §140: admin OR internal worker. Not a customer endpoint — a customer's
  // view of their templates comes from the database, not from Meta directly.
  const admin = await requireAdmin(req);
  const worker = isInternalWorker(req);
  if (!admin && !worker) return json({ error: 'forbidden' }, 403);

  if (!metaCredentialsPresent().ok) return json({ error: 'not_configured' }, 503);

  const sb = admin?.sb ?? serviceClient();
  const provider = createMetaProvider(metaConfigFromEnv());

  // ── The account ──────────────────────────────────────────────────────────
  const account = await provider.describeAccount();
  let accountRow: { id: string; owner_id: string | null } | null = null;

  if (account.ok && account.data) {
    const { data } = await sb.from('comm_channel_accounts')
      .select('id, owner_id')
      .eq('provider', 'META')
      .eq('provider_number_id', account.data.providerNumberId ?? '')
      .maybeSingle();

    // The platform-owned row seeded by the migration, matched by provider
    // rather than by a number it did not yet know.
    const { data: seeded } = data ? { data: null } : await sb.from('comm_channel_accounts')
      .select('id, owner_id').eq('provider', 'META').is('owner_id', null).maybeSingle();

    accountRow = data ?? seeded ?? null;

    if (accountRow) {
      await sb.from('comm_channel_accounts').update({
        phone_e164: account.data.phoneE164,
        display_name: account.data.displayName,
        quality_rating: account.data.qualityRating,
        messaging_tier: account.data.messagingTier,
        verification_state: account.data.verificationState,
        provider_number_id: account.data.providerNumberId,
        provider_account_id: account.data.providerAccountId,
        status: 'CONNECTED',
        last_error: null,
      }).eq('id', accountRow.id);
    }
  } else {
    await sb.from('comm_channel_accounts')
      .update({ status: 'ACTION_REQUIRED', last_error: account.error?.code ?? 'UNKNOWN' })
      .eq('provider', 'META').is('owner_id', null);
  }

  // ── Templates ────────────────────────────────────────────────────────────
  const remote = await provider.listTemplates();
  if (!remote.ok) {
    return json({
      ok: false,
      account: account.ok,
      error: remote.error?.code ?? 'UNKNOWN',
    }, 502);
  }

  const templates = remote.data ?? [];
  let updated = 0;
  let created = 0;
  const newlyRejected: RemoteTemplate[] = [];

  for (const t of templates) {
    const { data: existing } = await sb.from('comm_whatsapp_templates')
      .select('id, owner_id, status')
      .eq('name', t.name).eq('language', t.language)
      .maybeSingle();

    const patch = {
      category: normaliseCategory(t.category),
      header_kind: t.headerKind ?? 'NONE',
      header_text: t.headerText,
      body_text: t.bodyText ?? '',
      footer_text: t.footerText,
      buttons: t.buttons,
      status: normaliseStatus(t.status),
      provider_template_id: t.providerTemplateId,
      rejection_reason: t.rejectionReason,
      last_synced_at: new Date().toISOString(),
      channel_account_id: accountRow?.id ?? null,
    };

    if (existing) {
      if (existing.status !== 'REJECTED' && patch.status === 'REJECTED') newlyRejected.push(t);
      await sb.from('comm_whatsapp_templates').update(patch).eq('id', existing.id);
      updated++;
    } else if (accountRow?.owner_id) {
      // A template that exists at Meta but not here belongs to whoever owns
      // the number. When the number is platform-owned there is no customer to
      // attach it to, and inventing one would put a stranger's template on
      // someone's account.
      await sb.from('comm_whatsapp_templates').insert({
        ...patch, owner_id: accountRow.owner_id, name: t.name, language: t.language,
      });
      created++;
    }
  }

  for (const t of newlyRejected) {
    const { data: row } = await sb.from('comm_whatsapp_templates')
      .select('owner_id, name').eq('name', t.name).eq('language', t.language).maybeSingle();
    if (row?.owner_id) {
      await notify(sb, {
        userId: row.owner_id,
        type: 'WHATSAPP_TEMPLATE_REJECTED',
        title: 'A WhatsApp template was rejected',
        body: `Meta rejected "${row.name}"${t.rejectionReason ? `: ${t.rejectionReason}` : '.'}`,
        priority: 'HIGH',
        deepLink: '/outreach/whatsapp/templates',
        entityType: 'template',
        dedupeKey: `template-rejected:${row.id}`,
      });
    }
  }

  logEvent('whatsapp-sync', 'synced', {
    templates: templates.length, updated, created, rejected: newlyRejected.length,
  });

  return json({
    ok: true,
    account: account.ok ? {
      connected: true,
      // Facts, exactly as Meta reported them. A null here means Meta said
      // nothing, and the UI shows nothing rather than a guess.
      displayName: account.data?.displayName ?? null,
      qualityRating: account.data?.qualityRating ?? null,
      messagingTier: account.data?.messagingTier ?? null,
      verificationState: account.data?.verificationState ?? null,
    } : { connected: false, error: account.error?.code ?? 'UNKNOWN' },
    templates: {
      total: templates.length,
      approved: templates.filter((t) => normaliseStatus(t.status) === 'APPROVED').length,
      updated,
      created,
      newlyRejected: newlyRejected.length,
    },
  });
});

function normaliseStatus(raw: string): string {
  const s = String(raw ?? '').toUpperCase();
  const known = ['DRAFT', 'SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED'];
  if (known.includes(s)) return s;
  // Meta also emits IN_APPEAL, PENDING_DELETION and DELETED. None of them
  // permits a send, and PENDING is the honest bucket for "not approved right
  // now" rather than inventing a state the column cannot hold.
  if (s === 'DELETED' || s === 'PENDING_DELETION') return 'DISABLED';
  return 'PENDING';
}

function normaliseCategory(raw: string): string {
  const s = String(raw ?? '').toUpperCase();
  return ['MARKETING', 'UTILITY', 'AUTHENTICATION'].includes(s) ? s : 'MARKETING';
}

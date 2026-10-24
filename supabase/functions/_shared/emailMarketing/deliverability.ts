// EMAIL STUDIO — deliverability check (email-marketing action deliverability_check).
//
// For each domain this account sends from (HOMATCH's shared sender domain, and the owner's own
// verified domains): the provider's record status as Resend reports it, and the public DNS as a
// receiving server reads it — envelope SPF, DKIM key, DMARC policy and reporting, alignment
// (src/emailMarketing/deliverability/dnsCheck.ts). Resolved over DNS-over-HTTPS. Results are
// stored per owner (email_deliverability_checks) so the panel can show "last checked". Nothing
// here changes DNS or provider settings; it reads and reports.

import { json, checkRateLimit, logEvent, redact } from '../comm/auth.ts';
import { listDomains, getDomain } from '../resend/client.ts';
import { type EmailSettings, marketingKey, type Owner } from './core.ts';
import { checkDomainAuth, type Resolve } from '../../../../src/emailMarketing/deliverability/dnsCheck.ts';

// deno-lint-ignore no-explicit-any
type Sb = any;
const TYPE = { TXT: 16, MX: 15, CNAME: 5 } as const;

/** DNS-over-HTTPS (Google), answers of the asked type only; null when the lookup itself failed. */
export const dohResolve: Resolve = async (name, type) => {
  try {
    const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const j = await res.json() as { Status?: number; Answer?: Array<{ type: number; data: string }> };
    if (j.Status !== 0 && j.Status !== 3) return null; /* 3 = NXDOMAIN: an answer, just empty */
    return (j.Answer ?? []).filter((a) => a.type === TYPE[type]).map((a) => a.data);
  } catch { return null; }
};

export async function deliverabilityCheck(sb: Sb, s: EmailSettings, owner: Owner, resolve: Resolve = dohResolve): Promise<Response> {
  const limit = await checkRateLimit(sb, 'email_deliverability_check', 30, 3600, { userId: owner.authId });
  if (!limit.allowed) return json({ ok: false, error: 'RATE_LIMITED' }, 429);
  const shared = s.defaultSender.split('@')[1]?.toLowerCase() ?? 'homatch.live';
  const { data: own } = await sb.from('email_sending_domains').select('domain, resend_domain_id, status').eq('owner_user_id', owner.userId).neq('status', 'DISCONNECTED');
  const domains = [{ domain: shared, shared: true, resendId: null as string | null }, ...((own ?? []) as Array<{ domain: string; resend_domain_id: string | null }>)
    .map((d) => ({ domain: d.domain.toLowerCase(), shared: false, resendId: d.resend_domain_id }))].slice(0, 6);

  const key = marketingKey(s).key;
  let provider: Array<{ id: string; name: string; status: string }> = [];
  if (key) {
    const l = await listDomains(key);
    provider = l.ok ? ((l.json?.data ?? []) as Array<{ id: string; name: string; status: string }>) : [];
  }
  const results = [];
  for (const d of domains) {
    const p = provider.find((x) => x.name.toLowerCase() === d.domain) ?? (d.resendId ? { id: d.resendId, name: d.domain, status: '' } : null);
    let records: Array<{ record: string; name: string; type: string; status?: string }> = [];
    let tracking: { open: boolean | null; click: boolean | null } = { open: null, click: null };
    let providerStatus: string | null = p?.status || null;
    if (key && p) {
      const g = await getDomain(key, p.id);
      if (g.ok && g.json) {
        const gj = g.json as unknown as Record<string, unknown>;
        providerStatus = String(gj.status ?? providerStatus ?? '') || null;
        records = ((gj.records ?? []) as typeof records).map((r) => ({ record: r.record, name: r.name, type: r.type, status: r.status }));
        tracking = {
          open: typeof gj.open_tracking === 'boolean' ? gj.open_tracking : null,
          click: typeof gj.click_tracking === 'boolean' ? gj.click_tracking : null,
        };
      }
    }
    /* The envelope label the provider assigned (Resend: "send" → send.<domain>). */
    const mxName = records.find((r) => r.type === 'MX')?.name ?? 'send';
    const label = mxName.replace(new RegExp(`\\.?${d.domain.replace(/\./g, '\\.')}$`), '') || 'send';
    const dns = await checkDomainAuth(d.domain, resolve, { returnPathLabel: label, dkimSelector: 'resend' });
    results.push({ domain: d.domain, shared: d.shared, providerStatus, records, tracking, dns });
  }
  const checkedAt = new Date().toISOString();
  const { error } = await sb.from('email_deliverability_checks').insert({ owner_id: owner.authId, result: { domains: results }, checked_at: checkedAt });
  if (error) logEvent('email-marketing', 'deliverability_check_store_failed', { error: redact(error.message) });
  return json({ ok: true, checkedAt, domains: results, providerKey: Boolean(key) });
}

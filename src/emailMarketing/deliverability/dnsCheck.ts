// EMAIL DELIVERABILITY — is a sending domain authenticated, from the public DNS as it is now?
//
// Pure logic with an injected resolver (the edge function resolves over DNS-over-HTTPS; tests use
// a table). Reads exactly what receivers read: the envelope (return-path) domain's SPF, the DKIM
// key at the provider's selector, the From domain's DMARC record, and the root SPF only to report
// duplicates and lookup pressure. Alignment is computed the DMARC way (relaxed: same organizational
// domain). A lookup that fails is UNKNOWN — never a pass.

import { orgDomain } from './headers.ts';

export type Resolve = (name: string, type: 'TXT' | 'MX' | 'CNAME') => Promise<string[] | null>;
export type CheckState = 'OK' | 'WARN' | 'BAD' | 'UNKNOWN';

export interface DomainAuthReport {
  domain: string;
  returnPath: string;
  spf: { state: CheckState; record: string | null; lookups: number | null; codes: string[] };
  dkim: { state: CheckState; selector: string; codes: string[] };
  dmarc: { state: CheckState; record: string | null; policy: string | null; rua: boolean; pct: number | null; codes: string[] };
  alignment: { state: CheckState; dkimAligned: boolean | null; spfAligned: boolean | null };
  rootSpf: { records: number; codes: string[] };
}

const unquote = (s: string) => s.replace(/^"|"$/g, '').replace(/"\s*"/g, '');
const tags = (rec: string) => Object.fromEntries(rec.split(';').map((p) => p.trim()).filter(Boolean).map((p) => {
  const i = p.indexOf('=');
  return i > 0 ? [p.slice(0, i).trim().toLowerCase(), p.slice(i + 1).trim()] : [p.toLowerCase(), ''];
}));

/** DNS-lookup mechanisms in one SPF record (shallow: includes are not expanded). */
export function spfLookups(rec: string): number {
  return rec.split(/\s+/).filter((t) => /^[+~?-]?(include:|a\b|a:|a\/|mx\b|mx:|mx\/|ptr|exists:|redirect=)/i.test(t)).length;
}

export async function checkDomainAuth(domain: string, resolve: Resolve, opts: { returnPathLabel?: string; dkimSelector?: string } = {}): Promise<DomainAuthReport> {
  const d = domain.toLowerCase();
  const returnPath = `${opts.returnPathLabel ?? 'send'}.${d}`;
  const selector = opts.dkimSelector ?? 'resend';
  const [rpTxt, dkimTxt, dmarcTxt, rootTxt] = await Promise.all([
    resolve(returnPath, 'TXT'), resolve(`${selector}._domainkey.${d}`, 'TXT'), resolve(`_dmarc.${d}`, 'TXT'), resolve(d, 'TXT'),
  ]);

  /* SPF of the envelope domain — what SPF is actually evaluated against. */
  const spfRecs = (rpTxt ?? []).map(unquote).filter((r) => /^v=spf1\b/i.test(r));
  const spf: DomainAuthReport['spf'] = { state: 'UNKNOWN', record: spfRecs[0] ?? null, lookups: spfRecs[0] ? spfLookups(spfRecs[0]) : null, codes: [] };
  if (rpTxt === null) spf.codes.push('SPF_LOOKUP_FAILED');
  else if (!spfRecs.length) { spf.state = 'BAD'; spf.codes.push('SPF_MISSING'); }
  else if (spfRecs.length > 1) { spf.state = 'BAD'; spf.codes.push('SPF_DUPLICATE'); }
  else {
    spf.state = 'OK';
    if (/\+all\b/i.test(spfRecs[0])) { spf.state = 'BAD'; spf.codes.push('SPF_PLUS_ALL'); }
    if ((spf.lookups ?? 0) > 8) { spf.state = 'WARN'; spf.codes.push('SPF_LOOKUPS_HIGH'); }
  }

  const dkimRec = (dkimTxt ?? []).map(unquote).find((r) => /\bp=/.test(r)) ?? null;
  const dkim: DomainAuthReport['dkim'] = { state: 'UNKNOWN', selector, codes: [] };
  if (dkimTxt === null) dkim.codes.push('DKIM_LOOKUP_FAILED');
  else if (!dkimRec) { dkim.state = 'BAD'; dkim.codes.push('DKIM_MISSING'); }
  else if (/\bp=\s*(;|$)/.test(dkimRec)) { dkim.state = 'BAD'; dkim.codes.push('DKIM_REVOKED'); }
  else dkim.state = 'OK';

  const dmarcRec = (dmarcTxt ?? []).map(unquote).find((r) => /^v=DMARC1/i.test(r)) ?? null;
  const t = dmarcRec ? tags(dmarcRec) : {};
  const dmarc: DomainAuthReport['dmarc'] = { state: 'UNKNOWN', record: dmarcRec, policy: t.p?.toLowerCase() ?? null, rua: Boolean(t.rua), pct: t.pct ? Number(t.pct) : null, codes: [] };
  if (dmarcTxt === null) dmarc.codes.push('DMARC_LOOKUP_FAILED');
  else if (!dmarcRec) { dmarc.state = 'BAD'; dmarc.codes.push('DMARC_MISSING'); }
  else {
    dmarc.state = 'OK';
    if (dmarc.policy === 'none') { dmarc.state = 'WARN'; dmarc.codes.push('DMARC_POLICY_NONE'); }
    if (!dmarc.rua) { if (dmarc.state === 'OK') dmarc.state = 'WARN'; dmarc.codes.push('DMARC_NO_REPORTS'); }
    if (t.adkim === 's' || t.aspf === 's') dmarc.codes.push('DMARC_STRICT_ALIGNMENT');
  }

  /* The provider signs with d=<domain> and uses <label>.<domain> as the envelope domain. */
  const dkimAligned = dkim.state === 'OK' ? true : dkim.state === 'BAD' ? false : null;
  const spfAligned = spf.state === 'OK' || spf.state === 'WARN' ? (t.aspf === 's' ? returnPath === d : orgDomain(returnPath) === orgDomain(d)) : spf.state === 'BAD' ? false : null;
  const alignment: DomainAuthReport['alignment'] = {
    dkimAligned, spfAligned,
    state: dkimAligned || spfAligned ? 'OK' : dkimAligned === false && spfAligned === false ? 'BAD' : 'UNKNOWN',
  };

  const rootSpfs = (rootTxt ?? []).map(unquote).filter((r) => /^v=spf1\b/i.test(r));
  const rootSpf = { records: rootSpfs.length, codes: rootSpfs.length > 1 ? ['ROOT_SPF_DUPLICATE'] : [] as string[] };
  return { domain: d, returnPath, spf, dkim, dmarc, alignment, rootSpf };
}

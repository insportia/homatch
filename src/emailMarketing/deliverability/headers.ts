// EMAIL DELIVERABILITY — read the headers of a message as the RECEIVING server saw it.
//
// The only first-hand evidence of why a message went to Spam is the copy the mailbox holds:
// Gmail "Show original", Outlook "View message source", Yahoo "View raw message". The owner
// pastes those headers; this file reads them — locally, nothing is sent anywhere — and reports
// what the receiver concluded: SPF, DKIM (per signing domain), DMARC and its alignment, Microsoft's
// composite authentication and spam-confidence level, TLS on the last hop, and whether the
// one-click unsubscribe headers arrived. Every finding names the header it came from; a header
// that is absent is reported as unknown, never as a pass.

export type AuthResult = 'pass' | 'fail' | 'softfail' | 'neutral' | 'none' | 'temperror' | 'permerror' | 'policy' | 'unknown';

export interface HeaderReport {
  fromDomain: string | null;
  returnPathDomain: string | null;
  spf: { result: AuthResult; domain: string | null };
  dkim: Array<{ result: AuthResult; domain: string | null; selector: string | null }>;
  dmarc: { result: AuthResult; policy: string | null; headerFrom: string | null };
  /** Microsoft: compauth=pass|fail|softpass|none with a reason code. */
  compauth: { result: string; reason: string | null } | null;
  /** Microsoft spam confidence level (-1…9; ≥5 is junk). */
  scl: number | null;
  /** Explicit spam verdict headers some receivers add (X-Spam-Flag, X-Spam-Status). */
  spamFlag: boolean | null;
  tls: boolean | null;
  listUnsubscribe: boolean;
  listUnsubscribePost: boolean;
  messageId: string | null;
  receivedBy: string | null;
  findings: Array<{ code: string; severity: 'ok' | 'info' | 'warn' | 'bad'; detail?: string }>;
}

/** Unfold RFC 5322 continuation lines and split into [name, value] pairs, in order. */
export function parseHeaders(raw: string): Array<[string, string]> {
  const text = String(raw ?? '').replace(/\r\n/g, '\n');
  const head = text.split(/\n\s*\n/)[0];
  const out: Array<[string, string]> = [];
  for (const line of head.split('\n')) {
    if (/^[ \t]/.test(line) && out.length) out[out.length - 1][1] += ` ${line.trim()}`;
    else {
      const i = line.indexOf(':');
      if (i > 0) out.push([line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim()]);
    }
  }
  return out;
}

const domainOf = (v: string | null | undefined): string | null => {
  const m = /@([a-z0-9.-]+\.[a-z]{2,})/i.exec(String(v ?? ''));
  return m ? m[1].toLowerCase().replace(/\.$/, '') : null;
};
const asResult = (v: string | undefined): AuthResult => {
  const s = String(v ?? '').toLowerCase();
  return (['pass', 'fail', 'softfail', 'neutral', 'none', 'temperror', 'permerror', 'policy'] as AuthResult[]).includes(s as AuthResult) ? s as AuthResult : 'unknown';
};
/** Organizational domain, enough for alignment checks (no public-suffix list: two labels, three for known 2-level TLDs). */
export function orgDomain(d: string | null): string | null {
  if (!d) return null;
  const p = d.toLowerCase().split('.');
  const twoLevel = /^(co|com|org|net|gov|edu|ac)\.[a-z]{2}$/.test(p.slice(-2).join('.'));
  return p.slice(twoLevel ? -3 : -2).join('.');
}
export const aligned = (a: string | null, b: string | null) => Boolean(a && b && orgDomain(a) === orgDomain(b));

export function analyzeHeaders(raw: string): HeaderReport {
  const h = parseHeaders(raw);
  const get = (n: string) => h.filter(([k]) => k === n).map(([, v]) => v);
  const first = (n: string) => get(n)[0] ?? null;

  const fromDomain = domainOf(first('from'));
  const returnPathDomain = domainOf(first('return-path'));
  /* The topmost Authentication-Results is the receiver's own; lower ones may be forged by senders. */
  const ar = (get('authentication-results')[0] ?? get('arc-authentication-results')[0] ?? '').replace(/\s+/g, ' ');
  /* The spf= clause runs to the next ";" — its envelope sender is read inside that clause only. */
  const spfClause = /\bspf=([a-z]+)([^;]*)/i.exec(ar);
  const spfM = spfClause ? [spfClause[0], spfClause[1], /smtp\.mailfrom=([^\s;]+)/i.exec(spfClause[2])?.[1]] as const : null;
  const dkimAll = [...ar.matchAll(/\bdkim=([a-z]+)([^;]*)/gi)].map((m) => ({
    result: asResult(m[1]),
    domain: (/header\.(?:d|i)=@?([^\s;]+)/i.exec(m[2])?.[1] ?? null)?.toLowerCase().replace(/^@/, '') ?? null,
    selector: /header\.s=([^\s;]+)/i.exec(m[2])?.[1] ?? null,
  }));
  const dmarcM = /\bdmarc=([a-z]+)([^;]*)/i.exec(ar);
  const dmarcPolicy = dmarcM ? /\(p=([a-z]+)/i.exec(dmarcM[2])?.[1] ?? /\bp=([a-z]+)/i.exec(dmarcM[2])?.[1] ?? null : null;
  const dmarcFrom = dmarcM ? /header\.from=([^\s;]+)/i.exec(dmarcM[2])?.[1] ?? null : null;
  const compM = /\bcompauth=([a-z]+)(?:\s+reason=([0-9a-z]+))?/i.exec(ar);
  const sclV = first('x-ms-exchange-organization-scl') ?? /\bSCL:(-?\d)/.exec(first('x-forefront-antispam-report') ?? '')?.[1] ?? null;
  const spamFlagV = first('x-spam-flag');
  const spamStatus = first('x-spam-status');
  const received = get('received');
  /* The hop where the receiver accepted the message from the sender: the first Received with a
     "from" clause (Gmail and Outlook put internal hops above it). */
  const lastHop = received.find((r) => /^from\s/i.test(r)) ?? received[0] ?? '';
  const tls = received.length ? /\b(TLS|ESMTPS|version=TLS)/i.test(lastHop) : null;

  const report: HeaderReport = {
    fromDomain, returnPathDomain,
    spf: { result: spfM ? asResult(spfM[1]) : 'unknown', domain: spfM?.[2] ? domainOf(`x@${spfM[2].replace(/^.*@/, '')}`) ?? spfM[2].toLowerCase() : returnPathDomain },
    dkim: dkimAll,
    dmarc: { result: dmarcM ? asResult(dmarcM[1]) : 'unknown', policy: dmarcPolicy ? dmarcPolicy.toLowerCase() : null, headerFrom: dmarcFrom?.toLowerCase() ?? null },
    compauth: compM ? { result: compM[1].toLowerCase(), reason: compM[2] ?? null } : null,
    scl: sclV != null && /^-?\d$/.test(String(sclV).trim()) ? Number(String(sclV).trim()) : null,
    spamFlag: spamFlagV ? /^yes/i.test(spamFlagV) : spamStatus ? /^yes/i.test(spamStatus) : null,
    tls,
    listUnsubscribe: get('list-unsubscribe').length > 0,
    listUnsubscribePost: get('list-unsubscribe-post').some((v) => /List-Unsubscribe=One-Click/i.test(v)),
    messageId: first('message-id'),
    receivedBy: /\bby\s+([^\s;]+)/i.exec(lastHop)?.[1] ?? null,
    findings: [],
  };

  const f = report.findings;
  if (!ar) f.push({ code: 'NO_AUTH_RESULTS', severity: 'warn' });
  else {
    f.push({ code: report.spf.result === 'pass' ? 'SPF_PASS' : `SPF_${report.spf.result.toUpperCase()}`, severity: report.spf.result === 'pass' ? 'ok' : 'bad', detail: report.spf.domain ?? undefined });
    const alignedDkim = report.dkim.filter((d) => d.result === 'pass' && aligned(d.domain, fromDomain));
    if (!report.dkim.length) f.push({ code: 'DKIM_MISSING', severity: 'bad' });
    else if (alignedDkim.length) f.push({ code: 'DKIM_ALIGNED_PASS', severity: 'ok', detail: alignedDkim.map((d) => d.domain).join(', ') });
    else if (report.dkim.some((d) => d.result === 'pass')) f.push({ code: 'DKIM_PASS_NOT_ALIGNED', severity: 'warn', detail: report.dkim.map((d) => d.domain).join(', ') });
    else f.push({ code: 'DKIM_FAIL', severity: 'bad', detail: report.dkim.map((d) => `${d.domain ?? '?'}=${d.result}`).join(', ') });
    if (report.dmarc.result === 'pass') f.push({ code: 'DMARC_PASS', severity: 'ok', detail: report.dmarc.policy ?? undefined });
    else if (report.dmarc.result === 'unknown') f.push({ code: 'DMARC_NOT_EVALUATED', severity: 'warn' });
    else f.push({ code: 'DMARC_FAIL', severity: 'bad', detail: report.dmarc.result });
    if (report.dmarc.policy === 'none') f.push({ code: 'DMARC_POLICY_NONE', severity: 'info' });
    if (report.spf.result === 'pass' && report.spf.domain && fromDomain && !aligned(report.spf.domain, fromDomain)) f.push({ code: 'SPF_NOT_ALIGNED', severity: 'info', detail: `${report.spf.domain} ≠ ${fromDomain}` });
  }
  if (report.compauth && report.compauth.result !== 'pass') f.push({ code: 'MS_COMPAUTH_FAIL', severity: 'bad', detail: `${report.compauth.result}${report.compauth.reason ? ` (${report.compauth.reason})` : ''}` });
  if (report.scl != null) f.push({ code: report.scl >= 5 ? 'MS_SCL_JUNK' : 'MS_SCL_OK', severity: report.scl >= 5 ? 'bad' : 'ok', detail: String(report.scl) });
  if (report.spamFlag) f.push({ code: 'SPAM_FLAG_SET', severity: 'bad' });
  if (report.tls === false) f.push({ code: 'NO_TLS_LAST_HOP', severity: 'warn' });
  if (!report.listUnsubscribe) f.push({ code: 'NO_LIST_UNSUBSCRIBE', severity: 'info' });
  else if (!report.listUnsubscribePost) f.push({ code: 'NO_ONE_CLICK', severity: 'warn' });
  return report;
}

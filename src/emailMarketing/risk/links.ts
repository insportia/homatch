// CAMPAIGN RISK ENGINE — links (pure; the network half is _shared/emailMarketing/linkInspector.ts).
//
// Owner brief §8–§9: never trust a URL by its visible text; detect shorteners, misleading
// redirects and destination mismatches; refuse unsafe schemes and internal networks; and keep
// gambling destinations out of HOMATCH email, directly or through a redirect. Everything here is
// deterministic and runs in both the browser (live hints in the designer) and the edge (the
// verdict that counts). The edge additionally follows each link's redirects and runs every hop
// and the final destination through checkUrl().

export type Severity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCK';

export interface Finding {
  code: string;
  severity: Severity;
  /** Where it was found: a URL, 'subject', 'body', 'sender', 'audience', 'account'. */
  where?: string;
  detail?: string;
}

export interface ExtractedLink {
  url: string;
  kind: 'a' | 'img';
  /** Visible text of an <a>, tags stripped. */
  text?: string;
}

const decodeEntities = (s: string) => s
  .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&nbsp;/gi, ' ');

/** Every href of an <a> (with its visible text) and every src of an <img>. */
export function extractLinks(html: string): ExtractedLink[] {
  const out: ExtractedLink[] = [];
  const src = String(html ?? '');
  for (const m of src.matchAll(/<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
    out.push({ url: decodeEntities(m[2].trim()), kind: 'a', text: decodeEntities(m[3].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim() });
  }
  for (const m of src.matchAll(/<img\b[^>]*?\bsrc\s*=\s*(["'])(.*?)\1/gi)) {
    out.push({ url: decodeEntities(m[2].trim()), kind: 'img' });
  }
  return out;
}

/** Merge-field placeholders the sender fills per recipient: not a link to inspect. */
export const isPlaceholderUrl = (u: string) => /^\{\{\s*[a-z_]+\s*\}\}$/i.test(u.trim());

const SHORTENERS = new Set([
  'bit.ly', 'bitly.com', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'cutt.ly', 'rebrand.ly',
  'shorturl.at', 'tiny.cc', 'rb.gy', 'v.gd', 't.ly', 'lnkd.in', 'surl.li', 'clck.ru', 'qr.ae', 'bl.ink', 'short.io',
  's.id', 'trib.al', 'dlvr.it', 'shorte.st', 'adf.ly', 'linktr.ee',
]);

/* Gambling operators and their usual markers. Registrable-label matching, so "alphabet.com" or
   "betterhomes.ge" do not trip it; dedicated gambling TLDs count by themselves. */
const GAMBLING_BRANDS = [
  'bet365', '1xbet', 'melbet', 'mostbet', 'parimatch', 'pinup', 'pin-up', 'joycasino', 'vulkan', 'ggbet', 'betway',
  'williamhill', 'pokerstars', 'stake', 'roobet', 'betsson', 'unibet', 'bwin', '888casino', '22bet', 'linebet',
  'betwinner', 'fonbet', 'leonbets', 'winline', 'ligastavok', 'adjarabet', 'crystalbet', 'europebet', 'betlive',
  'leaderbet', 'lider-bet', 'betfair', 'betano', 'betcity', 'olimpbet', 'marathonbet', 'casinox', 'azino', 'riobet',
];
const GAMBLING_TLDS = new Set(['bet', 'casino', 'poker', 'games', 'lotto', 'bingo']);
const GAMBLING_LABEL = /(^|[-.])(casino|casinos|kazino|poker|slots?|roulette|bookmaker|betting|sportsbook|jackpot|blackjack)([-.]|\d|$)|(^|[-.])bet(s|ting)?([-.]|\d|$)|\dbet|bet\d/;
const GAMBLING_PATH = /\/(casino|slots?|poker|betting|sportsbook|bonus-?casino|free-?spins?)(\/|\?|$)/i;

export function isGamblingHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  const labels = h.split('.');
  const tld = labels[labels.length - 1];
  if (GAMBLING_TLDS.has(tld)) return true;
  if (GAMBLING_BRANDS.some((b) => labels.some((l) => l === b || l.startsWith(`${b}-`) || l.replace(/\d+$/, '') === b))) return true;
  /* The registrable part and subdomains, without the TLD. */
  return GAMBLING_LABEL.test(labels.slice(0, -1).join('.'));
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** RFC1918, loopback, link-local, CGNAT, multicast, 0/8, and the IPv6 equivalents. */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, '');
  const m = IPV4.exec(v);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (v.includes(':')) {
    if (v === '::' || v === '::1') return true;
    if (v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb')) return true;
    const mapped = /::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isPrivateAddress(mapped[1]);
    return v.startsWith('ff');
  }
  return false;
}

const isIpLiteral = (host: string) => IPV4.test(host) || host.startsWith('[') || /^[0-9a-f:]+$/i.test(host) && host.includes(':');
const INTERNAL_SUFFIXES = ['localhost', '.local', '.internal', '.intranet', '.lan', '.home.arpa', '.corp', '.localdomain'];

/** A bare domain written as link text ("www.bank.ge", "https://homatch.live/x"), if any. */
function domainInText(text: string | undefined): string | null {
  if (!text) return null;
  const m = /(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[/\s]|$)/i.exec(text.trim());
  return m ? m[1].toLowerCase().replace(/^www\./, '') : null;
}

const registrable = (host: string) => host.toLowerCase().replace(/^www\./, '').split('.').slice(-2).join('.');

/**
 * Static checks of one URL. `text` is the visible link text when the URL came from an <a>.
 * Returns findings only; an empty list means nothing was wrong with what can be seen offline.
 */
export function checkUrl(raw: string, opts: { text?: string; kind?: 'a' | 'img'; hop?: number } = {}): Finding[] {
  const where = raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
  const f: Finding[] = [];
  const add = (code: string, severity: Severity, detail?: string) => f.push({ code, severity, where, detail });
  const s = raw.trim();
  if (!s) return [{ code: 'LINK_EMPTY', severity: 'MEDIUM', where: '(empty)' }];
  if (isPlaceholderUrl(s)) return [];
  if (/^mailto:/i.test(s)) {
    if (!/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+/i.test(s)) add('LINK_MAILTO_INVALID', 'MEDIUM');
    return f;
  }
  if (/^tel:/i.test(s)) return /^tel:\+?[0-9 ()-]{5,20}$/i.test(s) ? f : [{ code: 'LINK_TEL_INVALID', severity: 'LOW', where }];
  if (/^(javascript|data|vbscript|file|blob):/i.test(s)) { add('LINK_UNSAFE_SCHEME', 'BLOCK', s.split(':')[0]); return f; }
  let u: URL;
  try { u = new URL(s); } catch { add('LINK_MALFORMED', 'HIGH'); return f; }
  if (u.protocol === 'http:') add('LINK_NOT_HTTPS', 'MEDIUM');
  else if (u.protocol !== 'https:') { add('LINK_UNSAFE_SCHEME', 'BLOCK', u.protocol); return f; }
  if (u.username || u.password) add('LINK_EMBEDDED_CREDENTIALS', 'BLOCK');
  const host = u.hostname.toLowerCase();
  if (isIpLiteral(host)) add(isPrivateAddress(host) ? 'LINK_PRIVATE_NETWORK' : 'LINK_IP_ADDRESS', isPrivateAddress(host) ? 'BLOCK' : 'HIGH', host);
  else if (INTERNAL_SUFFIXES.some((x) => host === x.replace(/^\./, '') || host.endsWith(x))) add('LINK_PRIVATE_NETWORK', 'BLOCK', host);
  if (u.port && !['80', '443'].includes(u.port)) add('LINK_UNUSUAL_PORT', 'MEDIUM', u.port);
  if (host.split('.').some((l) => l.startsWith('xn--'))) add('LINK_PUNYCODE', 'HIGH', host);
  if (SHORTENERS.has(host.replace(/^www\./, ''))) add('LINK_SHORTENER', 'HIGH', host);
  if (isGamblingHost(host) || GAMBLING_PATH.test(u.pathname)) add(opts.hop ? 'REDIRECT_TO_GAMBLING' : 'LINK_GAMBLING', 'BLOCK', host);
  if (s.length > 2000) add('LINK_TOO_LONG', 'MEDIUM');
  /* Open-redirect parameters pointing elsewhere: the visible host is not the destination. */
  for (const [k, v] of u.searchParams) {
    if (/^(url|u|redirect|redirect_uri|next|target|dest|destination|goto|out|link|r)$/i.test(k) && /^https?:\/\//i.test(v)) {
      try {
        const inner = new URL(v);
        if (registrable(inner.hostname) !== registrable(host)) add('LINK_EMBEDDED_REDIRECT', 'HIGH', inner.hostname);
        if (isGamblingHost(inner.hostname)) add('REDIRECT_TO_GAMBLING', 'BLOCK', inner.hostname);
      } catch { /* not a URL */ }
    }
  }
  const shown = opts.kind === 'a' ? domainInText(opts.text) : null;
  if (shown && registrable(shown) !== registrable(host)) add('LINK_TEXT_MISMATCH', 'HIGH', `${shown} → ${host}`);
  return f;
}

/** A redirect hop that leaves the registrable domain of the link the reader saw. */
export function crossDomainRedirect(from: string, to: string): boolean {
  try { return registrable(new URL(from).hostname) !== registrable(new URL(to).hostname); } catch { return true; }
}

/** UTM parameters added to a link, never overwriting ones the sender set. */
export function withUtm(url: string, utm: { source?: string; medium?: string; campaign?: string }): string {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return url;
    if (utm.source && !u.searchParams.has('utm_source')) u.searchParams.set('utm_source', utm.source);
    if (utm.medium && !u.searchParams.has('utm_medium')) u.searchParams.set('utm_medium', utm.medium);
    if (utm.campaign && !u.searchParams.has('utm_campaign')) u.searchParams.set('utm_campaign', utm.campaign);
    return u.toString();
  } catch { return url; }
}

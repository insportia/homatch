// CAMPAIGN RISK ENGINE — the verdict (pure, shared by the Email Studio UI and the edge).
//
// Owner brief §9–§10. Layers, cheapest first, all deterministic:
//   1. links          static URL checks + (on the edge) every redirect hop and final destination
//   2. content        the Communications domain classifier (real-estate boundary, prohibited
//                     categories in six languages) + email-specific phishing, credential,
//                     misleading-claim and spam patterns
//   3. sender         verified domain, display-name impersonation
//   4. audience       provenance and consent share
//   5. account        history: prior blocks, complaint and bounce rates, sending velocity
// An optional model classification may add a finding for genuinely ambiguous text; it can never
// clear a finding and is never the only enforcement (§9: "HOMI … must never be the sole
// security enforcement mechanism").
//
// GAMBLING, PRECISELY. A gambling destination (link, image or any redirect hop) is BLOCK. A
// gambling word in the copy with promotional markers ("bonus", "free spins", "deposit", "odds",
// "bet now") is BLOCK. A gambling word alone — "the former casino building on the boulevard is
// now 40 apartments" — is held for a human (REVIEW), not rejected (§9: "avoid automatically
// rejecting legitimate content merely because it discusses gambling in an unrelated context").

import { classifyDomain, foldForMatching } from '../../lib/comm/domainClassifier.ts';
import { checkUrl, extractLinks, type Finding, type Severity } from './links.ts';

export type { Finding, Severity } from './links.ts';
export type RiskVerdict = 'ALLOW' | 'REVIEW' | 'BLOCK';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED';

/** What the edge learned by following one link (see linkInspector.ts). */
export interface LinkInspection {
  url: string;
  ok: boolean;
  status?: number;
  finalUrl?: string;
  chain?: string[];
  error?: string;
  findings: Finding[];
}

export interface RiskInput {
  subject: string;
  previewText?: string | null;
  html: string;
  text?: string | null;
  senderName?: string | null;
  senderEmail?: string | null;
  /** The sender address is on a domain this owner verified (or HOMATCH's own). */
  senderVerified: boolean;
  audience?: { total: number; consented: number; unknownSource?: number; purchased?: number } | null;
  account?: { ageDays?: number; priorBlocked?: number; complaintRate?: number; bounceRate?: number; sentLast24h?: number; dailyCap?: number } | null;
  /** Network results from the edge. Absent in the browser: static checks only. */
  links?: LinkInspection[] | null;
  hasPropertyContext?: boolean;
}

export interface RiskResult {
  verdict: RiskVerdict;
  level: RiskLevel;
  score: number;
  findings: Finding[];
  /** Ambiguous enough that a model opinion is worth asking (never decisive on its own). */
  needsModel: boolean;
}

const WEIGHT: Record<Severity, number> = { INFO: 0, LOW: 5, MEDIUM: 15, HIGH: 35, BLOCK: 100 };

type Pattern = [code: string, severity: Severity, words: string[]];

/* Phrases are matched on folded text (lowercase, homoglyph-folded), in the six languages. */
const PATTERNS: Pattern[] = [
  ['PHISHING_CREDENTIALS', 'BLOCK', ['verify your password', 'confirm your password', 'enter your password', 'update your payment details',
    'confirm your card', 'card number and cvv', 'cvv code', 'seed phrase', 'recovery phrase', 'login to avoid suspension',
    'your account will be suspended', 'account has been locked', 'პაროლის დადასტურება', 'ბარათის ნომერი და cvv',
    'подтвердите пароль', 'введите пароль', 'данные карты', 'şifrenizi doğrulayın', 'kart bilgilerinizi', 'أكد كلمة المرور', 'אשר את הסיסמה']],
  ['IMPERSONATION_AUTHORITY', 'HIGH', ['revenue service notice', 'police notice', 'court summons', 'tax refund pending',
    'შემოსავლების სამსახურის შეტყობინება', 'налоговая служба уведомляет', 'vergi iadesi']],
  ['MISLEADING_FINANCIAL_CLAIM', 'HIGH', ['guaranteed return', 'guaranteed profit', 'risk-free investment', 'risk free investment',
    'double your money', '100% profit', 'no risk', 'guaranteed income', 'გარანტირებული მოგება', 'გარანტირებული შემოსავალი',
    'რისკის გარეშე', 'гарантированный доход', 'гарантированная прибыль', 'без риска', 'garantili kazanç', 'risksiz yatırım',
    'ربح مضمون', 'רווח מובטח']],
  ['SPAM_PRESSURE', 'MEDIUM', ['act now', 'limited time only', 'only today', 'last chance', 'click here now', 'urgent response needed',
    'free money', 'you have been selected', 'congratulations you', 'ბოლო შანსი', 'მხოლოდ დღეს', 'последний шанс', 'только сегодня',
    'son şans', 'sadece bugün']],
];

const GAMBLING_WORDS = ['casino', 'gambling', 'betting', 'bet365', 'roulette', 'slots', 'poker', 'bookmaker', 'jackpot',
  'კაზინო', 'აზარტული', 'ფსონ', 'казино', 'ставки', 'букмекер', 'kumar', 'bahis', 'قمار', 'קזינו'];
const GAMBLING_PROMO = ['bonus', 'free spins', 'free spin', 'deposit', 'odds', 'bet now', 'place your bet', 'wager', 'promo code',
  'ბონუსი', 'ფრისპინ', 'დეპოზიტ', 'бонус', 'фриспин', 'депозит', 'коэффициент', 'сделай ставку', 'bedava dönüş', 'yatırım bonusu',
  'مكافأة', 'בונוס'];

/* Brands a display name must not claim unless the address is on a domain the owner verified. */
const IMPERSONATED = ['homatch', 'bank of georgia', 'tbc bank', 'liberty bank', 'revenue service', 'paypal', 'google', 'apple',
  'microsoft', 'facebook', 'meta', 'instagram', 'amazon', 'netflix', 'visa', 'mastercard', 'binance', 'dhl', 'fedex',
  'საქართველოს ბანკი', 'თიბისი', 'შემოსავლების სამსახური'];

const has = (folded: string, words: string[]) => words.find((w) => folded.includes(foldForMatching(w)));

function capsRatio(s: string): number {
  const letters = s.replace(/[^A-Za-zА-Яа-я]/g, '');
  if (letters.length < 8) return 0;
  return letters.replace(/[^A-ZА-Я]/g, '').length / letters.length;
}

const htmlToText = (html: string) => html
  .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

export function assessCampaign(input: RiskInput): RiskResult {
  const findings: Finding[] = [];
  const push = (f: Finding) => { if (!findings.some((x) => x.code === f.code && x.where === f.where)) findings.push(f); };

  /* 1. Links — static, then the edge's network results (redirect hops, final destination). */
  const links = extractLinks(input.html);
  for (const l of links) for (const f of checkUrl(l.url, { text: l.text, kind: l.kind })) push(f);
  for (const r of input.links ?? []) {
    for (const f of r.findings) push(f);
    if (!r.ok) push({ code: 'LINK_UNREACHABLE', severity: 'MEDIUM', where: r.url, detail: r.error ?? String(r.status ?? '') });
  }
  if (/<script\b|<[^>]*\son[a-z]+\s*=|<iframe\b|<object\b|<embed\b|<form\b|<meta\b[^>]*http-equiv/i.test(input.html)) {
    push({ code: 'HTML_ACTIVE_CONTENT', severity: 'BLOCK', where: 'body' });
  }

  /* 2. Content. */
  const bodyText = [input.text ?? '', htmlToText(input.html)].join(' ');
  const all = [input.subject, input.previewText ?? '', bodyText].join(' \n ');
  const folded = foldForMatching(all);
  for (const [code, severity, words] of PATTERNS) {
    const hit = has(folded, words);
    if (hit) push({ code, severity, where: 'body', detail: hit });
  }
  const gamblingWord = has(folded, GAMBLING_WORDS);
  if (gamblingWord) {
    const promo = has(folded, GAMBLING_PROMO);
    push(promo
      ? { code: 'GAMBLING_PROMOTION', severity: 'BLOCK', where: 'body', detail: `${gamblingWord} + ${promo}` }
      : { code: 'GAMBLING_MENTION', severity: 'HIGH', where: 'body', detail: gamblingWord });
  }
  const domain = classifyDomain({ text: all, hasPropertyContext: input.hasPropertyContext ?? false, campaignType: 'EMAIL' });
  for (const sig of domain.signals) {
    if (!sig.code.startsWith('PROHIBITED_') || sig.code === 'PROHIBITED_GAMBLING') continue; /* gambling handled precisely above */
    const cat = sig.code.slice('PROHIBITED_'.length);
    if (['ADULT', 'SCAM', 'PHARMA', 'CRYPTO_PROMO'].includes(cat)) push({ code: sig.code, severity: 'BLOCK', where: 'body', detail: sig.detail });
    else push({ code: `RESTRICTED_${cat}`, severity: 'HIGH', where: 'body', detail: sig.detail });
  }
  if (domain.verdict !== 'ALLOW' && !findings.some((f) => f.severity === 'BLOCK' || f.code.startsWith('GAMBLING_'))) {
    push({ code: 'OFF_DOMAIN', severity: 'MEDIUM', where: 'body', detail: 'not clearly real estate' });
  }
  const placeholders = [...all.matchAll(/\[([^\]\n]{2,60})\](?!\()/g)].map((m) => m[1]);
  if (placeholders.length) push({ code: 'TEMPLATE_PLACEHOLDER', severity: 'HIGH', where: 'body', detail: [...new Set(placeholders)].slice(0, 4).join(', ') });
  if (capsRatio(input.subject) > 0.6) push({ code: 'SUBJECT_ALL_CAPS', severity: 'LOW', where: 'subject' });
  if (/[!?]{3,}/.test(input.subject)) push({ code: 'SUBJECT_PUNCTUATION', severity: 'LOW', where: 'subject' });
  if (!input.subject.trim()) push({ code: 'SUBJECT_MISSING', severity: 'HIGH', where: 'subject' });
  if (bodyText.length < 20 && links.length > 0) push({ code: 'BODY_LINK_ONLY', severity: 'MEDIUM', where: 'body' });

  /* 3. Sender. */
  if (!input.senderVerified) push({ code: 'SENDER_UNVERIFIED', severity: 'BLOCK', where: 'sender', detail: input.senderEmail ?? '' });
  const display = foldForMatching(input.senderName ?? '');
  const claimed = IMPERSONATED.find((b) => display.includes(foldForMatching(b)));
  if (claimed && !(claimed === 'homatch' && /@([a-z0-9-]+\.)*homatch\.live$/i.test(input.senderEmail ?? ''))) {
    push({ code: 'SENDER_IMPERSONATION', severity: 'HIGH', where: 'sender', detail: claimed });
  }

  /* 4. Audience. */
  const a = input.audience;
  if (a) {
    if (a.total === 0) push({ code: 'AUDIENCE_EMPTY', severity: 'HIGH', where: 'audience' });
    else {
      const consentShare = a.consented / a.total;
      if (consentShare < 1) push({ code: 'AUDIENCE_UNCONSENTED_EXCLUDED', severity: 'INFO', where: 'audience', detail: `${a.total - a.consented}` });
      if (a.consented === 0) push({ code: 'AUDIENCE_NO_CONSENT', severity: 'HIGH', where: 'audience' });
      if ((a.unknownSource ?? 0) / a.total > 0.5) push({ code: 'AUDIENCE_PROVENANCE_UNKNOWN', severity: 'MEDIUM', where: 'audience' });
    }
  }

  /* 5. Account history and velocity. */
  const h = input.account;
  if (h) {
    if ((h.priorBlocked ?? 0) >= 2) push({ code: 'ACCOUNT_PRIOR_BLOCKS', severity: 'HIGH', where: 'account', detail: String(h.priorBlocked) });
    if ((h.complaintRate ?? 0) > 0.003) push({ code: 'ACCOUNT_COMPLAINT_RATE', severity: 'HIGH', where: 'account', detail: String(h.complaintRate) });
    if ((h.bounceRate ?? 0) > 0.05) push({ code: 'ACCOUNT_BOUNCE_RATE', severity: 'MEDIUM', where: 'account', detail: String(h.bounceRate) });
    if ((h.ageDays ?? 99) < 1) push({ code: 'ACCOUNT_NEW', severity: 'MEDIUM', where: 'account' });
    if (h.dailyCap && (h.sentLast24h ?? 0) >= h.dailyCap) push({ code: 'ACCOUNT_VELOCITY', severity: 'MEDIUM', where: 'account' });
  }

  const score = Math.min(100, findings.reduce((s, f) => s + WEIGHT[f.severity], 0));
  const blocked = findings.some((f) => f.severity === 'BLOCK');
  const high = findings.some((f) => f.severity === 'HIGH');
  const verdict: RiskVerdict = blocked ? 'BLOCK' : high || score >= 30 ? 'REVIEW' : 'ALLOW';
  const level: RiskLevel = blocked ? 'BLOCKED' : high || score >= 50 ? 'HIGH' : score >= 15 ? 'MEDIUM' : 'LOW';
  const needsModel = !blocked && (findings.some((f) => f.code === 'OFF_DOMAIN' || f.code === 'GAMBLING_MENTION'));
  return { verdict, level, score, findings, needsModel };
}

/** Review policy (admin setting email_review_policy): what an assessment means for the campaign. */
export function reviewOutcome(r: RiskResult, policy: 'MANUAL_ALL' | 'AUTO_LOW_RISK'): 'APPROVED' | 'UNDER_REVIEW' | 'REJECTED' {
  if (r.verdict === 'BLOCK') return 'REJECTED';
  if (policy === 'AUTO_LOW_RISK' && r.verdict === 'ALLOW' && r.level === 'LOW') return 'APPROVED';
  return 'UNDER_REVIEW';
}

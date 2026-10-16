// HOMATCH EMAIL STUDIO — what an AI draft is allowed to say.
//
// The model writes a headline, a short body, a subject, a preheader and a button
// label from the seller's OWN listing facts. It may not invent facts, prices,
// discounts, urgency or luxury. The prompt says so; this module checks it, because
// a prompt is a request and a check is a guarantee. A draft that fails the check is
// discarded and the approved template copy is used instead.

export const DRAFT_SYSTEM_PROMPT = [
  'You write a short property-offer email for a property owner on HOMATCH, a Georgian real-estate platform.',
  'Use ONLY the listing facts you are given. Never invent or estimate facts, amenities, views, distances, prices,',
  'discounts, offers, deadlines, scarcity or demand. No urgency ("hurry", "limited time", "act now", "last chance").',
  'No luxury or superlative claims ("luxury", "exclusive", "best", "perfect", "dream home", "unique opportunity")',
  'unless the exact word appears in the facts. No numbers other than those in the facts. No emojis. No exclamation marks.',
  'Do not mention the recipient by name. Do not promise anything. Calm, professional, specific, honest.',
  'Write in the requested language. Reply with ONLY a JSON object:',
  '{"subject": string (max 90 chars), "preheader": string (max 140), "headline": string (max 80),',
  ' "body": string (2-3 short sentences, max 420), "cta": string (max 28)}',
].join(' ');

export interface DraftCopy {
  subject: string;
  preheader: string;
  headline: string;
  body: string;
  cta: string;
}

const MAX: Record<keyof DraftCopy, number> = { subject: 90, preheader: 140, headline: 80, body: 420, cta: 28 };

/** Words that signal invented urgency, discounts or luxury (several languages). */
const BANNED = [
  /\bdiscount/i, /\bsale price\b/i, /\boff\b\s*\d/i, /\bhurry\b/i, /\blimited[- ]time\b/i, /\bact now\b/i, /\blast chance\b/i,
  /\bdon'?t miss\b/i, /\bluxur/i, /\bexclusive\b/i, /\bdream home\b/i, /\bonce[- ]in[- ]a[- ]lifetime\b/i, /\bguarantee/i,
  /скидк/i, /спеши/i, /роскош/i, /эксклюзив/i, /indirim/i, /acele/i, /lüks/i, /ფასდაკლ/i, /ლუქს/i, /ჩქარ/i,
  /خصم/, /فاخر/, /حصري/, /عاجل/, /הנחה/, /יוקר/, /בלעדי/, /מהרו/,
];

function digitsIn(text: string): string[] {
  return (text.match(/\d[\d.,\s]*\d|\d/g) ?? []).map((d) => d.replace(/[^\d]/g, '')).filter(Boolean);
}

/**
 * Validate and clip a model answer. Returns null when the answer is unusable or
 * makes a claim the facts do not support — the caller then uses template copy.
 * `facts` is the exact JSON the model was given; any number in the draft must
 * appear in it.
 */
export function checkDraft(raw: unknown, facts: unknown): DraftCopy | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const out = {} as DraftCopy;
  for (const key of Object.keys(MAX) as Array<keyof DraftCopy>) {
    const v = r[key];
    if (typeof v !== 'string' || !v.trim()) return null;
    out[key] = v.replace(/\s+/g, ' ').trim().slice(0, MAX[key]);
  }
  const all = Object.values(out).join(' ');
  if (/[!]/.test(all)) return null;
  if (BANNED.some((re) => re.test(all))) return null;
  const allowed = new Set(digitsIn(JSON.stringify(facts ?? {})));
  for (const d of digitsIn(all)) if (!allowed.has(d)) return null;
  return out;
}

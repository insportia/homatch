// PHASE 2 — the contact details an author PUBLISHED, read out of their own text.
//
// Owner rule (D3 correction, 2026-10-02): public contact information is part of
// the source. It is returned exactly as written and never redacted merely for
// being contact information. This module only READS it — so the normalized
// entity can say "contactable" and dedupe can see that two posts carry the
// same phone — and the original text is always kept alongside, untouched.
//
// Nothing here invents a contact: a value is reported only when it appears in
// the text (or a field the source supplied). Each contact keeps its `raw`
// spelling for display and a `key` used only for comparison.

export type ContactKind = 'PHONE' | 'EMAIL' | 'TELEGRAM' | 'WHATSAPP' | 'VIBER' | 'URL';

export interface PublicContact {
  kind: ContactKind;
  /** As written by the author. */
  raw: string;
  /** Comparison key: +995XXXXXXXXX, lowercased email / handle / host+path. */
  key: string;
}

/** A Georgian or international phone, digits normalised; null when it cannot be one. */
export function phoneKey(raw: string): string | null {
  const plus = /^\s*\+/.test(raw);
  const bare = raw.replace(/\D/g, '');
  if (bare.length < 9 || bare.length > 15) return null;
  if (bare.startsWith('995') && bare.length === 12) return `+${bare}`;
  if (!plus && bare.length === 9 && /^[5-7]/.test(bare)) return `+995${bare}`;
  if (!plus && bare.length === 10 && bare.startsWith('0')) return `+995${bare.slice(1)}`;
  if (plus) return `+${bare}`;
  return null;
}

/*
 * A phone as people write one: +995 599 12 34 56, 599-12-34-56, (599) 123456,
 * 0599123456. Bounded so a price ("1 250 000") or a date does not qualify: a
 * candidate must normalise to a phone key, and a nine-digit Georgian number
 * must start with 5/6/7 (mobile / regional ranges actually issued).
 */
const PHONE_RE = /(?<![\d+])(\+?\d[\d\s\-().]{7,18}\d)(?!\d)/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}/g;
const TG_LINK_RE = /(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([A-Za-z][A-Za-z0-9_]{4,31})(?![\w/])/gi;
const HANDLE_RE = /(?<![\w@./])@([A-Za-z][A-Za-z0-9_]{4,31})(?!\w)/g;
const WA_RE = /(?:https?:\/\/)?wa\.me\/(\+?\d{9,15})/gi;
const VIBER_RE = /viber:\/\/(?:chat|add)\?number=(%2B|\+)?(\d{9,15})/gi;

function push(out: PublicContact[], seen: Set<string>, contact: PublicContact) {
  const id = `${contact.kind}:${contact.key}`;
  if (seen.has(id)) return;
  seen.add(id);
  out.push(contact);
}

/** Every contact the author published in `text`, in order of appearance, deduplicated by key. */
export function publicContactsIn(text: string | null | undefined): PublicContact[] {
  if (!text) return [];
  const out: PublicContact[] = [];
  const seen = new Set<string>();
  const source = String(text).slice(0, 20_000);

  for (const m of source.matchAll(WA_RE)) {
    const key = phoneKey(m[1]);
    if (key) push(out, seen, { kind: 'WHATSAPP', raw: m[0], key });
  }
  for (const m of source.matchAll(VIBER_RE)) {
    const key = phoneKey(`+${m[2]}`);
    if (key) push(out, seen, { kind: 'VIBER', raw: m[0], key });
  }
  // Phones, after the messenger links so wa.me digits are not counted twice.
  const withoutLinks = source.replace(WA_RE, ' ').replace(VIBER_RE, ' ').replace(/https?:\/\/\S+/g, ' ');
  for (const m of withoutLinks.matchAll(PHONE_RE)) {
    const key = phoneKey(m[1]);
    if (key) push(out, seen, { kind: 'PHONE', raw: m[1].trim(), key });
  }
  for (const m of source.matchAll(EMAIL_RE)) {
    push(out, seen, { kind: 'EMAIL', raw: m[0], key: m[0].toLowerCase() });
  }
  for (const m of source.matchAll(TG_LINK_RE)) {
    push(out, seen, { kind: 'TELEGRAM', raw: m[0], key: m[1].toLowerCase() });
  }
  for (const m of source.matchAll(HANDLE_RE)) {
    push(out, seen, { kind: 'TELEGRAM', raw: m[0], key: m[1].toLowerCase() });
  }
  return out;
}

/** Comparison keys only, for dedupe: phones from every messenger collapse onto the same number. */
export function contactKeys(contacts: readonly PublicContact[]): string[] {
  const keys = new Set<string>();
  for (const c of contacts) {
    const family = c.kind === 'WHATSAPP' || c.kind === 'VIBER' ? 'PHONE' : c.kind;
    keys.add(`${family}:${c.key}`);
  }
  return [...keys].sort();
}

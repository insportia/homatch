// CONTACT NUMBERS AND THE CONTACT FOOTER — pure, shared byte-for-byte with
// src/publishing/contacts.ts (a test pins the two copies identical, because the
// browser previews exactly the text the server hands to a portal).
//
// Rules:
//   - A listing carries up to MAX_CONTACTS numbers. A valid number can always be
//     CALLED; WhatsApp and Viber are offered only when the owner switched them on
//     for that number — never inferred.
//   - The footer is generated from the numbers, stored nowhere inside the
//     description, and appended EXACTLY ONCE when a portal copy is produced: a
//     description that already ends with a footer (pasted back from an earlier
//     copy) has it removed before the fresh one is added.
//   - Plain text only: no HTML, no markdown. The emoji are ordinary characters.

export interface Contact {
  /** E.164, e.g. +995555123456. */
  phone: string;
  whatsapp: boolean;
  viber: boolean;
}

export const MAX_CONTACTS = 3;
export type FooterLang = 'ka' | 'en' | 'ru';

const HEADERS: Record<FooterLang, string> = {
  ka: 'დაგვიკავშირდით მხოლოდ მითითებულ ნომრებზე:',
  en: 'Please contact us only at the numbers below:',
  ru: 'Связывайтесь с нами только по указанным номерам:',
};

const E164 = /^\+[1-9]\d{7,14}$/;
export const isE164 = (v: unknown): v is string => typeof v === 'string' && E164.test(v);

/** Raw contacts (and the older single `contactPhone`) → at most three distinct entries. */
export function normalizeContacts(raw: unknown, legacyPhone?: unknown): Contact[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: Contact[] = [];
  const seen = new Set<string>();
  const push = (phone: unknown, whatsapp: unknown, viber: unknown) => {
    const p = typeof phone === 'string' ? phone.replace(/[\s()-]/g, '').slice(0, 20) : '';
    if (!p || seen.has(p) || out.length >= MAX_CONTACTS) return;
    seen.add(p);
    out.push({ phone: p, whatsapp: whatsapp === true, viber: viber === true });
  };
  for (const c of list) if (c && typeof c === 'object') push((c as any).phone, (c as any).whatsapp, (c as any).viber);
  if (!out.length && legacyPhone) push(legacyPhone, false, false);
  return out;
}

/** +995555123456 → "+995 555 12 34 56"; other countries stay in E.164. */
export function formatPhone(e164: string): string {
  const m = e164.match(/^\+995(\d{3})(\d{2})(\d{2})(\d{2})$/);
  return m ? `+995 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : e164;
}

export interface ContactLinks { call: string; whatsapp: string | null; viber: string | null }

/** The links a buyer taps. WhatsApp / Viber exist only when switched on. */
export function contactLinks(c: Contact): ContactLinks {
  const digits = c.phone.replace(/^\+/, '');
  return {
    call: `tel:${c.phone}`,
    whatsapp: c.whatsapp ? `https://wa.me/${digits}` : null,
    viber: c.viber ? `viber://chat?number=%2B${digits}` : null,
  };
}

/** The footer block for valid numbers, or '' when there is none. */
export function contactFooter(contacts: Contact[], lang: FooterLang = 'ka'): string {
  const valid = contacts.filter((c) => isE164(c.phone));
  if (!valid.length) return '';
  const lines: string[] = [HEADERS[lang] ?? HEADERS.ka, ''];
  for (const c of valid) {
    lines.push(`📞 ${formatPhone(c.phone)}`);
    const apps = [c.whatsapp ? 'WhatsApp' : '', c.viber ? 'Viber' : ''].filter(Boolean);
    if (apps.length) lines.push(`📱 ${apps.join(' · ')}`);
  }
  return lines.join('\n');
}

/** Remove a trailing footer (any language), so appending one never doubles it. */
export function stripFooter(description: string): string {
  let text = description;
  for (const header of Object.values(HEADERS)) {
    const at = text.lastIndexOf(header);
    if (at < 0) continue;
    const tail = text.slice(at + header.length).split('\n').map((l) => l.trim()).filter(Boolean);
    if (tail.every((l) => l.startsWith('📞') || l.startsWith('📱'))) text = text.slice(0, at);
  }
  return text.replace(/\s+$/, '');
}

/** Description + footer, exactly once. */
export function withFooter(description: string, contacts: Contact[], lang: FooterLang = 'ka'): string {
  const body = stripFooter(description);
  const footer = contactFooter(contacts, lang);
  if (!footer) return body;
  return body ? `${body}\n\n${footer}` : footer;
}

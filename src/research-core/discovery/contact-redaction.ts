// PHASE 2 — a community post's contact details never reach a customer.
//
// A Telegram listing usually ends with the poster's phone, @handle or a
// t.me / wa.me link. The title and description stored on a community
// supply_observation are customer-visible (find-property returns the title),
// and an external contact is something HOMATCH unlocks deliberately, never
// leaks. So they are redacted at ingestion, before the row is written.
//
// Deterministic, no model, no network. What stays: prices, areas, rooms,
// floors, addresses, districts and listing / cadastral identifiers. A digit
// run is a phone only when it looks like one -- an international prefix, a
// Georgian mobile or landline, a Russian-style 11-digit number, or any 7-15
// digit run introduced by a contact word -- and never when money, an area
// or an identifier label sits next to it.
//
// Parsing (price, area, rooms...) still reads the ORIGINAL text; only what is
// stored for display is redacted.

export const CONTACT_MASK = '[•••]';

export interface Redaction {
  text: string;
  /** How many contacts were removed, by kind. */
  removed: { phone: number; handle: number; link: number; email: number };
}

const CONTACT_LINK = /(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog|wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|whatsapp\.com|viber\.click|invite\.viber\.com)\/[^\s)\]]*|viber:\/\/[^\s)\]]+|tg:\/\/[^\s)\]]+/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const HANDLE = /(^|[^\p{L}\p{N}_.@/])@([A-Za-z][A-Za-z0-9_]{2,31})\b/gu;
const PHONE_CANDIDATE = /(?:\+\s*)?\(?\d[\d\s().‐-―-]{5,22}\d/g;

/* A contact word just before a number makes it a phone even in an odd format. */
const CONTACT_WORD = /(?:tel|phone|mob|call|whats\s?app|viber|telegram|contact|ტელ|ტელეფ|მობ|დარეკ|დაგვიკავშირდ|დამიკავშირდ|კონტაქტ|ვაიბერ|ვოთსაპ|ვაცაპ|тел|моб|звон|контакт|вайбер|ватсап|вотсап|whatsapp)[^\d+]{0,16}$/i;
/* Money, an area, a size or a unit after it means it is not a phone. */
const UNIT_AFTER = /^\s*(?:\$|€|₾|£|usd|gel|eur|lari|ლარ|лар|дол|m2|m²|м2|м²|кв|sq|sqm|მ2|მ²|კვ|%|x\s?\d)/i;
/* An identifier label before it: a listing / cadastral id is never a phone. */
const ID_BEFORE = /(?:\bid|№|#|\bno\.?|code|код|კოდ|cadastr|кадастр|საკადასტრ|\bref|артикул)[\s:.\-#№]*$/i;
/* A price word or a currency introducing the number ("$ 120000", "ფასი 85000"). */
const PRICE_BEFORE = /(?:[$€₾£]|usd|gel|eur|price|цена|стоимост|ფას|ღირებ)[\s:.\-]*$/i;
/* ...unless that currency closes the PREVIOUS amount ("120 000 $ 599123456"). */
const CURRENCY_CLOSING = /\d[\s\d]*(?:[$€₾£]|usd|gel|eur|ლარ\S*|лар\S*)[\s,.;:/]*$/i;

function looksLikePhone(digits: string, hasPlus: boolean, contactWord: boolean): boolean {
  if (digits.length < 7 || digits.length > 15) return false;
  if (contactWord) return true;
  if (hasPlus) return digits.length >= 9;
  const national = digits.replace(/^995/, '').replace(/^0/, '');
  if (/^(5\d{8}|32\d{7}|4\d{8}|79\d{7})$/.test(national)) return true;   // Georgia
  if (/^[78]9\d{9}$/.test(digits)) return true;                            // RU/KZ mobile
  if (/^995\d{9}$/.test(digits)) return true;
  return false;
}

export function redactContacts(input: string | null | undefined): Redaction {
  const removed = { phone: 0, handle: 0, link: 0, email: 0 };
  let text = String(input ?? '');

  text = text.replace(CONTACT_LINK, () => { removed.link++; return CONTACT_MASK; });
  text = text.replace(EMAIL, () => { removed.email++; return CONTACT_MASK; });
  text = text.replace(HANDLE, (_m, lead: string) => { removed.handle++; return `${lead}${CONTACT_MASK}`; });

  /* A candidate can run on into the next number ("599123456 85 m2"), so the
     longest leading group-run that reads as a phone is taken, not all or none. */
  let out = '';
  let last = 0;
  for (const match of text.matchAll(PHONE_CANDIDATE)) {
    const offset = match.index ?? 0;
    if (offset < last) continue;
    const groups = [...match[0].matchAll(/\+?\(?\d+\)?/g)];
    const before = text.slice(Math.max(0, offset - 24), offset);
    const contactWord = CONTACT_WORD.test(before);
    if (!contactWord && ID_BEFORE.test(before)) continue;
    if (!contactWord && PRICE_BEFORE.test(before) && !CURRENCY_CLOSING.test(before)) continue;
    for (let n = groups.length; n >= 1; n--) {
      const g = groups[n - 1];
      const length = (g.index ?? 0) + g[0].length;
      const candidate = match[0].slice(0, length);
      const digits = candidate.replace(/\D/g, '');
      const after = text.slice(offset + length, offset + length + 10);
      if (UNIT_AFTER.test(after)) continue;
      if (!looksLikePhone(digits, candidate.trimStart().startsWith('+'), contactWord)) continue;
      out += text.slice(last, offset) + CONTACT_MASK;
      last = offset + length;
      removed.phone++;
      break;
    }
  }
  text = out + text.slice(last);

  return { text, removed };
}

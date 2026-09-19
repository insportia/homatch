/*
 * WHAT AN ANSWER CONTAINS THAT A CUSTOMER MUST NOT READ.
 *
 * Found by sending one real question from the Mortgage checklist on the
 * live page. The answer was good — it quoted the scenario's own monthly
 * payment and cited the Legislative Herald — and it ended like this,
 * on screen, in Georgian, under a question about a late payment:
 *
 *   [[RESEARCH_JSON:{"entityName":"Research result","entityType":
 *   "PUBLIC_WEB_RESEARCH","confidence":60,"summary":"Homatch searched
 *   internal data first and then public web sources.","sources":[...
 *
 * That block is assembled by src/lib/sse.ts so a surface can render a
 * research card from it. /ai does exactly that: it parses the block,
 * removes it from the text and draws the card. The two OTHER surfaces
 * on the same hook — the assistant drawer and the Mortgage consultant —
 * printed the message verbatim, so both showed the JSON.
 *
 * It is one function because it is one rule: an answer has a part meant
 * for a person and a part meant for a component, and no surface gets to
 * decide that the second part is fine to show.
 *
 * Deliberately React-free, and matches ANY `[[NAME:…]]` block rather
 * than only this one: the next such envelope should be invisible by
 * default rather than after the next incident.
 */

/** `[[NAME:…]]`, the envelope the edge function and sse.ts both use. */
const INTERNAL_BLOCK = /\[\[[A-Z0-9_]+:[\s\S]*?\]\]/g;

export interface CustomerMessage {
  /** What the person reads. */
  text: string;
  /** True when something was removed, so a surface can log or show a card. */
  hadInternalBlock: boolean;
}

/**
 * The part of an assistant message that is addressed to a person.
 *
 * Whitespace left behind by a removed block is collapsed, because a
 * message that ends in three blank lines looks broken in a bubble sized
 * to its content.
 */
export function customerMessage(content: string): CustomerMessage {
  if (!content) return { text: '', hadInternalBlock: false };
  INTERNAL_BLOCK.lastIndex = 0;
  const hadInternalBlock = new RegExp(INTERNAL_BLOCK.source).test(content);
  if (!hadInternalBlock) return { text: content, hadInternalBlock: false };
  const text = content
    .replace(INTERNAL_BLOCK, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, hadInternalBlock: true };
}

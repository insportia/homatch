/*
 * HOMI ANSWER BLOCKS: the designed parts of an answer.
 *
 * A reply is Markdown prose (rendered by Streamdown) PLUS, optionally, a
 * short list of structured blocks the app draws as real components: key
 * figure tiles, a callout, a comparison table, a list of steps. The model
 * writes the blocks into the same hidden JSON block as everything else; this
 * module is the wall between that untrusted output and the screen.
 *
 * Backwards compatible by construction: no blocks means the answer renders
 * exactly as before. Every string is plain text (no markup, no links, no
 * template braces), capped in length, and stripped of em/en dashes.
 *
 * Pure and runtime-neutral: edge function, app and tests import it.
 */

import { stripAiDashes } from './style.ts';

export type CalloutTone = 'tip' | 'warning' | 'note';

export type HomiAnswerBlock =
  | { type: 'figures'; items: Array<{ label: string; value: string; hint?: string }> }
  | { type: 'callout'; tone: CalloutTone; title?: string; text: string }
  | { type: 'compare'; title?: string; columns: string[]; rows: Array<{ label: string; values: string[] }> }
  | { type: 'steps'; title?: string; items: string[] };

export const MAX_ANSWER_BLOCKS = 3;

const UNSAFE = /(<\s*\/?\s*[a-z]|\{\{|\}\}|\[\[|\]\]|```|javascript:|data:|https?:\/\/)/i;

function clean(raw: unknown, max: number): string {
  if (typeof raw !== 'string' && typeof raw !== 'number') return '';
  const s = stripAiDashes(String(raw).replace(/\s+/g, ' ').trim());
  if (!s || s.length > max || UNSAFE.test(s)) return '';
  return s;
}

function optional(raw: unknown, max: number): string | undefined {
  const s = clean(raw, max);
  return s || undefined;
}

function parseOne(raw: unknown): HomiAnswerBlock | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  const type = typeof b.type === 'string' ? b.type.toLowerCase() : '';

  if (type === 'figures') {
    const items = (Array.isArray(b.items) ? b.items : [])
      .map((it) => {
        const o = (it ?? {}) as Record<string, unknown>;
        const label = clean(o.label, 40);
        const value = clean(o.value, 28);
        if (!label || !value) return null;
        const hint = optional(o.hint, 60);
        return hint ? { label, value, hint } : { label, value };
      })
      .filter((x): x is { label: string; value: string; hint?: string } => x !== null)
      .slice(0, 4);
    return items.length >= 2 ? { type: 'figures', items } : null;
  }

  if (type === 'callout') {
    const text = clean(b.text, 280);
    if (!text) return null;
    const tone: CalloutTone = b.tone === 'warning' || b.tone === 'note' ? b.tone : 'tip';
    const title = optional(b.title, 60);
    return title ? { type: 'callout', tone, title, text } : { type: 'callout', tone, text };
  }

  if (type === 'compare') {
    const columns = (Array.isArray(b.columns) ? b.columns : []).map((c) => clean(c, 28)).filter(Boolean).slice(0, 3);
    if (columns.length < 2) return null;
    const rows = (Array.isArray(b.rows) ? b.rows : [])
      .map((r) => {
        const o = (r ?? {}) as Record<string, unknown>;
        const label = clean(o.label, 40);
        const values = (Array.isArray(o.values) ? o.values : []).slice(0, columns.length).map((v) => clean(v, 40));
        if (!label || values.length !== columns.length || values.some((v) => !v)) return null;
        return { label, values };
      })
      .filter((x): x is { label: string; values: string[] } => x !== null)
      .slice(0, 6);
    if (rows.length < 2) return null;
    const title = optional(b.title, 60);
    return title ? { type: 'compare', title, columns, rows } : { type: 'compare', columns, rows };
  }

  if (type === 'steps') {
    const items = (Array.isArray(b.items) ? b.items : []).map((s) => clean(s, 140)).filter(Boolean).slice(0, 6);
    if (items.length < 2) return null;
    const title = optional(b.title, 60);
    return title ? { type: 'steps', title, items } : { type: 'steps', items };
  }

  return null;
}

/** Model output → renderable blocks. Never throws; bad blocks just disappear. */
export function parseAnswerBlocks(raw: unknown): HomiAnswerBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: HomiAnswerBlock[] = [];
  for (const item of raw) {
    const block = parseOne(item);
    if (block) out.push(block);
    if (out.length >= MAX_ANSWER_BLOCKS) break;
  }
  return out;
}

/** How the visible reply is written, and how blocks are requested. */
export const HOMI_ANSWER_FORMAT_INSTRUCTION = [
  'HOW THE ANSWER LOOKS',
  'Your visible reply is clean Markdown that the app renders as a designed card. Start with the direct answer in one or two',
  'sentences. Use a short "### " heading only when the reply genuinely has two or more parts. Lists are short (five items at most).',
  'Put **bold** on the one or two things that matter most. No tables in the prose, no links unless they are sources.',
  'In the same JSON block you may also return "blocks": at most three structured blocks that the app draws as real components.',
  'Use one only when it makes the answer easier to take in, and do not repeat its content in the prose:',
  '{"type":"figures","items":[{"label":"Monthly payment","value":"$1,240","hint":"20 years, 11%"}]} two to four key numbers that come',
  'from PAGE CONTEXT, HOMATCH INTERNAL DATA or the person, never invented;',
  '{"type":"callout","tone":"tip"|"warning"|"note","title":"...","text":"..."} one important warning, tip or caveat;',
  '{"type":"compare","title":"...","columns":["Vake","Saburtalo"],"rows":[{"label":"Price per m2","values":["...","..."]}]} two or three',
  'options side by side, two to six rows;',
  '{"type":"steps","title":"...","items":["...","..."]} a short ordered procedure, two to six steps.',
  'All block text is plain text in the conversation\'s language. Most short replies need no blocks: return [] then.',
].join('\n');

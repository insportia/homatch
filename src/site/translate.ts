// HOMATCH — Site Studio translation suggestions.
//
// Calls the real `homatch-ai` edge function. There is no mock and no
// placeholder path: the requirement was to either build it or leave the
// contract unimplemented, not to fake an answer. If the function is
// unreachable, this returns nothing and the editor says so.
//
// What this module is NOT allowed to do, and structurally cannot:
//
//   - publish anything. It returns strings. The caller puts them in the
//     `suggestion` half of the model, which publishing never reads.
//   - overwrite a reviewed translation. That decision belongs to
//     applyAutoTranslation/applySuggestion in model.ts, which this file does
//     not import and cannot bypass.
//   - translate word by word. The prompt asks for the copy to be REWRITTEN so
//     it reads as though it had been written in that language, because the
//     public site's Georgian and Russian copy was hand-written to sound
//     native and a literal pass would undo that.

import { sendStreamRequest } from '@/lib/sse';
import { supabase } from '@/db/supabase';
import type { Locale } from './model';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

/** How each language should be addressed in the instruction. */
const LANGUAGE_NAMES: Record<Locale, string> = {
  en: 'English',
  ka: 'Georgian (ქართული)',
  ru: 'Russian (русский)',
  tr: 'Turkish (Türkçe)',
  ar: 'Arabic (العربية)',
  he: 'Hebrew (עברית)',
};

export interface TranslateRequest {
  text: string;
  from: Locale;
  to: Locale;
  /** What the string is for, e.g. "button label", "section title". Shapes
   *  length and register far more than the source text alone does. */
  role?: string;
}

/**
 * The house style, restated for every request.
 *
 * These are the same rules the hand-written site copy already follows, and
 * they are stated here so a suggestion does not quietly reintroduce the
 * things that were deliberately removed from the site: dashes used as
 * connectors, punctuation in titles, and English sentence rhythm transcribed
 * into another alphabet.
 */
function instruction(req: TranslateRequest): string {
  const to = LANGUAGE_NAMES[req.to];
  const from = LANGUAGE_NAMES[req.from];
  const role = req.role ? ` It is a ${req.role} on a real estate platform.` : '';

  return [
    `Rewrite the following ${from} text in ${to}.${role}`,
    '',
    'Rules:',
    `1. Do not translate word by word. Write what a native ${to} copywriter would`,
    '   have written to convey the same thing to the same reader.',
    '2. Keep roughly the same length. This is website copy in a fixed layout,',
    '   so a sentence that doubles in length breaks the page.',
    '3. Do not use em dashes or en dashes, and do not build sentences around a',
    '   dash. Use separate sentences or a comma. Hyphens inside a compound word',
    '   are fine.',
    '4. If the text is a title or a label, do not end it with a period and do',
    '   not use colons or semicolons inside it.',
    '5. Keep "Homatch" and any product name exactly as written.',
    '6. Keep any {{placeholder}} tokens exactly as written, including the braces.',
    '7. Reply with the rewritten text only. No quotes, no explanation, no',
    '   alternatives, no notes.',
    '',
    'Text:',
    req.text,
  ].join('\n');
}

/** Strip the things a chat model adds even when told not to. */
function clean(raw: string): string {
  let out = raw.trim();
  // A fenced block, which some models use for "here is the output".
  const fence = out.match(/^```[a-z]*\n([\s\S]*?)\n?```$/i);
  if (fence) out = fence[1].trim();
  // A single pair of wrapping quotes that was not in the source.
  const quoted = out.match(/^["“”'«»](.+)["“”'«»]$/s);
  if (quoted) out = quoted[1].trim();
  // A leading "Georgian:" style label.
  out = out.replace(/^[A-Za-z ()]{3,30}:\s*/, '');
  return out.trim();
}

export type TranslateOutcome =
  | { ok: true; text: string }
  | { ok: false; reason: 'EMPTY' | 'FAILED' };

/**
 * One string, one language.
 *
 * Deliberately one field per call rather than a batch: a batch means parsing
 * a structured reply, and a model that miscounts array entries would shift
 * every suggestion onto the wrong field. The cost of being slower is paid
 * once per edit, by an admin, in the background.
 */
export async function translateText(req: TranslateRequest): Promise<TranslateOutcome> {
  const source = req.text.trim();
  if (source === '') return { ok: false, reason: 'EMPTY' };
  if (req.from === req.to) return { ok: true, text: source };

  const { data: { session } } = await supabase.auth.getSession();

  let accumulated = '';
  let failed = false;

  await sendStreamRequest({
    functionUrl: `${SUPABASE_URL}/functions/v1/homatch-ai`,
    requestBody: {
      messages: [{ role: 'user', content: instruction(req) }],
      // The target language, so the function's own localisation of the reply
      // agrees with what we are asking it to produce.
      locale: req.to,
    },
    supabaseAnonKey: SUPABASE_ANON_KEY,
    accessToken: session?.access_token,
    onData: (raw: string) => {
      try {
        const parsed = JSON.parse(raw);
        const chunk = parsed?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        if (chunk) accumulated += chunk;
      } catch { /* incomplete frame */ }
    },
    onComplete: () => { /* accumulated is the answer */ },
    onError: () => { failed = true; },
  });

  if (failed) return { ok: false, reason: 'FAILED' };
  const text = clean(accumulated);
  if (text === '') return { ok: false, reason: 'FAILED' };
  return { ok: true, text };
}

export interface BatchItem {
  sectionId: string;
  field: string;
  locale: Locale;
  source: string;
  sourceLocale: Locale;
  role?: string;
}

export interface BatchOutcome {
  item: BatchItem;
  text: string;
}

/**
 * Translate a list of targets, reporting progress as it goes.
 *
 * Sequential on purpose. Six locales across a page of sections is enough
 * requests to trip the edge function's rate limiter if fired at once, and a
 * half-applied batch is worse than a slow one. Failures are skipped rather
 * than aborting the run: the admin gets the suggestions that did arrive, and
 * the fields that did not are still flagged for review, which is exactly the
 * state they were in before.
 */
export async function translateBatch(
  items: readonly BatchItem[],
  onProgress?: (done: number, total: number) => void,
  signal?: { aborted: boolean },
): Promise<BatchOutcome[]> {
  const out: BatchOutcome[] = [];
  for (let i = 0; i < items.length; i += 1) {
    if (signal?.aborted) break;
    const item = items[i];
    const result = await translateText({
      text: item.source,
      from: item.sourceLocale,
      to: item.locale,
      role: item.role,
    });
    if (result.ok) out.push({ item, text: result.text });
    onProgress?.(i + 1, items.length);
  }
  return out;
}

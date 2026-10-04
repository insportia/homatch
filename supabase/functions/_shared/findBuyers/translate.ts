// Translate one lead's public text to the reader's UI language — on request,
// cached by (content hash, source language, target language, model version),
// costed into the ledger as TRANSLATION. The original is never overwritten.

import { contentFingerprint } from '../../../../src/research-core/findBuyers/identity.ts';
import { detectLanguage, isSearchLanguage } from '../../../../src/research-core/findBuyers/languages.ts';
import { openAiJson, parsePriceBook, recordAiCost } from './openai.ts';

export const TRANSLATION_MODEL_VERSION = 'fb-tr-1';
const NAMES: Record<string, string> = { ka: 'Georgian', ru: 'Russian', en: 'English', ar: 'Arabic', he: 'Hebrew', tr: 'Turkish' };

const SCHEMA = {
  name: 'find_buyers_translation', strict: true,
  schema: { type: 'object', additionalProperties: false, required: ['translation'], properties: { translation: { type: 'string', maxLength: 4000 } } },
} as const;

export async function translateLeadText(
  db: any,
  opts: { leadId: string; signalId: string; targetLang: string; propertyId: string },
): Promise<{ ok: boolean; translation?: string; sourceLang?: string | null; cached?: boolean; error?: string }> {
  if (!isSearchLanguage(opts.targetLang)) return { ok: false, error: 'BAD_TARGET_LANGUAGE' };
  const { data: lead } = await db.from('find_buyers_leads').select('id,matching_job_id,property_id,evidence,best_signal_id,parent_signal_id')
    .eq('id', opts.leadId).eq('property_id', opts.propertyId).maybeSingle();
  if (!lead) return { ok: false, error: 'NOT_FOUND' };
  const allowed = new Set<string>([lead.best_signal_id, lead.parent_signal_id,
    ...((Array.isArray(lead.evidence) ? lead.evidence : []) as any[]).flatMap((e) => [e.signalId, e.parentSignalId])].filter(Boolean));
  if (!allowed.has(opts.signalId)) return { ok: false, error: 'NOT_FOUND' };
  const { data: sig } = await db.from('raw_signals').select('original_text,language').eq('id', opts.signalId).maybeSingle();
  const text = String(sig?.original_text ?? '').slice(0, 2000);
  if (!text) return { ok: false, error: 'NO_TEXT' };
  const sourceLang = (sig?.language && isSearchLanguage(sig.language) ? sig.language : detectLanguage(text)) ?? 'other';
  if (sourceLang === opts.targetLang) return { ok: true, translation: text, sourceLang, cached: true };
  const hash = contentFingerprint(text);
  const { data: cached } = await db.from('find_buyers_translations').select('id,translated_text,hits')
    .eq('content_hash', hash).eq('source_lang', sourceLang).eq('target_lang', opts.targetLang).eq('model_version', TRANSLATION_MODEL_VERSION).maybeSingle();
  if (cached) {
    await db.from('find_buyers_translations').update({ hits: Number(cached.hits || 0) + 1 }).eq('id', cached.id);
    return { ok: true, translation: cached.translated_text, sourceLang, cached: true };
  }
  const { data: s } = await db.from('admin_settings').select('value').eq('key', 'find_buyers_openai_price_book').maybeSingle();
  const book = parsePriceBook(typeof s?.value === 'string' ? JSON.parse(s.value) : s?.value);
  const res = await openAiJson<{ translation: string }>(book,
    `Translate this public social-media text about real estate into ${NAMES[opts.targetLang]}. Keep names, numbers, prices and place names exact. Translate only; add nothing.`,
    text, SCHEMA, { maxTokens: Math.min(2000, 200 + text.length) });
  await recordAiCost(db, {
    key: `tr:${hash}:${sourceLang}:${opts.targetLang}:${TRANSLATION_MODEL_VERSION}`, matchingJobId: lead.matching_job_id,
    kind: 'TRANSLATION', operation: 'TRANSLATE', result: res, metadata: { leadId: lead.id, target: opts.targetLang },
  }).catch(() => undefined);
  const translation = res.data?.translation?.trim();
  if (!translation) return { ok: false, error: res.error ?? 'TRANSLATION_FAILED' };
  await db.from('find_buyers_translations').upsert({
    content_hash: hash, source_lang: sourceLang, target_lang: opts.targetLang, model_version: TRANSLATION_MODEL_VERSION,
    translated_text: translation, cost_micros: res.costMicros,
  }, { onConflict: 'content_hash,source_lang,target_lang,model_version', ignoreDuplicates: true });
  return { ok: true, translation, sourceLang, cached: false };
}

// ============================================================
// HOMATCH — Shared provider implementations for Edge Functions
// OpenAI (with a mock fallback). DataForSEO and Apify are retired.
// ============================================================

import type {
  SearchProvider,
  SocialCollectorProvider,
  AIProvider, AIClassifyRequest, AIIntentResult,
} from './provider_types.ts';

export type { SearchProvider, SocialCollectorProvider, AIProvider };

// ── UTILS ─────────────────────────────────────────────────────

function env(key: string): string {
  return Deno.env.get(key) ?? '';
}

// ── DATAFORSEO AND APIFY: RETIRED ─────────────────────────────
//
// DataForSEOProvider and ApifyProvider lived here. Both providers are retired
// from the Homatch architecture (see ./retiredProviders.ts), and the classes
// were removed rather than disabled: a class that can still build a request is
// one constructor call from spending money. social-collect, their last
// importer, now answers 423 retired without constructing anything.

// ── OPENAI AI PROVIDER ────────────────────────────────────────

const CLASSIFY_SYSTEM_PROMPT = `You are a multilingual real-estate intent classifier.
Given a text snippet (in any of: English, Georgian, Russian, Turkish, Arabic, Hebrew), 
determine if it expresses a genuine demand to BUY, RENT, INVEST, RELOCATE_BUY, or RELOCATE_RENT property.
Reject SELLER, AGENT_AD, PROPERTY_AD, SPAM, NOISE, UNKNOWN.

Return ONLY valid JSON (no markdown) with this schema:
{
  "intentType": "BUY|RENT|INVEST|RELOCATE_BUY|RELOCATE_RENT|SELLER|AGENT_AD|PROPERTY_AD|SPAM|NOISE|UNKNOWN",
  "country": string|null,
  "region": string|null,
  "city": string|null,
  "district": string|null,
  "neighborhoods": string[]|null,
  "transactionType": "SALE|RENT|INVESTMENT"|null,
  "propertyTypes": string[]|null,
  "bedroomsMin": number|null,
  "bedroomsMax": number|null,
  "areaMin": number|null,
  "areaMax": number|null,
  "budgetMin": number|null,
  "budgetMax": number|null,
  "currency": string|null,
  "timeline": string|null,
  "relocationIntent": boolean,
  "investmentIntent": boolean,
  "language": string|null,
  "intentConfidence": number,
  "specificityScore": number,
  "actionabilityScore": number,
  "translatedText": string|null
}
All scores are 0.0-1.0. Never invent unknown facts; use null.`;

export class OpenAIProvider implements AIProvider {
  name = 'OPENAI';
  private apiKey = env('OPENAI_API_KEY');

  isConfigured() {
    return !!this.apiKey;
  }

  async classify(req: AIClassifyRequest): Promise<AIIntentResult> {
    if (!this.isConfigured()) {
      return this._mock(req);
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 500,
        messages: [
          { role: 'system', content: CLASSIFY_SYSTEM_PROMPT },
          { role: 'user', content: req.text },
        ],
      }),
    });

    if (!res.ok) {
      throw new Error(`OpenAI error: ${res.status} ${await res.text()}`);
    }

    const json = await res.json();
    const content = json.choices?.[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(content) as Partial<AIIntentResult>;

    // Cost estimate: gpt-4o-mini ~$0.15 per 1M input tokens
    const inputTokens = json.usage?.prompt_tokens ?? 200;
    const costUsd = (inputTokens / 1_000_000) * 0.15;

    return {
      intentType: parsed.intentType ?? 'UNKNOWN',
      country: parsed.country ?? null,
      region: parsed.region ?? null,
      city: parsed.city ?? null,
      district: parsed.district ?? null,
      neighborhoods: parsed.neighborhoods ?? null,
      transactionType: parsed.transactionType ?? null,
      propertyTypes: parsed.propertyTypes ?? null,
      bedroomsMin: parsed.bedroomsMin ?? null,
      bedroomsMax: parsed.bedroomsMax ?? null,
      areaMin: parsed.areaMin ?? null,
      areaMax: parsed.areaMax ?? null,
      budgetMin: parsed.budgetMin ?? null,
      budgetMax: parsed.budgetMax ?? null,
      currency: parsed.currency ?? null,
      timeline: parsed.timeline ?? null,
      relocationIntent: parsed.relocationIntent ?? false,
      investmentIntent: parsed.investmentIntent ?? false,
      language: parsed.language ?? null,
      intentConfidence: parsed.intentConfidence ?? 0,
      specificityScore: parsed.specificityScore ?? 0,
      actionabilityScore: parsed.actionabilityScore ?? 0,
      translatedText: parsed.translatedText ?? null,
      model: 'gpt-4o-mini',
      costUsd,
    };
  }

  private _mock(req: AIClassifyRequest): AIIntentResult {
    const lower = req.text.toLowerCase();
    const isBuyer =
      lower.includes('looking') || lower.includes('want') ||
      lower.includes('buy') || lower.includes('rent') ||
      lower.includes('need') || lower.includes('ищу') ||
      lower.includes('куплю') || lower.includes('ვეძებ') ||
      lower.includes('arıyorum') || lower.includes('أبحث');

    return {
      intentType: isBuyer ? 'BUY' : 'UNKNOWN',
      country: 'GE',
      region: null,
      city: lower.includes('tbilisi') || lower.includes('тбилис') ? 'Tbilisi' : null,
      district: lower.includes('vake') ? 'Vake' : lower.includes('saburtalo') ? 'Saburtalo' : null,
      neighborhoods: null,
      transactionType: lower.includes('rent') || lower.includes('аренд') ? 'RENT' : 'SALE',
      propertyTypes: ['APARTMENT'],
      bedroomsMin: lower.includes('2') ? 2 : lower.includes('3') ? 3 : null,
      bedroomsMax: null,
      areaMin: null,
      areaMax: null,
      budgetMin: 150000,
      budgetMax: 220000,
      currency: 'USD',
      timeline: null,
      relocationIntent: false,
      investmentIntent: false,
      language: req.language ?? 'en',
      intentConfidence: isBuyer ? 0.82 : 0.1,
      specificityScore: 0.65,
      actionabilityScore: 0.7,
      translatedText: null,
      model: 'MOCK',
      costUsd: 0,
    };
  }
}

// ============================================================
// HOMATCH — Shared provider implementations for Edge Functions
// DataForSEO · Apify · OpenAI (all with mock fallbacks)
// ============================================================

import type {
  SearchProvider, SearchQuery, SearchProviderResponse,
  SocialCollectorProvider, SocialCollectRequest, SocialCollectResponse,
  AIProvider, AIClassifyRequest, AIIntentResult,
} from './provider_types.ts';

export type { SearchProvider, SocialCollectorProvider, AIProvider };

// ── UTILS ─────────────────────────────────────────────────────

function env(key: string): string {
  return Deno.env.get(key) ?? '';
}

// ── DATAFORSEO ────────────────────────────────────────────────

export class DataForSEOProvider implements SearchProvider {
  name = 'DATAFORSEO';
  private login = env('DATAFORSEO_LOGIN');
  private password = env('DATAFORSEO_PASSWORD');

  isConfigured() {
    return !!(this.login && this.password);
  }

  async search(queries: SearchQuery[]): Promise<SearchProviderResponse> {
    if (!this.isConfigured()) {
      return this._mock(queries);
    }

    const tasks = queries.map(q => ({
      keyword: q.q,
      language_code: q.language ?? 'en',
      location_code: 21831, // Georgia default
      device: 'desktop',
    }));

    const auth = btoa(`${this.login}:${this.password}`);
    const res = await fetch(
      'https://api.dataforseo.com/v3/serp/google/organic/live/advanced',
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(tasks),
      }
    );

    if (!res.ok) {
      throw new Error(`DataForSEO error: ${res.status} ${await res.text()}`);
    }

    const json = await res.json();
    const results = [];

    for (const task of json.tasks ?? []) {
      for (const item of task.result?.[0]?.items ?? []) {
        if (item.type === 'organic') {
          results.push({
            title: item.title ?? '',
            url: item.url ?? '',
            snippet: item.description ?? '',
            publishedAt: item.timestamp,
            domain: item.domain,
          });
        }
      }
    }

    const costUsd = (json.tasks ?? []).reduce(
      (sum: number, t: { cost?: number }) => sum + (t.cost ?? 0),
      0
    );

    return {
      results,
      costUsd,
      provider: 'DATAFORSEO',
      cacheHit: false,
      requestId: json.tasks?.[0]?.id,
    };
  }

  private _mock(queries: SearchQuery[]): SearchProviderResponse {
    return {
      results: queries.map((q, i) => ({
        title: `[MOCK] Search result for: ${q.q}`,
        url: `https://example.com/result-${i}`,
        snippet: `Mock result for query: ${q.q}`,
        publishedAt: new Date().toISOString(),
        domain: 'example.com',
      })),
      costUsd: 0,
      provider: 'DATAFORSEO_MOCK',
      cacheHit: false,
    };
  }
}

// ── APIFY SOCIAL COLLECTOR ────────────────────────────────────

export class ApifyProvider implements SocialCollectorProvider {
  name = 'APIFY';
  private token = env('APIFY_API_TOKEN');

  private actorId(platform: string): string {
    const map: Record<string, string> = {
      FACEBOOK: env('APIFY_FACEBOOK_ACTOR_ID'),
      TELEGRAM: env('APIFY_TELEGRAM_ACTOR_ID'),
      INSTAGRAM: env('APIFY_INSTAGRAM_ACTOR_ID'),
      VK: env('APIFY_VK_ACTOR_ID'),
    };
    return map[platform] ?? '';
  }

  isConfigured() {
    return !!this.token;
  }

  async collect(req: SocialCollectRequest): Promise<SocialCollectResponse> {
    const actorId = this.actorId(req.platform);
    if (!this.isConfigured() || !actorId) {
      return this._mock(req);
    }

    // Build input per platform
    const input = this._buildInput(req);

    // Run actor synchronously (shorter runs for collection jobs)
    const runRes = await fetch(
      `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${this.token}&maxItems=${req.maxItems ?? 50}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(60_000),
      }
    );

    if (!runRes.ok) {
      throw new Error(`Apify error: ${runRes.status} ${await runRes.text()}`);
    }

    const items: Record<string, unknown>[] = await runRes.json();
    const posts = items.map(item => this._normalizeItem(item, req.platform));

    return {
      posts,
      costUsd: 0, // Apify charges via usage credits, tracked separately
      provider: 'APIFY',
      cacheHit: false,
    };
  }

  private _buildInput(req: SocialCollectRequest): Record<string, unknown> {
    switch (req.platform) {
      case 'FACEBOOK':
        return { startUrls: [{ url: req.sourceUrl }], maxPosts: req.maxItems ?? 50 };
      case 'TELEGRAM':
        return { channelOrGroupUrl: req.sourceUrl, maxMessages: req.maxItems ?? 100 };
      case 'INSTAGRAM':
        return { directUrls: [req.sourceUrl], resultsLimit: req.maxItems ?? 50 };
      case 'VK':
        return { startUrls: [{ url: req.sourceUrl }], maxPosts: req.maxItems ?? 50 };
      default:
        return {};
    }
  }

  private _normalizeItem(
    item: Record<string, unknown>,
    platform: string
  ) {
    return {
      externalId: String(item.id ?? item.postId ?? item.messageId ?? Math.random()),
      text: String(item.text ?? item.caption ?? item.message ?? ''),
      authorName: String(item.authorName ?? item.username ?? item.from?.name ?? ''),
      authorUrl: String(item.authorUrl ?? item.profileUrl ?? item.from?.url ?? ''),
      publishedAt: String(item.publishedAt ?? item.timestamp ?? item.date ?? ''),
      sourceUrl: String(item.url ?? item.postUrl ?? ''),
      platform,
    };
  }

  private _mock(req: SocialCollectRequest): SocialCollectResponse {
    const mockTexts: Record<string, string[]> = {
      FACEBOOK: [
        'Looking for 2-bedroom apartment in Vake district, budget $150k-200k',
        'Ищу квартиру в Тбилиси, 2 комнаты, до $180,000, желательно новостройка',
        'ვეძებ ბინას ვაკეში, 2 ოთახიანი, $150 000-მდე',
      ],
      TELEGRAM: [
        'Need apartment Tbilisi Saburtalo area, 2-3 rooms, rent $800-1000',
        'ვიყიდი ბინას სабуртالოში, 3 ოთახიანი',
        'Куплю квартиру в центре Тбилиси 2-3 комнаты до 200к',
      ],
      INSTAGRAM: [
        'Looking to relocate to Tbilisi, need furnished 1BR apartment for rent',
      ],
      VK: [
        'Ищем квартиру в Тбилиси для покупки, 2-3 комнаты, бюджет до $200k',
      ],
    };
    const texts = mockTexts[req.platform] ?? [`Mock post from ${req.platform}`];
    return {
      posts: texts.map((text, i) => ({
        externalId: `mock-${req.platform}-${i}`,
        text,
        authorName: `mock_user_${i}`,
        authorUrl: `https://${req.platform.toLowerCase()}.com/mock_user_${i}`,
        publishedAt: new Date(Date.now() - i * 3600_000).toISOString(),
        sourceUrl: req.sourceUrl,
        platform: req.platform,
      })),
      costUsd: 0,
      provider: 'APIFY_MOCK',
      cacheHit: false,
    };
  }
}

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

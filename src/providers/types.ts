// ============================================================
// HOMATCH — Provider Abstractions (Part 2)
// MatchingEngine, SearchProvider, SocialCollectorProvider,
// AIProvider all depend on these normalized interfaces.
// ============================================================

// ── SEARCH PROVIDER ──────────────────────────────────────────

export interface SearchQuery {
  q: string;
  language?: string;
  country?: string;
  /** DataForSEO depth / Bing market codes etc. */
  options?: Record<string, unknown>;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  domain?: string;
}

export interface SearchProviderResponse {
  results: SearchResult[];
  costUsd: number;
  provider: string;
  cacheHit: boolean;
  requestId?: string;
}

export interface SearchProvider {
  name: string;
  search(queries: SearchQuery[]): Promise<SearchProviderResponse>;
  isConfigured(): boolean;
}

// ── SOCIAL COLLECTOR PROVIDER ─────────────────────────────────

export interface SocialCollectRequest {
  platform: 'FACEBOOK' | 'TELEGRAM' | 'INSTAGRAM' | 'VK';
  sourceUrl: string;
  externalId?: string;
  /** Collect only posts/messages after this timestamp */
  since?: string;
  maxItems?: number;
}

export interface SocialPost {
  externalId: string;
  text: string;
  authorName?: string;
  authorUrl?: string;
  publishedAt?: string;
  sourceUrl?: string;
  platform: string;
}

export interface SocialCollectResponse {
  posts: SocialPost[];
  costUsd: number;
  provider: string;
  cacheHit: boolean;
}

export interface SocialCollectorProvider {
  name: string;
  collect(req: SocialCollectRequest): Promise<SocialCollectResponse>;
  isConfigured(): boolean;
}

// ── AI PROVIDER ───────────────────────────────────────────────

export interface AIClassifyRequest {
  text: string;
  language?: string;
  /** Hint to AI about likely context */
  hint?: string;
}

export interface AIIntentResult {
  intentType: string;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  district?: string | null;
  neighborhoods?: string[] | null;
  transactionType?: string | null;
  propertyTypes?: string[] | null;
  bedroomsMin?: number | null;
  bedroomsMax?: number | null;
  areaMin?: number | null;
  areaMax?: number | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  currency?: string | null;
  timeline?: string | null;
  relocationIntent: boolean;
  investmentIntent: boolean;
  language?: string | null;
  intentConfidence: number;
  specificityScore: number;
  actionabilityScore: number;
  translatedText?: string | null;
  model: string;
  costUsd: number;
}

export interface AIProvider {
  name: string;
  classify(req: AIClassifyRequest): Promise<AIIntentResult>;
  isConfigured(): boolean;
}

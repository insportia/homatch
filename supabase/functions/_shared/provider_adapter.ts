/**
 * HOMATCH — Common Provider Adapter Layer
 *
 * Standard interface: canHandle / estimateCost / execute / normalize
 * All providers return ProviderResult — never trusted as a match directly.
 * Pipeline: raw result → normalize → dedup → raw_signal → classification → intent → matching
 *
 * SAFETY: No provider executes without passing safety_gate.checkExternalDiscoverySafety()
 * Extensible to: ZenRows, ScrapingBee, BrightData (all disabled by default).
 */

// ── Standard Result Type ──────────────────────────────────────────────────

export interface ProviderResult {
  provider: string;          // e.g. DATAFORSEO, APIFY_TELEGRAM
  platform: string;          // WEB, TELEGRAM, FACEBOOK, REDDIT, VK, INSTAGRAM, THREADS
  externalId: string;        // Provider's unique ID for dedup
  canonicalUrl: string | null; // Normalized URL for dedup
  sourceUrl: string | null;  // Original source URL
  title: string | null;
  content: string;           // Main text content
  publicAuthor: string | null; // Public author name (never private contact)
  publicAuthorUrl: string | null;
  language: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  publishedAt: string | null;
  rawMetadata: Record<string, unknown>; // Original item, safe fields only
  estimatedCostUsd: number;
  actualCostUsd: number;
}

export interface ProviderJob {
  id: string;
  propertyId: string;
  platform: string;
  query: string;
  language: string;
  queryKind: string;
  priority: number;
  claimToken: string;
  attempt: number;
  estimatedCostUsd: number;
}

export interface ProviderAdapterInterface {
  name: string;
  platform: string;
  canHandle(job: ProviderJob): boolean;
  estimateCost(job: ProviderJob): number;
  execute(job: ProviderJob): Promise<ProviderResult[]>;
  normalize(raw: Record<string, unknown>, job: ProviderJob): ProviderResult;
}

// ── URL Canonicalization ──────────────────────────────────────────────────

export function canonicalizeUrl(url: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    // Remove tracking params
    const trackingParams = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','fbclid','gclid','ref'];
    trackingParams.forEach(p => u.searchParams.delete(p));
    // Normalize hostname
    let host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '') || '/';
    return `${u.protocol}//${host}${path}${u.search}`;
  } catch {
    return url.slice(0, 500);
  }
}

export function canonicalizeTelegramUrl(url: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean).filter(x => x !== 's');
    return parts[0] ? `https://t.me/${parts[0]}` : null;
  } catch { return null; }
}

export function canonicalizeFacebookUrl(url: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/groups\/([^/?#]+)/);
    return m ? `https://www.facebook.com/groups/${m[1]}/` : null;
  } catch { return null; }
}

// ── Content Fingerprint ───────────────────────────────────────────────────

export async function contentFingerprint(text: string): Promise<string> {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 1200);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

// ── Dedup Key Generator ───────────────────────────────────────────────────

export interface DedupKeys {
  externalId: string;
  canonicalUrl: string | null;
  contentFingerprint: string;
}

export async function generateDedupKeys(result: ProviderResult): Promise<DedupKeys> {
  return {
    externalId: result.externalId,
    canonicalUrl: result.canonicalUrl,
    contentFingerprint: await contentFingerprint(
      `${result.platform}:${result.externalId}:${result.content}`,
    ),
  };
}

// ── Mock Provider Adapter (DRY-RUN mode) ─────────────────────────────────

export class MockProviderAdapter implements ProviderAdapterInterface {
  name = 'MOCK';
  platform = 'MOCK';

  private static readonly MOCK_TEXTS: Record<string, string[]> = {
    FACEBOOK: [
      'Looking for 2-bedroom apartment in Vake, budget $150k-200k',
      'Ищу квартиру в Тбилиси 2 комнаты до $180 000',
      'ვეძებ ბინას ვაკეში 2 ოთახიანი $150 000-მდე',
    ],
    TELEGRAM: [
      'Need apartment Tbilisi Saburtalo 2-3 rooms rent $800-1000',
      'ვიყიდი ბინას სабурталოში 3 ოთახიანი',
      'Куплю квартиру в центре Тбилиси 2-3 комнаты до 200к',
    ],
    WEB: [
      'Looking to buy apartment Tbilisi city center modern building',
      'Want to rent 1BR furnished Rustaveli area $700/month',
    ],
    REDDIT: [
      'Moving to Tbilisi, need 1-2 bedroom apartment for rent, max $900/month',
    ],
    THREADS: [
      'Relocating to Georgia, need help finding 2BR apartment Tbilisi',
    ],
    DEFAULT: [
      '[DRY-RUN] Mock signal for pipeline simulation',
    ],
  };

  canHandle(_job: ProviderJob): boolean { return true; }

  estimateCost(_job: ProviderJob): number { return 0; }

  async execute(job: ProviderJob): Promise<ProviderResult[]> {
    const texts = MockProviderAdapter.MOCK_TEXTS[job.platform] ??
      MockProviderAdapter.MOCK_TEXTS['DEFAULT'];

    return texts.map((text, i): ProviderResult => ({
      provider: 'MOCK',
      platform: job.platform,
      externalId: `mock-${job.platform}-${job.id}-${i}`,
      canonicalUrl: null,
      sourceUrl: `https://mock.homatch.local/${job.platform.toLowerCase()}/${job.id}/${i}`,
      title: null,
      content: text,
      publicAuthor: `mock_user_${i}`,
      publicAuthorUrl: null,
      language: job.language,
      country: 'GE',
      region: null,
      city: 'Tbilisi',
      publishedAt: new Date(Date.now() - i * 3_600_000).toISOString(),
      rawMetadata: { mockMode: true, jobId: job.id, index: i },
      estimatedCostUsd: 0,
      actualCostUsd: 0,
    }));
  }

  normalize(raw: Record<string, unknown>, job: ProviderJob): ProviderResult {
    return {
      provider: 'MOCK',
      platform: job.platform,
      externalId: String(raw['id'] ?? `mock-${Math.random()}`),
      canonicalUrl: null,
      sourceUrl: null,
      title: null,
      content: String(raw['text'] ?? ''),
      publicAuthor: null,
      publicAuthorUrl: null,
      language: job.language,
      country: 'GE',
      region: null,
      city: null,
      publishedAt: new Date().toISOString(),
      rawMetadata: raw,
      estimatedCostUsd: 0,
      actualCostUsd: 0,
    };
  }
}

// ── DataForSEO Web Adapter ────────────────────────────────────────────────

export class DataForSEOAdapter implements ProviderAdapterInterface {
  name = 'DATAFORSEO';
  platform = 'WEB';
  private readonly login: string;
  private readonly password: string;

  constructor() {
    this.login = Deno.env.get('DATAFORSEO_LOGIN') ?? '';
    this.password = Deno.env.get('DATAFORSEO_PASSWORD') ?? '';
  }

  canHandle(job: ProviderJob): boolean {
    return ['WEB', 'VK', 'INSTAGRAM'].includes(job.platform) &&
      !!(this.login && this.password);
  }

  estimateCost(_job: ProviderJob): number { return 0.002; }

  async execute(job: ProviderJob): Promise<ProviderResult[]> {
    if (!this.login || !this.password) {
      throw new Error('DataForSEO credentials not configured');
    }

    const sitePrefix =
      job.platform === 'VK' ? 'site:vk.com ' :
      job.platform === 'INSTAGRAM' ? 'site:instagram.com ' : '';
    const keyword = `${sitePrefix}${job.query}`;

    const auth = btoa(`${this.login}:${this.password}`);
    const resp = await fetch(
      'https://api.dataforseo.com/v3/serp/google/organic/live/advanced',
      {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([{
          keyword,
          language_code: job.language ?? 'en',
          location_code: 21831, // Georgia
          device: 'desktop',
        }]),
        signal: AbortSignal.timeout(70_000),
      },
    );

    if (!resp.ok) {
      throw new Error(`DataForSEO ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
    }

    const json = await resp.json();
    const actualCost = (json.tasks ?? []).reduce(
      (n: number, t: { cost?: number }) => n + Number(t.cost ?? 0), 0,
    );

    const results: ProviderResult[] = [];
    for (const task of json.tasks ?? []) {
      for (const item of task.result?.[0]?.items ?? []) {
        if (item.type !== 'organic') continue;
        results.push(this.normalize({
          url: item.url,
          title: item.title,
          snippet: item.description,
          publishedAt: item.timestamp,
          _actualCostShare: results.length > 0 ? 0 : actualCost,
        }, job));
      }
    }
    return results;
  }

  normalize(raw: Record<string, unknown>, job: ProviderJob): ProviderResult {
    const url = String(raw['url'] ?? '');
    const content = `${raw['title'] ?? ''}\n${raw['snippet'] ?? ''}`.trim();
    return {
      provider: 'DATAFORSEO',
      platform: job.platform,
      externalId: url || content.slice(0, 64),
      canonicalUrl: canonicalizeUrl(url),
      sourceUrl: url || null,
      title: raw['title'] ? String(raw['title']) : null,
      content,
      publicAuthor: null,
      publicAuthorUrl: null,
      language: job.language,
      country: 'GE',
      region: null,
      city: null,
      publishedAt: raw['publishedAt'] ? String(raw['publishedAt']) : null,
      rawMetadata: { url, title: raw['title'], domain: raw['domain'] },
      estimatedCostUsd: this.estimateCost(job),
      actualCostUsd: Number(raw['_actualCostShare'] ?? 0),
    };
  }
}

// ── Apify Social Adapter ──────────────────────────────────────────────────

const APIFY_ACTORS: Record<string, string> = {
  FACEBOOK: 'lofomachines~facebook-groups-posts-search-scraper',
  TELEGRAM: 'lofomachines~telegram-keyword-search-scraper',
  REDDIT: 'outspoken_strategy~reddit-posts-search-scraper',
  THREADS: 'webdata_labs~threads-scraper',
};

export class ApifyAdapter implements ProviderAdapterInterface {
  name = 'APIFY';
  platform = 'SOCIAL';
  private readonly token: string;

  constructor() {
    this.token = Deno.env.get('APIFY_API_TOKEN') ?? '';
  }

  canHandle(job: ProviderJob): boolean {
    return !!(this.token && APIFY_ACTORS[job.platform]);
  }

  estimateCost(job: ProviderJob): number {
    // Conservative estimate per Apify run
    return job.platform === 'TELEGRAM' ? 0.03 : 0.05;
  }

  async execute(job: ProviderJob): Promise<ProviderResult[]> {
    if (!this.token) throw new Error('APIFY_API_TOKEN not configured');
    const actorId = APIFY_ACTORS[job.platform];
    if (!actorId) throw new Error(`No Apify actor for platform ${job.platform}`);

    const input = this._buildInput(job);
    const startResp = await fetch(
      `https://api.apify.com/v2/acts/${actorId}/runs?memory=1024&timeout=900`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(20_000),
      },
    );

    if (!startResp.ok) {
      throw new Error(`Apify start ${startResp.status}: ${(await startResp.text()).slice(0, 300)}`);
    }
    const runData = await startResp.json();
    const run = runData.data ?? runData;
    return [{ _runId: run.id, _datasetId: run.defaultDatasetId, _status: run.status } as unknown as ProviderResult];
  }

  private _buildInput(job: ProviderJob): Record<string, unknown> {
    switch (job.platform) {
      case 'FACEBOOK':
        return { keywords: [job.query], afterDate: 'last_month', maxPosts: 150, countryCode: 'ge' };
      case 'TELEGRAM':
        return { mode: 'keyword', keywords: [job.query], afterDate: '1 month', countryCode: 'ge', languageCode: job.language.toLowerCase(), maxResultsPerKeyword: 150 };
      case 'THREADS':
        return { mode: 'search', searchQueries: [job.query], maxPosts: 120, postedAfter: new Date(Date.now() - 45 * 86_400_000).toISOString() };
      case 'REDDIT':
        return { queries: [job.query], sort: 'new', numberOfPosts: 120, timeFilter: 'month' };
      default:
        return { query: job.query };
    }
  }

  normalize(raw: Record<string, unknown>, job: ProviderJob): ProviderResult {
    const platform = job.platform;
    let canonicalUrl: string | null = null;

    if (platform === 'TELEGRAM') {
      canonicalUrl = canonicalizeTelegramUrl(
        String(raw['channelUrl'] ?? raw['channel_url'] ?? raw['sourceUrl'] ?? ''),
      );
    } else if (platform === 'FACEBOOK') {
      canonicalUrl = canonicalizeFacebookUrl(
        String(raw['group_url'] ?? raw['groupUrl'] ?? raw['inputUrl'] ?? ''),
      );
    } else if (platform === 'REDDIT') {
      try {
        const raw_url = String(raw['subredditUrl'] ?? raw['permalink'] ?? '');
        const m = new URL(raw_url.startsWith('http') ? raw_url : `https://reddit.com${raw_url}`)
          .pathname.match(/\/r\/([^/]+)/);
        canonicalUrl = m ? `https://www.reddit.com/r/${m[1]}/` : null;
      } catch { /* ignore */ }
    }

    const text = String(
      raw['text'] ?? raw['message'] ?? raw['post_text'] ?? raw['content'] ??
      raw['selftext'] ?? raw['body'] ?? raw['title'] ?? raw['caption'] ?? '',
    ).trim();

    const sourceUrl = String(
      raw['post_url'] ?? raw['postUrl'] ?? raw['messageUrl'] ?? raw['permalink'] ??
      raw['url'] ?? '',
    ) || null;

    const externalId = String(
      raw['id'] ?? raw['message_id'] ?? raw['messageId'] ?? raw['postId'] ??
      raw['facebookId'] ?? sourceUrl ?? Math.random().toString(36).slice(2),
    );

    return {
      provider: 'APIFY',
      platform,
      externalId,
      canonicalUrl,
      sourceUrl,
      title: null,
      content: text,
      publicAuthor: String(
        raw['author_name'] ?? raw['author'] ?? raw['username'] ?? raw['ownerName'] ?? '',
      ) || null,
      publicAuthorUrl: String(
        raw['author_url'] ?? raw['authorUrl'] ?? raw['channelUrl'] ?? raw['ownerUrl'] ?? '',
      ) || null,
      language: job.language,
      country: 'GE',
      region: null,
      city: null,
      publishedAt: (() => {
        const v = raw['date'] ?? raw['published_at'] ?? raw['publishedAt'] ?? raw['timestamp'];
        if (!v) return null;
        if (typeof v === 'number') return new Date(v > 1e12 ? v : v * 1000).toISOString();
        const d = new Date(String(v));
        return isNaN(d.getTime()) ? null : d.toISOString();
      })(),
      rawMetadata: {
        externalId,
        platform,
        authorName: raw['author_name'] ?? raw['author'],
        channelName: raw['channelTitle'] ?? raw['channel_title'],
        subreddit: raw['subreddit'],
      },
      estimatedCostUsd: this.estimateCost(job),
      actualCostUsd: Number(raw['_actualCostUsd'] ?? 0),
    };
  }
}

// ── Provider Registry ─────────────────────────────────────────────────────

export class ProviderRegistry {
  private adapters: ProviderAdapterInterface[] = [];

  register(adapter: ProviderAdapterInterface): this {
    this.adapters.push(adapter);
    return this;
  }

  resolve(job: ProviderJob): ProviderAdapterInterface | null {
    return this.adapters.find(a => a.canHandle(job)) ?? null;
  }

  estimateCost(job: ProviderJob): number {
    return this.resolve(job)?.estimateCost(job) ?? 0;
  }
}

/**
 * Default registry for production use.
 * Mock is always registered last as fallback (only active in dry-run).
 */
export function buildProductionRegistry(dryRun = false): ProviderRegistry {
  const registry = new ProviderRegistry();
  if (dryRun) {
    // Dry-run: only mock adapter
    registry.register(new MockProviderAdapter());
  } else {
    registry.register(new DataForSEOAdapter());
    registry.register(new ApifyAdapter());
    // ZenRows / ScrapingBee / BrightData: registered but disabled by kill switch
    // registry.register(new ZenRowsAdapter());  // future
  }
  return registry;
}

// ── Community Adapter (Phase 7) ──────────────────────────────
// Mock-only. External discovery disabled until community_discovery_enabled=true
// and a real adapter is registered.

export interface CommunityRecord {
  platform: 'TELEGRAM' | 'FACEBOOK' | 'VK' | 'REDDIT' | 'LINKEDIN' | 'THREADS' | 'WHATSAPP' | 'OTHER';
  canonical_id: string;
  canonical_url: string;
  name: string;
  description?: string;
  language?: string;
  country?: string;
  region?: string;
  city?: string;
  tags?: string[];
  topics?: string[];
  member_count?: number;
  posting_policy?: 'OPEN' | 'APPROVAL_REQUIRED' | 'CLOSED' | 'UNKNOWN';
  allows_auto_post?: boolean;
  /** primary = dedicated real-estate community; secondary = general/expat/classifieds
   *  community where housing posts appear alongside other topics. Defaults to
   *  'primary' for older records that predate this column. */
  housing_focus?: 'primary' | 'secondary';
  metadata?: Record<string, unknown>;
}

export interface RankingFactors {
  location_match: number;   // 0-1
  type_match: number;       // 0-1
  language_match: number;   // 0-1
  audience_match: number;   // 0-1
  topic_match: number;      // 0-1
  activity_score: number;   // 0-1
}

export interface CommunityRanking {
  community_id: string;
  score: number;
  rationale: RankingFactors & { summary: string };
}

/** Rank communities for a property based on all available signals */
export function rankCommunities(
  communities: Array<{ id: string } & CommunityRecord>,
  property: {
    country?: string | null;
    city?: string | null;
    language?: string | null;
    transaction_type?: string | null;
    property_type?: string | null;
    price?: number | null;
    tags?: string[];
  }
): CommunityRanking[] {
  return communities.map((c) => {
    const locationMatch =
      (c.country && property.country && c.country.toLowerCase() === property.country.toLowerCase() ? 0.5 : 0) +
      (c.city && property.city && c.city.toLowerCase() === property.city.toLowerCase() ? 0.5 : 0);

    const langMatch = c.language && property.language && c.language.split('-')[0] === property.language.split('-')[0] ? 1 : 0.3;

    const propTopics = (property.tags ?? []).map((t) => t.toLowerCase());
    const commTopics = (c.topics ?? []).concat(c.tags ?? []).map((t) => t.toLowerCase());
    const topicMatch = propTopics.length && commTopics.length
      ? propTopics.filter((t) => commTopics.includes(t)).length / Math.max(propTopics.length, 1)
      : 0.2;

    // Dedicated real-estate communities score highest; general expat/classifieds
    // communities (housing_focus='secondary') are still surfaced — per user
    // request they should not be excluded — but rank lower than a dedicated
    // group when one exists for the same location/language.
    const audienceMatch = c.housing_focus === 'secondary'
      ? 0.35
      : (c.topics ?? []).some((t) => ['investor','investment','real estate','property'].some((k) => t.toLowerCase().includes(k))) ? 0.8 : 0.4;

    const activityScore = c.member_count
      ? Math.min(c.member_count / 50000, 1) * 0.7 + 0.3
      : 0.3;

    const typeMatch = c.posting_policy === 'OPEN' ? 1.0 : c.posting_policy === 'APPROVAL_REQUIRED' ? 0.6 : 0.2;

    const score = parseFloat((
      locationMatch * 0.30 +
      langMatch * 0.20 +
      topicMatch * 0.20 +
      audienceMatch * 0.15 +
      activityScore * 0.10 +
      typeMatch * 0.05
    ).toFixed(2));

    return {
      community_id: c.id,
      score: Math.min(score, 1.0),
      rationale: {
        location_match: parseFloat(locationMatch.toFixed(2)),
        type_match: parseFloat(typeMatch.toFixed(2)),
        language_match: parseFloat(langMatch.toFixed(2)),
        audience_match: parseFloat(audienceMatch.toFixed(2)),
        topic_match: parseFloat(topicMatch.toFixed(2)),
        activity_score: parseFloat(activityScore.toFixed(2)),
        summary: `loc=${(locationMatch * 100).toFixed(0)}% lang=${(langMatch * 100).toFixed(0)}% topic=${(topicMatch * 100).toFixed(0)}%`,
      },
    };
  }).sort((a, b) => b.score - a.score);
}

/** Canonical URL deduplication key for a community */
export function canonicalizeCommunityUrl(url: string): string {
  try {
    const u = new URL(url.trim().toLowerCase());
    // Remove tracking params
    ['utm_source','utm_medium','utm_campaign','ref','referral'].forEach((p) => u.searchParams.delete(p));
    // Normalize trailing slash
    u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    return u.origin + u.pathname;
  } catch {
    return url.trim().toLowerCase();
  }
}

/** Mock discovery — returns empty (no external calls allowed) */
export async function mockDiscoverCommunities(
  _query: string,
  _platform: string
): Promise<CommunityRecord[]> {
  // MOCK: no network calls
  console.log('[community_adapter] MOCK: discovery suppressed (community_discovery_enabled=false)');
  return [];
}

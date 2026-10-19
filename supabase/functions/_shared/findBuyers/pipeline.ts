// FIND BUYERS — what happens to one provider run's items.
//
//   groups    → source registry (reusable intelligence) → group-posts follow-ups
//   posts     → content intelligence (raw_signals) → similarity gate →
//               a request is itself a lead; a comparable listing earns a
//               comments follow-up only when the gate says so
//   comments  → intent with the parent's context → leads
//
// Content already stored is not re-bought and not re-classified: its stored
// verdict is reused (same fingerprint, same campaign kind, same parent bucket).

import type { NormalizedItem } from '../../../../src/research-core/findBuyers/normalize.ts';
import type { PropertyDna } from '../../../../src/research-core/findBuyers/propertyDna.ts';
import type { Stage } from '../../../../src/research-core/findBuyers/actorInputs.ts';
import { STAGE_ACTOR, STAGE_NETWORK } from '../../../../src/research-core/findBuyers/actorInputs.ts';
import { extractTextFacts, type TextFacts } from '../../../../src/research-core/findBuyers/textFacts.ts';
import { scoreSimilarity, decideComments, type FxToUsd } from '../../../../src/research-core/findBuyers/similarity.ts';
import {
  classifyByRules, boundModelVerdict, INTENT_MODEL_SCHEMA, INTENT_SYSTEM_PROMPT, QUALIFYING,
  type IntentContext, type IntentVerdict,
} from '../../../../src/research-core/findBuyers/intent.ts';
import { personKey, contentFingerprint } from '../../../../src/research-core/findBuyers/identity.ts';
import { scoreLead, queriesMatchingText, type LeadSignal } from '../../../../src/research-core/findBuyers/leadScore.ts';
import { detectLanguage } from '../../../../src/research-core/findBuyers/languages.ts';
import { buildWhy, type WhyMatched } from '../../../../src/research-core/findBuyers/explain.ts';
import { cityMentioned, mentionsPlace } from '../../../../src/research-core/findBuyers/places.ts';
import { judgeFreshness, MAX_SIGNAL_AGE_DAYS } from '../../../../src/research-core/findBuyers/freshness.ts';
import { dateProvenance, emptyDispositions, freshnessBucket, hardGate, publicIntent, type DispositionCounts } from '../../../../src/research-core/findBuyers/demandTaxonomy.ts';
import { classifyDemand, classifyComment, boundModelReading, withAuthorEvidence, ADVERTISER_ROLES, DEMAND_MODEL_SCHEMA, DEMAND_SYSTEM_PROMPT, type DemandReading, type DemandRole } from '../../../../src/research-core/findBuyers/demandClassifier.ts';
import { classifyBuyerIntent } from '../../../../src/research-core/findBuyers/buyerIntent.ts';
import { decideCommentSampling } from '../../../../src/research-core/findBuyers/commentSampling.ts';
import { qualify, legacyIntentClass, QUALIFICATION_VERSION, type Qualification } from '../../../../src/research-core/findBuyers/qualify.ts';
import { duplicateKey } from '../../../../src/research-core/findBuyers/requalify.ts';
import { sourceRelevance } from '../../../../src/research-core/findBuyers/sourceRelevance.ts';
import { openAiJson, recordAiCost, type PriceBook } from './openai.ts';
import { classifyCandidates } from './aiClassify.ts';
import { campaignAiGate } from './campaign.ts';
import { aiCallCeilingMicros, DEFAULT_AI_HEADROOM_PER_ITEM_MICROS, type AiSpendGate } from '../../../../src/research-core/findBuyers/executionBudget.ts';
import { AI_CLASSIFIER_VERSION, AI_MAX_ITEMS_PER_RUN, aiCandidateKey, applyAiVerdict, parseAiVerdict } from '../../../../src/research-core/findBuyers/aiClassifier.ts';

export interface CampaignRow {
  matching_job_id: string;
  campaign_id: string | null;
  property_id: string;
  user_id: string;
  transaction: 'SALE' | 'RENT';
  dna: PropertyDna;
}

export interface ParentContext {
  externalId: string;
  url: string | null;
  signalId: string | null;
  similarity: number;
  stance: 'OFFER' | 'REQUEST' | null;
  /** What the parent post is (a sale listing, a rental request …). */
  role?: DemandRole | null;
  excerpt: string | null;
  facts: TextFacts | null;
  ageDays: number | null;
  /** The parent's own date: bounds the age of an undated comment under it. */
  publishedAt?: string | null;
  /** Total comments the platform reported for this post (null = not reported). */
  commentCount?: number | null;
  /** 0 for the first comment sample of this post, 1 after one expansion. */
  sampleDepth?: number;
  /** Where the post was found: a Facebook GROUP, a public PAGE, or a keyword SEARCH. */
  sourceKind?: 'GROUP' | 'PAGE' | 'SEARCH' | 'AD' | null;
}

/** The kind of source a stage reads (Groups and Pages are kept apart in results). */
export function sourceKindOf(stage: Stage): 'GROUP' | 'PAGE' | 'SEARCH' | 'AD' | null {
  if (stage === 'FB_GROUP_POSTS') return 'GROUP';
  if (stage === 'FB_PAGE_POSTS') return 'PAGE';
  if (stage === 'FB_AD_LIBRARY') return 'AD';
  if (stage === 'FB_POST_SEARCH' || stage === 'FB_KEYWORD_SEARCH') return 'SEARCH';
  return null;
}

/** Post stages whose comparable listings are worth reading the comments of. */
const LISTING_POST_STAGES: readonly Stage[] = ['FB_GROUP_POSTS', 'FB_POST_SEARCH', 'FB_PAGE_POSTS', 'FB_AD_LIBRARY', 'IG_PROFILE_POSTS', 'TIKTOK_SEARCH', 'REDDIT_SEARCH'];

/** The comments stage for a post stage (null: none). */
export function commentsStageFor(stage: Stage): Stage | null {
  if (stage === 'FB_GROUP_POSTS' || stage === 'FB_POST_SEARCH' || stage === 'FB_PAGE_POSTS') return 'FB_COMMENTS';
  if (stage === 'IG_PROFILE_POSTS') return 'IG_COMMENTS';
  if (stage === 'TIKTOK_SEARCH') return 'TIKTOK_COMMENTS';
  if (stage === 'REDDIT_SEARCH') return 'REDDIT_COMMENTS';
  return null;
}

/** Page feeds a keyword search may open per run (budget-bounded, deduplicated by author). */
const MAX_PAGE_FOLLOWUPS = 3;

export interface FollowUp {
  stage: Stage;
  targetUrl: string;
  sourceId: string | null;
  language: string;
  reason: string;
  parent?: ParentContext;
  /** Requested results (an adaptive comment expansion); default = the configured probe. */
  size?: number;
}

export interface PipelineCtx {
  db: any;
  campaign: CampaignRow;
  stage: Stage;
  runId: string;
  runLanguage: string | null;
  datasetId: string | null;
  providerRunId: string | null;
  book: PriceBook;
  gate: { skipBelow: number; eligibleFrom: number };
  fx?: FxToUsd;
  /** DOWN_PAYMENT_LOW risk ratio (admin setting find_buyers_financing); qualify's default when absent. */
  lowDownPaymentRatio?: number;
  /** The parent post when this run fetched one post's comments. */
  parent: ParentContext | null;
  /** Adaptive comment sampling: the configured first-sample size and the Actor maximum. */
  commentProbe?: number;
  commentMaxResults?: number;
  /** The source (group/community/profile) this run read, when known. */
  sourceId: string | null;
  sourceYield: number | null;
  now?: number;
  /** Judging comments HOMATCH already stored: read them, never re-write them. */
  reusing?: boolean;
  /** The items ARE stored rows of another collector (native Telegram): their external ids are
   *  used verbatim (no m23: prefix) and, with `reusing`, nothing is upserted or re-written. */
  verbatimIds?: boolean;
  /** AI-first classification (v11); false only when admin_settings.find_buyers_ai_first is false. */
  aiFirst?: boolean;
  /** The search phrases of a keyword / post-search run (provenance on each lead). */
  searchQueries?: string[] | null;
  /** OpenAI spend gate shared by this run's calls (executionBudget.ts); built from the campaign's spend when absent. */
  aiGate?: AiSpendGate;
  /** Classification headroom other in-flight runs keep (find_buyers_ai_headroom_micros_per_item). */
  aiHeadroomPerItemMicros?: number;
}

export interface PipelineResult {
  items: number;
  useful: number;
  qualified: number;
  strong: number;
  /** Genuine seekers kept as Weak matches (a soft mismatch or unknowns). */
  weak: number;
  /** Rejected candidates by explicit reason (JOB_SEARCH, WRONG_TRANSACTION …). */
  rejected: Record<string, number>;
  duplicates: number;
  reused: number;
  /** Older than 30 days, undated or badly dated: dropped before persistence. */
  staleDropped: number;
  groupsFound: number;
  followUps: FollowUp[];
  aiCalls: number;
  /** Candidates left UNVERIFIED because the execution budget could not cover their classification. */
  aiBudgetRefused?: number;
  /** One primary disposition per content candidate (groups/communities excluded); sums to candidates. */
  dispositions: DispositionCounts;
  candidates: number;
  /** The adaptive sampling decision of a comment run (absent for posts). */
  commentSampling?: { decision: string; analyzed: number; interested: number; total: number | null };
}

const DAY = 86_400_000;
const REAL_ESTATE_TERMS = /(apartment|flat|real estate|property|rent|квартир|недвижим|аренд|ბინ|უძრავ|ქირ|emlak|daire|kiral|عقار|شقق|شقة|إيجار|דירות|נדל|השכרה)/i;
const ageDaysOf = (iso: string | null, now: number) => (iso ? Math.max(0, (now - Date.parse(iso)) / DAY) : null);
const clip = (s: string | null | undefined, n: number) => (s ? (s.length > n ? `${s.slice(0, n - 1)}…` : s) : null);

/** Two slices of one run (a batched read, batching.ts) as one result. */
export function mergeResults(a: PipelineResult, b: PipelineResult): PipelineResult {
  const sumRec = <K extends string>(x: Record<K, number>, y: Record<K, number>) =>
    Object.fromEntries([...new Set([...Object.keys(x), ...Object.keys(y)])].map((k) => [k, Number((x as any)[k] ?? 0) + Number((y as any)[k] ?? 0)])) as Record<K, number>;
  return {
    items: a.items + b.items, useful: a.useful + b.useful, qualified: a.qualified + b.qualified, strong: a.strong + b.strong, weak: a.weak + b.weak,
    rejected: sumRec(a.rejected, b.rejected), duplicates: a.duplicates + b.duplicates, reused: a.reused + b.reused, staleDropped: a.staleDropped + b.staleDropped,
    groupsFound: a.groupsFound + b.groupsFound, followUps: [...a.followUps, ...b.followUps], aiCalls: a.aiCalls + b.aiCalls,
    ...(a.aiBudgetRefused || b.aiBudgetRefused ? { aiBudgetRefused: (a.aiBudgetRefused ?? 0) + (b.aiBudgetRefused ?? 0) } : {}),
    dispositions: sumRec(a.dispositions, b.dispositions), candidates: a.candidates + b.candidates,
    ...(a.commentSampling ?? b.commentSampling ? { commentSampling: a.commentSampling ?? b.commentSampling } : {}),
  };
}

export async function processItems(ctx: PipelineCtx, items: NormalizedItem[]): Promise<PipelineResult> {
  const out: PipelineResult = { items: items.length, useful: 0, qualified: 0, strong: 0, weak: 0, rejected: {}, duplicates: 0, reused: 0, staleDropped: 0, groupsFound: 0, followUps: [], aiCalls: 0, dispositions: emptyDispositions(), candidates: 0 };
  if (!items.length) return out;
  const groups = items.filter((i) => i.kind === 'GROUP');
  if (groups.length) await processGroups(ctx, groups, out);
  const content = items.filter((i) => i.kind !== 'GROUP');
  if (content.length) await processContent(ctx, content, out);
  return out;
}

/* ── groups → registry ─────────────────────────────────────────────────── */

async function processGroups(ctx: PipelineCtx, groups: NormalizedItem[], out: PipelineResult) {
  const { db, campaign } = ctx;
  const network = STAGE_NETWORK[ctx.stage];
  /* Relevance from the group's own name/description: job boards, off-topic
     and (for a SALE search) rental-only groups are never paid for. */
  const scored = groups
    .filter((g) => g.group && g.group.isPublic !== false && g.group.url)
    .map((g) => {
      const rel = sourceRelevance(g.text, campaign.dna, g.group?.members ?? 0);
      return { g, score: rel.score, rel };
    })
    .filter((x) => x.rel.readable)
    .sort((a, b) => b.score - a.score);
  out.groupsFound = scored.length;
  out.useful += scored.length;
  for (const { g, score } of scored.slice(0, 12)) {
    const row = {
      platform: network,
      source_type: network === 'LINKEDIN' ? 'LINKEDIN_GROUP' : 'FACEBOOK_GROUP',
      external_id: String(g.group!.id),
      name: g.group!.name ?? 'group',
      url: g.group!.url,
      country_code: campaign.dna.countryCode,
      language: ctx.runLanguage && ctx.runLanguage !== 'multi' ? ctx.runLanguage : null,
      languages: ctx.runLanguage && ctx.runLanguage !== 'multi' ? [ctx.runLanguage] : [],
      city: campaign.dna.city,
      member_count: g.group!.members,
      description: clip(g.group!.description, 1000),
      provider: 'APIFY_MEMO23',
      discovered_via: `memo23:${ctx.stage}`,
      source_family: 'PUBLIC_COMMUNITY',
      access_state: 'PUBLIC',
      /* Discovery registers; it never switches a source on for other collectors. */
      active: false,
      quality_score: Math.round(score * 100) / 10,
      relevance: { score, reasons: scored.find((x) => x.g === g)?.rel.reasons ?? [], dnaKey: campaign.dna.dnaKey, transaction: campaign.transaction },
      /* No last_checked_at here: discovering a group is not reading it; its
         first read must cover the full 30-day window. */
    };
    const { data: existing } = await db.from('source_registry').select('id,languages,last_checked_at').eq('platform', network).eq('external_id', row.external_id).maybeSingle();
    let sourceId: string | null = existing?.id ?? null;
    if (existing) {
      const langs = [...new Set([...(existing.languages ?? []), ...row.languages])];
      await db.from('source_registry').update({ languages: langs, member_count: row.member_count }).eq('id', existing.id);
    } else {
      const { data: ins } = await db.from('source_registry').insert(row).select('id').maybeSingle();
      sourceId = ins?.id ?? null;
    }
    /* Facebook groups → read their recent posts next (LinkedIn has no group-posts Actor here).
       A group another campaign read in the last RECENT_GROUP_READ_HOURS is not read again
       (owner, 2026-10-18: discovery must bring NEW groups); never-read groups go first. */
    const readRecently = existing?.last_checked_at && Date.now() - Date.parse(existing.last_checked_at) < RECENT_GROUP_READ_HOURS * 3_600_000;
    if (network === 'FACEBOOK' && g.group!.url && !readRecently) {
      out.followUps.push({ stage: 'FB_GROUP_POSTS', targetUrl: g.group!.url, sourceId, language: ctx.runLanguage ?? 'multi', reason: 'discovered_group', isNew: !existing } as any);
    }
  }
  out.followUps = [...out.followUps].sort((a: any, b: any) => Number(Boolean(b.isNew)) - Number(Boolean(a.isNew)))
    .map(({ isNew: _n, ...f }: any) => f).slice(0, 4);
}

/** A discovered group read by any campaign within this many hours is not re-read as a discovery follow-up. */
export const RECENT_GROUP_READ_HOURS = 72;

/** A public Facebook Page URL from a post author link (null for groups, posts or non-Facebook links). */
export function pageUrlOf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (!/(^|\.)facebook\.com$/i.test(u.hostname)) return null;
    const path = u.pathname.replace(/\/+$/, '');
    if (!path || /^\/(groups|events|photo|photos|watch|reel|story|stories|share|permalink|posts|marketplace|hashtag|search)(\/|$)/i.test(path)) return null;
    if (/^\/profile\.php$/i.test(path)) {
      const id = u.searchParams.get('id');
      return id && /^\d+$/.test(id) ? `https://www.facebook.com/profile.php?id=${id}` : null;
    }
    const slug = path.split('/').filter(Boolean)[0];
    return slug ? `https://www.facebook.com/${slug}` : null;
  } catch { return null; }
}

async function registerPageSource(ctx: PipelineCtx, url: string, name: string | null, language: string | null): Promise<string | null> {
  const { db, campaign } = ctx;
  const externalId = `page:${url.toLowerCase()}`;
  const { data: existing } = await db.from('source_registry').select('id').eq('platform', 'FACEBOOK').eq('external_id', externalId).maybeSingle();
  if (existing?.id) return existing.id;
  const lang = language && language !== 'multi' ? language : null;
  const { data: ins } = await db.from('source_registry').insert({
    platform: 'FACEBOOK', source_type: 'SOCIAL_PROFILE', external_id: externalId, name: clip(name, 200) ?? 'Facebook Page', url,
    country_code: campaign.dna.countryCode, language: lang, languages: lang ? [lang] : [], city: campaign.dna.city,
    provider: 'APIFY_MEMO23', discovered_via: `memo23:${ctx.stage}`, source_family: 'OTHER', access_state: 'PUBLIC',
    /* Discovery registers; it never switches a source on for other collectors. */
    active: false,
  }).select('id').maybeSingle();
  return ins?.id ?? null;
}

/* ── posts / comments ──────────────────────────────────────────────────── */

interface Assessed {
  /** Comments of the parent post read in this run (null for posts). */
  parentAnalyzed?: number | null;
  item: NormalizedItem;
  signalId: string;
  facts: TextFacts;
  similarity: number;
  simResult: ReturnType<typeof scoreSimilarity>;
  ageDays: number | null;
  language: string | null;
  parent: ParentContext | null;
  ctx: IntentContext;
  verdict: IntentVerdict | null;
  cacheKey: string;
  /** The AI classification key (aiClassifier.ts aiCandidateKey) when the item was sent to the model. */
  aiKey?: string;
  commentsDecision: string | null;
  fingerprint: string;
  why: WhyMatched;
  reading: DemandReading;
  qualification: Qualification | null;
  dupKeys: string[];
}

async function processContent(ctx: PipelineCtx, items: NormalizedItem[], out: PipelineResult) {
  const { db, campaign } = ctx;
  const now = ctx.now ?? Date.now();
  const network = STAGE_NETWORK[ctx.stage];

  /* Flatten inline comments (VK/Quora deliver them inside the post), then the
     30-DAY RULE: nothing older than 30 days, undated or badly dated is stored,
     classified or scored. An undated comment survives only under a fresh,
     dated parent (it cannot be older than what it answers). */
  const flat: Array<{ item: NormalizedItem; inlineParent: NormalizedItem | null; ageDays: number | null }> = [];
  for (const it of items) {
    const postVerdict = judgeFreshness(it, ctx.parent?.publishedAt ?? null, { now, maxDays: MAX_SIGNAL_AGE_DAYS });
    out.candidates++;
    if (postVerdict.keep) flat.push({ item: it, inlineParent: null, ageDays: postVerdict.ageDays });
    else { out.staleDropped++; out.dispositions[postVerdict.reason === 'STALE' ? 'STALE' : 'UNDATED']++; }
    for (const c of it.inlineComments) {
      /* A stale post's comments are judged on their own dates only. */
      const v = judgeFreshness(c, postVerdict.keep ? it.publishedAt : null, { now, maxDays: MAX_SIGNAL_AGE_DAYS });
      out.candidates++;
      if (v.keep) flat.push({ item: c, inlineParent: postVerdict.keep ? it : null, ageDays: v.ageDays });
      else { out.staleDropped++; out.dispositions[v.reason === 'STALE' ? 'STALE' : 'UNDATED']++; }
    }
  }
  if (!flat.length) return;
  const extId = (i: NormalizedItem) => (ctx.verbatimIds ? i.externalId : `m23:${i.externalId}`).slice(0, 500);

  /* What HOMATCH already knows (content reuse, no reclassification). */
  const ids = flat.map((f) => extId(f.item));
  const known = await inChunks(ids, (part) => db.from('raw_signals').select('id,external_id,content_fingerprint,intent_json').eq('platform', network).in('external_id', part));
  const knownMap = new Map(known.map((r) => [r.external_id, r]));

  const rows = flat.map(({ item, inlineParent }) => ({
    platform: network,
    external_id: extId(item),
    source_id: ctx.sourceId,
    source_url: item.url,
    author_public_name: clip(item.author.name, 200),
    author_public_url: item.author.url,
    profile_url: item.author.url,
    original_text: clip(item.text, 4000),
    language: detectLanguage(item.text),
    published_at: item.publishedAt,
    last_seen_at: new Date(now).toISOString(),
    content_fingerprint: contentFingerprint(item.text),
    provider: 'APIFY_MEMO23',
    actor_run_id: ctx.providerRunId,
    actor_dataset_id: ctx.datasetId,
    parent_url: inlineParent?.url ?? item.parentUrl ?? ctx.parent?.url ?? null,
    parent_external_id: inlineParent ? extId(inlineParent) : item.parentExternalId ? `m23:${item.parentExternalId}` : null,
    parent_excerpt: clip(inlineParent?.text ?? ctx.parent?.excerpt ?? null, 500),
    content_type: item.kind,
    access_class: 'PUBLIC',
    acquisition_mode: 'PUBLIC_WEB',
    research_direction: 'UNKNOWN',
    /* Never PENDING: classify-signals-v2 must not re-classify (and re-pay for) these. */
    classification_status: 'FILTERED_OUT',
  }));
  /* One row per external id (inline comments and truncated ids can repeat;
     a repeated key would fail the whole upsert). Reused comments are not
     re-written: their attribution and last_seen_at stay the original's. */
  const unique = [...new Map(rows.map((r) => [r.external_id, r])).values()];
  let idMap: Map<string, string>;
  if (ctx.reusing) {
    idMap = new Map(knownMap.size ? [...knownMap.values()].map((r: any) => [r.external_id, r.id as string]) : []);
  } else {
    const { data: upserted, error } = await db.from('raw_signals')
      .upsert(unique, { onConflict: 'platform,external_id', ignoreDuplicates: false })
      .select('id,external_id');
    if (error) throw error;
    idMap = new Map(((upserted ?? []) as any[]).map((r) => [r.external_id, r.id as string]));
  }

  /* Already assessed for THIS campaign → a duplicate, skip. */
  const signalIds = [...idMap.values()];
  const done = await inChunks(signalIds, (part) => db.from('find_buyers_assessments').select('signal_id').eq('matching_job_id', campaign.matching_job_id).in('signal_id', part));
  const doneSet = new Set(done.map((r) => r.signal_id));

  const assessed: Assessed[] = [];
  const postCtx = new Map<string, ParentContext>();
  /* Authors who advertise homes in this read: their "looking for" posts are a broker's. */
  const authorKey = (it: { author: { id?: string | null; url?: string | null; name?: string | null } }) => it.author.id ?? it.author.url ?? it.author.name ?? null;
  const advertisers = new Set(flat.filter(({ item }) => item.kind === 'POST' && ADVERTISER_ROLES.includes(classifyDemand(item.text).role))
    .map(({ item }) => authorKey(item)).filter((k): k is string => Boolean(k)));
  for (const { item, inlineParent, ageDays: freshAge } of flat) {
    const signalId = idMap.get(extId(item));
    if (!signalId) { out.dispositions.UNDECIDED++; continue; }
    if (doneSet.has(signalId)) { out.duplicates++; out.dispositions.DUPLICATE++; continue; }
    const fingerprint = contentFingerprint(item.text);
    const prior = knownMap.get(extId(item));
    if (prior && prior.content_fingerprint === fingerprint) out.reused++;
    const facts = extractTextFacts(item.text);
    const ageDays = ageDaysOf(item.publishedAt, now) ?? freshAge;
    let parent: ParentContext | null = null;
    if (item.kind === 'COMMENT') parent = inlineParent ? (postCtx.get(inlineParent.externalId) ?? null) : ctx.parent;
    const simResult = item.kind === 'COMMENT' && parent?.facts
      ? scoreSimilarity(campaign.dna, parent.facts, { ageDays: parent.ageDays, fxToUsd: ctx.fx })
      : scoreSimilarity(campaign.dna, facts, { ageDays, fxToUsd: ctx.fx });
    const similarity = item.kind === 'COMMENT' ? (parent?.similarity ?? simResult.score) : simResult.score;
    const ictx: IntentContext = {
      campaign: campaign.transaction,
      kind: item.kind === 'COMMENT' ? 'COMMENT' : network === 'TELEGRAM' ? 'MESSAGE' : 'POST',
      parentSimilarity: item.kind === 'COMMENT' ? similarity : null,
      parentStance: parent?.stance ?? null,
    };
    const cacheKey = `v2:${fingerprint}:${campaign.transaction}:${ictx.kind}:${ictx.parentSimilarity == null ? 'x' : Math.floor(ictx.parentSimilarity / 10)}:${parent?.role ?? ictx.parentStance ?? 'x'}`;
    /* Who is speaking and what they want — deterministic first. A model
       resolution stored for the same words/context is reused (never re-paid). */
    let reading = item.kind === 'COMMENT'
      ? classifyComment(item.text, parent ? { role: parent.role ?? (parent.stance === 'OFFER' ? (campaign.transaction === 'RENT' ? 'RENT_OFFER' : 'SALE_OFFER') : null), similarity } : null)
      : classifyDemand(item.text, { kind: ictx.kind });
    const cached = prior?.intent_json?.m23cache?.[cacheKey];
    if (reading.needsModel && cached?.role) reading = boundModelReading(reading, { role: cached.role, transaction: cached.transaction });
    const aKey = authorKey(item);
    reading = withAuthorEvidence(reading, { name: item.author.name, alsoAdvertises: aKey != null && advertisers.has(aKey) });
    if (item.kind === 'POST') {
      postCtx.set(item.externalId, {
        externalId: item.externalId, url: item.url, signalId, similarity, stance: facts.stance, role: reading.role,
        excerpt: clip(item.text, 300), facts, ageDays, publishedAt: item.publishedAt,
        commentCount: Number.isFinite(item.engagement?.comments) ? Number(item.engagement.comments) : null,
        sourceKind: sourceKindOf(ctx.stage),
      });
    }
    const verdict: IntentVerdict | null = null;
    /* Comments are worth paying for only under a listing comparable to the
       owner's property (buyers ask there); never under someone's request.
       An unknown comment count is not zero (the Actor may not report it). */
    let commentsDecision: string | null = null;
    const listingRole = campaign.transaction === 'RENT' ? 'RENT_OFFER' : 'SALE_OFFER';
    if (item.kind === 'POST' && reading.role === listingRole && LISTING_POST_STAGES.includes(ctx.stage)) {
      commentsDecision = decideComments(similarity, { commentCount: item.engagement.comments, ageDays, sourceYield: ctx.sourceYield }, ctx.gate);
    } else if (item.kind === 'POST') commentsDecision = reading.role === 'BUY_SEEKER' || reading.role === 'RENT_SEEKER' ? 'SKIP_REQUEST' : 'SKIP_NOT_A_LISTING';
    const why = buildWhy(item.kind === 'COMMENT' ? (reading.evidence.includes('interest_under_listing') ? 'COMMENT_ON_SIMILAR' : 'COMMENT_REQUEST') : 'REQUEST_POST',
      item.kind === 'COMMENT' && parent?.facts ? parent.facts : facts, simResult, item.kind === 'COMMENT' ? parent?.ageDays ?? null : ageDays);
    assessed.push({ item, signalId, facts, similarity, simResult, ageDays, language: detectLanguage(item.text), parent, ctx: ictx, verdict, cacheKey, commentsDecision, fingerprint, why,
      reading, qualification: null, dupKeys: duplicateKey({ text: item.text, author: item.author.id ?? item.author.url ?? item.author.name, url: item.url }) });
  }

  /* AI-FIRST (v11, owner 2026-10-18): every unique candidate is classified by the model against
     the Property DNA before qualification — the model decides who is speaking and what they
     want (aiClassifier.ts). Same words in the same context are classified once (per run and,
     through raw_signals.intent_json.aiCache, across campaigns of the same property). A
     candidate without a verdict (call failed, over the per-run bound) is UNVERIFIED: never a
     confident rule-based buyer. Kill switch: admin_settings.find_buyers_ai_first = false. */
  if (ctx.aiFirst !== false) {
    const keyOf = (a: Assessed) => aiCandidateKey(a.item.text, a.ctx.kind, a.parent?.role ?? null, campaign.dna.dnaKey ?? '');
    const byKey = new Map<string, Assessed[]>();
    for (const a of assessed) {
      if (a.item.text.trim().length < 2) continue;
      const k = keyOf(a);
      byKey.set(k, [...(byKey.get(k) ?? []), a]);
    }
    const resolved = new Map<string, any>();
    for (const [k, group] of byKey) {
      const cached = knownMap.get(extId(group[0].item))?.intent_json?.aiCache?.[k];
      if (cached?.role) resolved.set(k, cached);
    }
    const pending = [...byKey.keys()].filter((k) => !resolved.has(k)).slice(0, AI_MAX_ITEMS_PER_RUN);
    if (pending.length) {
      /* Paid from the campaign's execution budget: a batch it cannot afford is not sent. */
      const aiGate = ctx.aiGate ?? await campaignAiGate(db, campaign.matching_job_id ?? null, ctx.aiHeadroomPerItemMicros ?? DEFAULT_AI_HEADROOM_PER_ITEM_MICROS, ctx.runId);
      const { verdicts, stats } = await classifyCandidates(db, {
        gate: aiGate,
        book: ctx.book, dna: campaign.dna, matchingJobId: campaign.matching_job_id,
        keyPrefix: `ai:classify:${ctx.runId}:${ctx.stage}:${ctx.parent?.externalId ?? '-'}`, operation: 'AI_CLASSIFY',
        metadata: { stage: ctx.stage, version: AI_CLASSIFIER_VERSION },
      }, pending.map((k) => {
        const a = byKey.get(k)![0];
        return { id: k, kind: a.ctx.kind, text: a.item.text, parentExcerpt: a.parent?.excerpt ?? null, author: a.item.author.name ?? null };
      }));
      out.aiCalls += stats.calls;
      out.aiBudgetRefused = (out.aiBudgetRefused ?? 0) + stats.budgetRefusedItems;
      for (const [k, v] of verdicts) resolved.set(k, v);
    }
    for (const [k, group] of byKey) {
      const v = resolved.get(k) ? parseAiVerdict(resolved.get(k)) : null;
      for (const a of group) {
        a.reading = applyAiVerdict(a.reading, v ? { ...v, model: resolved.get(k).model } as any : null, a.item.text);
        a.aiKey = k;
        /* The author still decides it: a business-named author or one advertising in this read stays an intermediary. */
        const aKey = authorKey(a.item);
        a.reading = withAuthorEvidence(a.reading, { name: a.item.author.name, alsoAdvertises: aKey != null && advertisers.has(aKey) });
      }
    }
    /* No text to judge: a rule seeker is unverified, a rule rejection stays one. */
    for (const a of assessed) if (!a.aiKey) a.reading = applyAiVerdict(a.reading, null);
  } else {
    /* Kill switch off: the previous behaviour — the model only for ambiguous text. */
    const ambiguous = assessed.filter((a) => a.reading.needsModel && a.reading.realEstate && a.item.text.length >= 3).slice(0, 90);
    const intentGate = ctx.aiGate ?? await campaignAiGate(db, campaign.matching_job_id ?? null, ctx.aiHeadroomPerItemMicros ?? DEFAULT_AI_HEADROOM_PER_ITEM_MICROS, ctx.runId);
    for (let i = 0; i < ambiguous.length; i += 30) {
      const batch = ambiguous.slice(i, i + 30);
      /* Same execution budget: a batch it cannot afford keeps its rule reading (no model call). */
      if (!intentGate.admit(aiCallCeilingMicros(ctx.book, 600 + batch.length * 180, 120 + batch.length * 60))) {
        out.aiBudgetRefused = (out.aiBudgetRefused ?? 0) + batch.length;
        for (const a of batch) a.reading = boundModelReading(a.reading, null);
        continue;
      }
      const res = await openAiJson<{ items: Array<{ id: string; role: string; transaction: string }> }>(ctx.book, DEMAND_SYSTEM_PROMPT, {
        items: batch.map((a, k) => ({
          id: String(k), kind: a.ctx.kind, text: clip(a.item.text, 500),
          parent_excerpt: a.parent?.excerpt ?? null, parent_similarity: a.ctx.parentSimilarity,
        })),
      }, DEMAND_MODEL_SCHEMA, { maxTokens: 120 + batch.length * 60 });
      out.aiCalls++;
      intentGate.spend(res.costMicros);
      await recordAiCost(db, {
        key: `ai:intent:${ctx.runId}:${ctx.stage}:${ctx.parent?.externalId ?? '-'}:${i}`, matchingJobId: campaign.matching_job_id, kind: 'AI', operation: 'INTENT',
        result: res, metadata: { items: batch.length, stage: ctx.stage },
      }).catch(() => undefined);
      const byId = new Map((res.data?.items ?? []).map((x) => [String(x.id), x]));
      batch.forEach((a, k) => {
        const m = byId.get(String(k));
        a.reading = boundModelReading(a.reading, m ? { role: m.role, transaction: m.transaction } : null);
      });
    }
  }

  /* Comments of each parent post read in this run (the post-opportunity "analyzed" count). */
  const analyzedByParent = new Map<string, number>();
  for (const a of assessed) if (a.item.kind === 'COMMENT' && a.parent?.externalId) analyzedByParent.set(a.parent.externalId, (analyzedByParent.get(a.parent.externalId) ?? 0) + 1);
  for (const a of assessed) a.parentAnalyzed = a.parent?.externalId ? analyzedByParent.get(a.parent.externalId) ?? null : null;

  /* Qualification: one explicit decision per candidate. The same words from
     the same author, or the same post URL, count once per campaign. */
  const { data: priorLeads } = await db.from('find_buyers_leads').select('qualification').eq('matching_job_id', campaign.matching_job_id).limit(2000);
  const seenKeys = new Set<string>(((priorLeads ?? []) as any[]).flatMap((r) => (Array.isArray(r.qualification?.dupKeys) ? r.qualification.dupKeys : [])));
  for (const a of assessed) {
    const duplicate = a.dupKeys.some((k) => seenKeys.has(k));
    a.qualification = gateIntent(a, qualify(a.reading, campaign.dna, { ageDays: a.ageDays, duplicate, fx: ctx.fx, lowDownPaymentRatio: ctx.lowDownPaymentRatio }), campaign.transaction === 'RENT' ? 'RENT_OFFER' : 'SALE_OFFER');
    /* Audit: which model and classifier version decided the role, and on what evidence. */
    a.qualification = { ...a.qualification, ai: aiAudit(a.reading) };
    if (a.qualification.category !== 'REJECTED') a.dupKeys.forEach((k) => seenKeys.add(k));
    const counterpart = campaign.transaction === 'RENT' ? 'TENANT' : 'BUYER';
    const intentClass = legacyIntentClass(a.qualification, counterpart) as IntentVerdict['intentClass'];
    a.verdict = {
      intentClass, score: a.qualification.components.intent, needsModel: false,
      method: a.reading.aiVerdict ? 'AI' : a.reading.evidence.includes('ai_unverified') ? 'UNVERIFIED'
        : a.reading.evidence.includes('model_resolved') ? 'MODEL' : a.reading.role === 'UNCLEAR' ? 'UNDECIDED' : 'RULE',
      rule: a.reading.aiVerdict ? a.reading.aiVerdict.role : a.reading.evidence[0] ?? null,
    };
  }

  /* Persist assessments and verdict caches. */
  const assessRows = assessed.map((a) => ({
    matching_job_id: campaign.matching_job_id,
    signal_id: a.signalId,
    parent_signal_id: a.parent?.signalId ?? null,
    content_kind: a.item.kind === 'COMMENT' ? 'COMMENT' : a.ctx.kind === 'MESSAGE' ? 'MESSAGE' : 'POST',
    similarity: Math.round(a.similarity),
    similarity_components: a.simResult.components,
    intent_class: a.verdict?.intentClass ?? 'UNCERTAIN',
    intent_score: a.verdict?.score ?? 20,
    intent_method: a.verdict ? `${a.verdict.method}${a.verdict.rule ? `:${a.verdict.rule}` : ''}` : 'NONE',
    comments_decision: a.commentsDecision,
    language: a.language,
    role: a.reading.role,
    transaction: a.reading.transaction,
    match_category: a.qualification?.category ?? null,
    rejection_reasons: a.qualification?.reasons ?? [],
    budget_fit: a.qualification?.budgetFit ?? null,
    location_fit: a.qualification?.locationFit ?? null,
    requirements_fit: a.qualification?.requirementsFit ?? null,
    qualification: a.qualification ? {
      ...a.qualification, evidence: a.reading.evidence, confidence: a.reading.confidence,
      /* What the platform itself reported for the post (null = not reported), kept so a
         "0 comments" skip can always be told apart from "count not provided". */
      ...(a.item.kind === 'POST' ? { reportedComments: a.item.engagement.comments ?? null, inlineComments: a.item.inlineComments.length, sourceKind: sourceKindOf(ctx.stage) } : {}),
    } : null,
    qualification_version: QUALIFICATION_VERSION,
  }));
  if (assessRows.length) {
    await db.from('find_buyers_assessments').upsert(assessRows, { onConflict: 'matching_job_id,signal_id', ignoreDuplicates: true });
  }
  /* Another collector's stored rows (native Telegram) keep their own classification:
     internal matching reads it, so Find Buyers never re-writes it. */
  for (const a of ctx.verbatimIds ? [] : assessed) {
    if (!a.verdict || a.verdict.method === 'UNDECIDED') continue;
    const qualifying = a.qualification != null && a.qualification.category !== 'REJECTED';
    const prior = knownMap.get(extId(a.item))?.intent_json ?? {};
    await db.from('raw_signals').update({
      classification_status: qualifying ? 'CLASSIFIED' : 'FILTERED_OUT',
      intent_type: a.verdict.intentClass,
      research_direction: a.reading.role === 'BUY_SEEKER' || a.reading.role === 'RENT_SEEKER' ? 'DEMAND'
        : a.reading.role === 'SALE_OFFER' || a.reading.role === 'RENT_OFFER' ? 'SUPPLY' : 'UNKNOWN',
      intent_json: {
        ...prior,
        /* Market side from the text's own transaction (never the campaign's), and date provenance. */
        publicIntent: publicIntent(a.verdict.intentClass, a.reading.transaction === 'BUY' ? 'SALE' : a.reading.transaction === 'RENT' ? 'RENT' : null),
        demand: { role: a.reading.role, transaction: a.reading.transaction, version: QUALIFICATION_VERSION },
        ...(() => { const d = dateProvenance(a.item.publishedAt, a.parent?.publishedAt ?? null);
          return { dateSource: d.dateSource, dateConfidence: d.dateConfidence, freshness: freshnessBucket(d.evidenceAt, now) }; })(),
        m23cache: { ...(prior?.m23cache ?? {}), [a.cacheKey]: { role: a.reading.role, transaction: a.reading.transaction, method: a.verdict.method } },
        ...(a.aiKey && a.reading.aiVerdict ? { aiCache: { ...(prior?.aiCache ?? {}), [a.aiKey]: a.reading.aiVerdict } } : {}),
      },
    }).eq('id', a.signalId);
  }

  /* Usefulness: comparable content or qualifying intent. */
  out.useful += assessed.filter((a) => a.qualification?.category === 'STRONG' || a.qualification?.category === 'POTENTIAL' || (a.commentsDecision ?? '').startsWith('FETCH')).length;

  /* Comments follow-ups for comparable posts, reusing stored comments first. */
  const commentsStage = commentsStageFor(ctx.stage);
  if (commentsStage) {
    const eligible = assessed
      .filter((a) => a.item.kind === 'POST' && (a.commentsDecision === 'FETCH' || a.commentsDecision === 'FETCH_JUSTIFIED') && a.item.url)
      /* A post that arrived with its comments attached was read already: no second, paid
         comments run — for a Page post always, for any other post when the attached comments
         cover what the platform reported (an unknown count is covered by what came). */
      .filter((a) => !(a.item.inlineComments.length > 0 && (ctx.stage === 'FB_PAGE_POSTS'
        || a.item.engagement.comments == null || a.item.inlineComments.length >= Number(a.item.engagement.comments))))
      .sort((x, y) => y.similarity - x.similarity)
      .slice(0, 5);
    for (const a of eligible) {
      const parent = postCtx.get(a.item.externalId)!;
      const reused = await reuseStoredComments(ctx, parent, out);
      if (reused) continue;
      out.followUps.push({ stage: commentsStage, targetUrl: a.item.url!, sourceId: ctx.sourceId, language: a.language ?? 'multi', reason: a.commentsDecision!, parent });
    }
  }

  /* A keyword search found a comparable listing on a public Page (agency,
     developer, competitor): read that Page's recent posts next, once per author,
     at most MAX_PAGE_FOLLOWUPS per run. The Page is registered as a FACEBOOK
     SOCIAL_PROFILE source (never a group), inactive, so later campaigns can reuse it. */
  if (ctx.stage === 'FB_POST_SEARCH' || ctx.stage === 'FB_AD_LIBRARY') {
    const seenPages = new Set<string>();
    const comparable = assessed
      .filter((a) => a.item.kind === 'POST' && (a.commentsDecision === 'FETCH' || a.commentsDecision === 'FETCH_JUSTIFIED'))
      .sort((x, y) => y.similarity - x.similarity);
    for (const a of comparable) {
      const page = pageUrlOf(a.item.author.url);
      if (!page || seenPages.has(page)) continue;
      seenPages.add(page);
      const sourceId = await registerPageSource(ctx, page, a.item.author.name, a.language);
      out.followUps.push({ stage: 'FB_PAGE_POSTS', targetUrl: page, sourceId, language: a.language ?? 'multi', reason: 'comparable_listing_page' });
      if (seenPages.size >= MAX_PAGE_FOLLOWUPS) break;
    }
  }

  /* Leads. Hard gates first (undecided, supply/agent/discussion, the other
     transaction), then ranking; every assessed candidate gets one disposition. */
  for (const a of assessed) {
    const q = a.qualification!;
    if (q.category === 'REJECTED') {
      for (const r of q.reasons) out.rejected[r] = (out.rejected[r] ?? 0) + 1;
      out.dispositions[dispositionOf(q)]++;
      continue;
    }
    const res = await upsertLead(ctx, a);
    /* An interest signal (a question under a comparable listing) is stored and shown on its
       own, never counted as a qualified buyer. */
    if (q.resultType === 'INTEREST' && res !== 'DUPLICATE') { out.weak++; out.dispositions.BELOW_THRESHOLD++; continue; }
    if (res === 'STRONG') { out.qualified++; out.strong++; out.dispositions.QUALIFIED++; }
    else if (res === 'QUALIFIED') { out.qualified++; out.dispositions.QUALIFIED++; }
    else if (res === 'WEAK') { out.weak++; out.dispositions.BELOW_THRESHOLD++; }
    else if (res === 'DUPLICATE') { out.duplicates++; out.dispositions.DUPLICATE++; }
    else out.dispositions.BELOW_THRESHOLD++;
  }

  /* Adaptive comment sampling: read more of this post only when the sample just read
     proved worth it (interest per comment), once, within the Actor maximum. */
  if (ctx.stage.endsWith('COMMENTS') && ctx.parent?.url) {
    const comments = assessed.filter((a) => a.item.kind === 'COMMENT');
    const interested = comments.filter((a) => a.qualification && a.qualification.category !== 'REJECTED'
      && (a.qualification.resultType === 'INTEREST' || a.qualification.resultType === 'DIRECT')).length;
    const plan = decideCommentSampling({
      analyzed: comments.length, interested, total: ctx.parent.commentCount ?? null, depth: ctx.parent.sampleDepth ?? 0,
      probe: ctx.commentProbe ?? comments.length, maxResults: ctx.commentMaxResults ?? 1000,
    });
    out.commentSampling = { decision: plan.decision, analyzed: comments.length, interested, total: ctx.parent.commentCount ?? null };
    if (plan.decision === 'EXPAND' && plan.size) {
      out.followUps.push({ stage: ctx.stage, targetUrl: ctx.parent.url, sourceId: ctx.sourceId, language: ctx.runLanguage ?? 'multi',
        reason: 'EXPAND_COMMENTS', parent: { ...ctx.parent, sampleDepth: (ctx.parent.sampleDepth ?? 0) + 1 }, size: plan.size });
    }
  }
}

/**
 * The buyer intent gate (Find Buyers 3.0), after qualification and before any lead is
 * written: no buyer/tenant intent → REJECTED (INTENT_EXCLUDED), whatever the score; a
 * meaningful question under a comparable listing → an INTEREST signal (kept, at most
 * POTENTIAL, never counted as qualified). Exported for tests.
 */
export function gateIntent(a: Pick<Assessed, 'item' | 'ctx' | 'parent' | 'similarity' | 'reading'>, q: Qualification, listingRole: DemandRole): Qualification {
  const parentRole = a.parent ? (a.parent.role ?? (a.parent.stance === 'OFFER' ? listingRole : null)) : null;
  const intent = classifyBuyerIntent({ text: a.item.text, kind: a.ctx.kind, parent: a.parent ? { role: parentRole, similarity: a.similarity } : null, reading: a.reading });
  const tagged = { ...q, intent: intent.intent, resultType: intent.resultType, signals: intent.signals };
  if (intent.resultType === 'EXCLUDED') {
    return q.category === 'REJECTED' ? tagged : { ...tagged, category: 'REJECTED', reasons: [...q.reasons, 'INTENT_EXCLUDED'] };
  }
  if (intent.resultType === 'INTEREST') {
    /* A bare question ("price?") is undecided for the classifier; as interest it is kept —
       but never above POTENTIAL, and never for a stale, duplicate or other-market comment. */
    const onlyUnclear = q.category === 'REJECTED' && q.reasons.every((r) => r === 'UNCLEAR_INTENT');
    const category = onlyUnclear ? 'WEAK' : q.category === 'STRONG' ? 'POTENTIAL' : q.category;
    return { ...tagged, category, reasons: onlyUnclear ? [] : q.reasons };
  }
  return tagged;
}

/** What the AI decided for this candidate, for the assessment and the lead (auditable). */
export function aiAudit(r: DemandReading): Record<string, unknown> | null {
  if (r.aiVerdict) return { version: AI_CLASSIFIER_VERSION, status: 'CLASSIFIED', model: r.aiVerdict.model ?? null, ...r.aiVerdict };
  if (r.evidence.includes('ai_unverified')) return { version: AI_CLASSIFIER_VERSION, status: 'UNVERIFIED' };
  return null;
}

/** The one disposition a rejected candidate counts under (funnel totals). */
function dispositionOf(q: Qualification): keyof DispositionCounts {
  if (q.reasons.includes('DUPLICATE')) return 'DUPLICATE';
  if (q.reasons.includes('STALE')) return 'STALE';
  if (q.reasons.includes('UNDATED')) return 'UNDATED';
  if (q.reasons.includes('WRONG_TRANSACTION')) return 'WRONG_TRANSACTION';
  if (q.reasons.includes('UNCLEAR_INTENT')) return 'UNDECIDED';
  if (q.reasons.includes('BUDGET_INCOMPATIBLE') || q.reasons.includes('OTHER_CITY') || q.reasons.includes('PROPERTY_TYPE_MISMATCH') || q.reasons.includes('NON_RESIDENTIAL')) return 'BELOW_THRESHOLD';
  return 'WRONG_INTENT';
}

/** PostgREST puts .in() lists in the URL: read them 60 at a time. */
async function inChunks(values: string[], query: (part: string[]) => PromiseLike<{ data: unknown; error: unknown }>): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < values.length; i += 60) {
    const { data, error } = await query(values.slice(i, i + 60));
    if (error) throw error;
    out.push(...((data ?? []) as any[]));
  }
  return out;
}

/** Comments HOMATCH already bought for this post in the last day: judge them again, pay nothing. */
async function reuseStoredComments(ctx: PipelineCtx, parent: ParentContext, out: PipelineResult): Promise<boolean> {
  const since = new Date((ctx.now ?? Date.now()) - DAY).toISOString();
  const network = STAGE_NETWORK[ctx.stage];
  const { data } = await ctx.db.from('raw_signals')
    .select('external_id,original_text,source_url,author_public_name,author_public_url,published_at,parent_url')
    .eq('platform', network).eq('parent_external_id', `m23:${parent.externalId}`).eq('content_type', 'COMMENT')
    .gte('last_seen_at', since)
    /* 30-day rule on reuse too: dated and fresh, or undated under this fresh parent. */
    .or(`published_at.gte.${new Date((ctx.now ?? Date.now()) - MAX_SIGNAL_AGE_DAYS * DAY).toISOString()},published_at.is.null`)
    .limit(200);
  const rows = (data ?? []) as any[];
  if (!rows.length) return false;
  const items: NormalizedItem[] = rows.map((r) => ({
    kind: 'COMMENT', network, externalId: String(r.external_id).replace(/^m23:/, ''), url: r.source_url,
    parentExternalId: parent.externalId, parentUrl: parent.url,
    author: { id: null, name: r.author_public_name, url: r.author_public_url, handle: null },
    text: r.original_text ?? '', publishedAt: r.published_at, engagement: { comments: null, likes: null, shares: null },
    group: null, inlineComments: [],
  }));
  const commentStage: Stage = commentsStageFor(ctx.stage) ?? ctx.stage;
  const sub = await processItems({ ...ctx, parent, stage: commentStage, reusing: true }, items);
  out.reused += items.length;
  out.qualified += sub.qualified; out.strong += sub.strong; out.duplicates += sub.duplicates; out.useful += sub.useful;
  out.staleDropped += sub.staleDropped;
  out.candidates += sub.candidates;
  for (const [d, n] of Object.entries(sub.dispositions)) out.dispositions[d as keyof DispositionCounts] += n;
  return true;
}

const CATEGORY_RANK: Record<string, number> = { STRONG: 3, POTENTIAL: 2, WEAK: 1, REJECTED: 0 };
const STRENGTH_OF: Record<string, 'STRONG' | 'GOOD' | 'POSSIBLE'> = { STRONG: 'STRONG', POTENTIAL: 'GOOD', WEAK: 'POSSIBLE' };

async function upsertLead(ctx: PipelineCtx, a: Assessed): Promise<'QUALIFIED' | 'STRONG' | 'WEAK' | 'BELOW' | 'DUPLICATE'> {
  const { db, campaign } = ctx;
  const network = STAGE_NETWORK[ctx.stage];
  const key = personKey(network, a.item.author, a.item.externalId);
  const nowIso = new Date(ctx.now ?? Date.now()).toISOString();
  let { data: person } = await db.from('find_buyers_persons').select('id,signal_count,campaigns_seen').eq('network', network).eq('person_key', key).maybeSingle();
  if (!person) {
    const { data: ins, error } = await db.from('find_buyers_persons').insert({
      network, person_key: key, display_name: clip(a.item.author.name, 200), profile_url: a.item.author.url,
      first_seen_at: nowIso, last_seen_at: nowIso, signal_count: 1,
    }).select('id,signal_count,campaigns_seen').maybeSingle();
    if (error && String(error.code) === '23505') {
      ({ data: person } = await db.from('find_buyers_persons').select('id,signal_count,campaigns_seen').eq('network', network).eq('person_key', key).maybeSingle());
    } else person = ins;
  } else {
    await db.from('find_buyers_persons').update({ last_seen_at: nowIso, signal_count: Number(person.signal_count || 0) + 1 }).eq('id', person.id);
  }
  if (!person) return 'BELOW';

  /* Campaign-delivery dedupe: this property already received this person for this exact signal. */
  const { data: earlier } = await db.from('find_buyers_leads').select('id,matching_job_id,property_id,best_signal_id,evidence')
    .eq('person_id', person.id).neq('matching_job_id', campaign.matching_job_id).limit(20);
  const earlierRows = (earlier ?? []) as any[];
  const seenBefore = earlierRows.length > 0;
  const alreadyDelivered = earlierRows.some((r) => r.property_id === campaign.property_id
    && (r.best_signal_id === a.signalId || (Array.isArray(r.evidence) && r.evidence.some((e: any) => e.signalId === a.signalId))));
  if (alreadyDelivered) return 'DUPLICATE';

  const signal: LeadSignal = {
    signalId: a.signalId, parentSignalId: a.parent?.signalId ?? null,
    kind: a.item.kind === 'COMMENT' ? 'COMMENT' : a.ctx.kind === 'MESSAGE' ? 'MESSAGE' : 'POST',
    source: network, sourceKind: a.parent?.sourceKind ?? sourceKindOf(ctx.stage), intentClass: a.verdict!.intentClass, intentScore: a.verdict!.score,
    similarity: Math.round(a.similarity), ageDays: a.ageDays, sourceQuality: ctx.sourceYield != null ? Math.min(1, 0.4 + ctx.sourceYield * 2) : null,
    specific: Boolean(a.facts.bedrooms || a.facts.price || a.facts.district || a.facts.areaSqm),
    text: clip(a.item.text, 600) ?? '', url: a.item.url, parentUrl: a.parent?.url ?? null, parentExcerpt: a.parent?.excerpt ?? null,
    /* The evidence time ingest judged: an undated comment was admitted on its
       parent post's publication date, never on the time it was observed. */
    language: a.language, publishedAt: a.item.publishedAt ?? (a.item.kind === 'COMMENT' ? a.parent?.publishedAt ?? null : null),
    explanation: JSON.stringify(a.why),
    ...(ctx.searchQueries?.length ? { foundBy: { queries: ctx.searchQueries, matched: queriesMatchingText(ctx.searchQueries, a.item.text ?? '') } } : {}),
    ...(a.item.kind === 'COMMENT' && a.parent ? {
      parentCommentCount: a.parent.commentCount ?? null,
      parentAnalyzed: a.parentAnalyzed ?? null,
      parentPublishedAt: a.parent.publishedAt ?? null,
      parentFacts: a.parent.facts ? { price: a.parent.facts.price, currency: a.parent.facts.currency, areaSqm: a.parent.facts.areaSqm, bedrooms: a.parent.facts.bedrooms, district: a.parent.facts.district } : null,
    } : {}),
    intent: a.qualification?.intent ?? null,
    signals: a.qualification?.signals ?? [],
  };
  const { data: existing } = await db.from('find_buyers_leads').select('id,evidence,match_category,qualification,overall_score').eq('matching_job_id', campaign.matching_job_id).eq('person_id', person.id).maybeSingle();
  const prior: LeadSignal[] = Array.isArray(existing?.evidence) ? existing.evidence : [];
  if (prior.some((e) => e.signalId === signal.signalId)) return 'DUPLICATE';
  const q = a.qualification!;
  /* A person's lead carries their strongest qualified signal; a later weaker
     signal adds evidence, never downgrades the category. */
  const keepPrior = existing && CATEGORY_RANK[existing.match_category ?? 'WEAK'] > CATEGORY_RANK[q.category];
  const scored = scoreLead([...prior, { ...signal, intentClass: campaign.transaction === 'RENT' ? 'TENANT_HIGH' : 'BUYER_HIGH' }]);
  if (!scored) return 'BELOW';
  const best = keepPrior ? (prior[0] ?? signal) : signal;
  const bestWhy = (() => { try { return JSON.parse(best.explanation); } catch { return null; } })();
  const category = keepPrior ? existing!.match_category : q.category;
  const qual = keepPrior ? existing!.qualification : { ...q, dupKeys: a.dupKeys, evidence: a.reading.evidence, confidence: a.reading.confidence };
  const row = {
    matching_job_id: campaign.matching_job_id, campaign_id: campaign.campaign_id, property_id: campaign.property_id,
    user_id: campaign.user_id, person_id: person.id,
    author_name: clip(a.item.author.name, 200), author_profile_url: a.item.author.url, counterpart: campaign.transaction === 'RENT' ? 'TENANT' : 'BUYER',
    source: best.source, intent_class: a.verdict!.intentClass, overall_score: keepPrior ? existing!.overall_score : q.score, strength: STRENGTH_OF[category] ?? 'POSSIBLE',
    similarity: best.similarity, intent_score: best.intentScore,
    score_components: { ...(keepPrior ? {} : q.components), why: bestWhy },
    role: keepPrior ? qual.role : q.role, transaction: keepPrior ? qual.transaction : q.transaction, match_category: category,
    rejection_reasons: [], budget_fit: keepPrior ? qual.budgetFit : q.budgetFit, location_fit: keepPrior ? qual.locationFit : q.locationFit,
    requirements_fit: keepPrior ? qual.requirementsFit : q.requirementsFit,
    qualification: { ...qual, dupKeys: [...new Set([...(qual?.dupKeys ?? []), ...a.dupKeys])] }, qualification_version: QUALIFICATION_VERSION,
    explanation: whySentence(bestWhy), best_signal_id: best.signalId, parent_signal_id: best.parentSignalId,
    evidence: keepPrior ? [...prior, signal] : [signal, ...prior], signal_count: prior.length + 1, signal_at: best.publishedAt,
    seen_before: seenBefore, language: best.language, updated_at: nowIso,
  };
  if (existing) await db.from('find_buyers_leads').update(row).eq('id', existing.id);
  else {
    const { error } = await db.from('find_buyers_leads').insert(row);
    if (error) return String(error.code) === '23505' ? 'DUPLICATE' : 'BELOW';
    await db.from('find_buyers_persons').update({ campaigns_seen: Number(person.campaigns_seen || 0) + 1 }).eq('id', person.id);
  }
  await recordFirstResult(ctx, category);
  /* A new signal on an existing lead strengthens it but is not a new lead. */
  if (existing) return 'DUPLICATE';
  return category === 'STRONG' ? 'STRONG' : category === 'POTENTIAL' ? 'QUALIFIED' : 'WEAK';
}

/** Time to first visible result / first qualified lead, measured once each. */
async function recordFirstResult(ctx: PipelineCtx, category: string) {
  const { db, campaign } = ctx;
  const at = new Date(ctx.now ?? Date.now()).toISOString();
  const { data } = await db.from('find_buyers_campaigns').select('metrics').eq('matching_job_id', campaign.matching_job_id).maybeSingle();
  const m = (data?.metrics ?? {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...m };
  if (!m.firstVisibleAt) next.firstVisibleAt = at;
  if (!m.firstQualifiedAt && (category === 'STRONG' || category === 'POTENTIAL')) next.firstQualifiedAt = at;
  if (!m.firstStrongAt && category === 'STRONG') next.firstStrongAt = at;
  if (Object.keys(next).length !== Object.keys(m).length) {
    await db.from('find_buyers_campaigns').update({ metrics: next }).eq('matching_job_id', campaign.matching_job_id);
  }
}

/** English, admin-facing; customers get the localized rendering of `why`. */
export function whySentence(why: WhyMatched | null): string | null {
  if (!why) return null;
  const what = [why.bedrooms != null ? `${why.bedrooms}-bedroom` : null, (why.propertyType ?? 'property').toLowerCase()].filter(Boolean).join(' ');
  const where = why.district ?? why.city ?? null;
  const agreed = why.agreed.filter((d) => d === 'area' || d === 'price').map((d) => (d === 'area' ? 'size' : 'price range'));
  if (why.kind === 'REQUEST_POST') return `Publicly asked for a ${what}${where ? ` in ${where}` : ''}.`;
  return `Commented on a ${why.parentAgeDays != null && why.parentAgeDays <= 14 ? 'recent ' : ''}${what}${where ? ` in ${where}` : ''}${agreed.length ? ` with a similar ${agreed.join(' and ')}` : ''}.`;
}

export { STAGE_ACTOR };

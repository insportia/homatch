// HOMATCH RESEARCH CORE — the public surface.
//
// WHAT THIS IS
//
// Shared research infrastructure: SSRF-safe fetching, source policy, robots,
// rate limiting, circuit breaking, request coalescing, stale-while-revalidate,
// weighted scheduling, deterministic parsing and normalization, document
// deduplication, source independence, conflict preservation, and the contracts
// for Investment research.
//
// WHAT THIS IS NOT
//
// It is not a research system. Homatch has one: research_jobs, the
// research-agent five-stage pipeline, official-worker's recorded registry
// workflows, the intelligence_* graph, billing v2 and the COGS ledger. Those
// stay authoritative, and nothing here replaces any of them. This directory is
// the missing infrastructure tier underneath, plus the bridges that hand its
// output to the systems that already exist.
//
// FIVE RULES THE CORE KEEPS
//
//   1. Runtime-neutral. No node: imports, no Deno globals, no Supabase client.
//      It must type-check in the Vite build, run in the Node test runner, and
//      import cleanly into a Deno Edge Function.
//   2. No customer-facing strings. Homatch's are localized across six locales
//      and sanitized on the way out; the core emits codes and data.
//   3. No pricing. It reports measured usage; billing.ts and cogs.ts decide
//      money, against an effective-dated price book.
//   4. No direct paid-provider access. Everything metered goes through
//      ProviderPort, which the host implements over _shared/providers.ts so
//      kill switches, spend caps and health checks all still apply.
//   5. Nothing is silently resolved. Duplicates are marked, not deleted.
//      Conflicts are preserved, not averaged. An unknown cost is a named gap,
//      never a zero. An unavailable answer says why.
//
// ADDING TO IT: see docs/research-core.md.

/* ── Vocabulary ───────────────────────────────────────────────────────── */
export {
  WORK_CLASSES,
  INTERACTIVE_CLASSES,
  isInteractive,
  workClassForGrant,
  EVIDENCE_LEVELS,
  evidenceLevelDistance,
  levelSatisfies,
  PRICE_BASES,
  priceBasisSide,
  basesArePoolable,
  ORIGIN_QUALITY,
  emptyUsage,
  mergeUsage,
  DEFAULT_REQUEST_CONTEXT,
  type WorkClass,
  type EvidenceLevel,
  type PriceBasis,
  type Money,
  type SourceKind,
  type SourceIdentity,
  type FieldOrigin,
  type Observation,
  type ProviderUsage,
  type VisibilityScope,
  type RequestContext,
  type ResearchStatus,
} from './core/types.ts';

export {
  ResearchError,
  TimeoutError,
  AbortError,
  CircuitOpenError,
  HttpError,
  ValidationError,
  BudgetExceededError,
  isAbortError,
  isRetryable,
  errorMessage,
  type ResearchErrorCode,
} from './core/errors.ts';

export { createLogger, silentLogger, type Logger, type LogLevel, type LogSink } from './core/logger.ts';
export { newId, deterministicId, nextSequence } from './core/ids.ts';
export { sha256Hex, sha256Bytes, toHex } from './core/sha256.ts';
export { systemClock, FixedClock, type Clock } from './core/clock.ts';

/* ── Network safety ───────────────────────────────────────────────────── */
export {
  NetworkPolicy,
  NetworkPolicyError,
  StaticDnsResolver,
  permissiveNetworkPolicy,
  redactUrl,
  type DnsResolver,
  type NetworkDecision,
  type NetworkPolicyOptions,
  type ResolvedTarget,
  type DenyReason,
} from './net/network-policy.ts';

export {
  classifyIp,
  parseIpLiteral,
  parseResolvedAddress,
  parseCidr,
  ipInCidr,
  isBlockedCategory,
  type IpCategory,
  type ParsedIp,
} from './net/ip.ts';

export {
  SourceAccessPolicyRegistry,
  SourceDisabledError,
  DEFAULT_SOURCE_POLICY,
  type SourcePolicy,
  type ResolvedSourcePolicy,
  type RobotsMode,
  type SourceVisibility,
} from './net/source-policy.ts';

export {
  RobotsChecker,
  RobotsDisallowedError,
  parseRobotsTxt,
  isAllowed as robotsAllows,
  type RobotsFetcher,
  type RobotsFile,
} from './net/robots.ts';

/* ── Fetching ─────────────────────────────────────────────────────────── */
export { HttpClient, type FetchResult, type FetchOptions, type HttpClientOptions } from './fetch/http-client.ts';
export { FetchTransport, type FetchTransportOptions } from './fetch/fetch-transport.ts';
export { headerValue, type Transport, type RawRequest, type RawResponse } from './fetch/transport.ts';
export {
  CachedFetcher,
  noDocumentStore,
  totalUsage,
  type DocumentStore,
  type StoredDocument,
  type CachedFetchResult,
  type CachedFetchOptions,
  type FetchPath,
} from './fetch/cached-fetcher.ts';

/* ── Flow control ─────────────────────────────────────────────────────── */
export {
  WeightedScheduler,
  DEFAULT_CLASS_POLICIES,
  type ClassPolicy,
  type SchedulerOptions,
  type SchedulerStats,
  type ScheduledTask,
} from './flow/scheduler.ts';
export { RequestCoalescer, type CoalescerStats } from './flow/coalescer.ts';
export {
  RefreshCoordinator,
  type RefreshOutcome,
  type RefreshStats,
} from './flow/refresh-coordinator.ts';
export { InProcessLock, type SingleFlightLock, type LockHandle } from './flow/single-flight-lock.ts';
export { RateLimiter, type LimitPolicy } from './flow/rate-limiter.ts';
export { Semaphore } from './flow/semaphore.ts';
export { TokenBucket } from './flow/token-bucket.ts';
export {
  CircuitBreaker,
  CircuitBreakerRegistry,
  type CircuitState,
  type CircuitBreakerOptions,
} from './flow/circuit-breaker.ts';
export { computeBackoff, parseRetryAfter, retry, type BackoffOptions } from './flow/backoff.ts';
export { Deadline } from './flow/deadline.ts';

/* ── Parsing and normalization ────────────────────────────────────────── */
export { parseHtml, PARSER_VERSION, type HtmlDocument } from './parse/html.ts';
export { extractJsonLd, type JsonLdNode } from './parse/json-ld.ts';
export { extractMetadata, extractOpenGraph, type PageMetadata } from './parse/metadata.ts';
export {
  listingFromJsonLd,
  listingFromItemProps,
  SCHEMA_ORG_PARSER_VERSION,
  type SchemaOrgOptions,
} from './parse/schema-org.ts';
export {
  emptyListing,
  mergeListing,
  money,
  assignMoney,
  deriveSalePricePerSqm,
  structuredQuality,
  type NormalizedListing,
} from './parse/listing.ts';

export * as urlUtil from './normalize/url.ts';
export * as domainUtil from './normalize/domain.ts';
export * as currencyUtil from './normalize/currency.ts';
export * as areaUtil from './normalize/area.ts';
export * as dateUtil from './normalize/dates.ts';
export * as geoUtil from './normalize/geo.ts';
export * as textUtil from './normalize/text.ts';
export * as numberUtil from './normalize/numbers.ts';
export * as addressUtil from './normalize/address.ts';
export * as hashUtil from './normalize/hash.ts';
export * as contentTypeUtil from './normalize/content-type.ts';
export * as languageUtil from './normalize/language.ts';
export * as collectionUtil from './normalize/collections.ts';

/* ── Scoring ──────────────────────────────────────────────────────────── */
export {
  dedupeObservations,
  type DedupeResult,
  type DedupedObservation,
  type DuplicateGroup,
  type DuplicateReason,
} from './score/document-dedupe.ts';
export {
  computeIndependence,
  supportFor,
  DEFAULT_FAMILY_WEIGHTS,
  type IndependenceResult,
  type SupportCount,
  type SourceFamilyWeights,
} from './score/independence.ts';
export {
  detectConflicts,
  conflictSpread,
  type Claim,
  type Conflict,
  type ConflictAlternative,
  type ConflictCode,
  type ConflictSeverity,
} from './score/conflicts.ts';
export {
  pool,
  poolByBasis,
  type Pool,
  type PoolInput,
  type PoolResult,
  type PoolRefusal,
} from './score/pooling.ts';

/* ── Observability ────────────────────────────────────────────────────── */
export { Metrics, METRIC, type MetricsSnapshot } from './observe/metrics.ts';

/* ── Profiles ─────────────────────────────────────────────────────────── */
export {
  ProfileRegistry,
  type ResearchProfile,
  type ResearchObjective,
  type ProfileId,
  type ObjectiveId,
  type ProfileLimits,
  type ReportingGate,
  type UnavailableReason,
} from './profiles/types.ts';
export {
  INVESTMENT_PROFILES,
  investmentProfileRegistry,
  MARKET_COMPARABLES,
  INVESTMENT_PRICE_CHECK,
  INVESTMENT_RENT_CHECK,
  INVESTMENT_MARKET_MOVEMENT,
  INVESTMENT_LIQUIDITY,
  INVESTMENT_DEEP_RESEARCH,
} from './profiles/investment.ts';
export {
  evaluateCoverage,
  type ProfileCoverage,
  type ObjectiveOutcome,
  type ObjectiveStatus,
  type ObjectiveContribution,
  type CoverageOptions,
} from './profiles/coverage.ts';

/* ── Bridges to the systems that already exist ────────────────────────── */
export {
  toEvidenceItem,
  sourceClassFor,
  supportAnnotation,
  duplicateTrail,
  observationOf,
  type EvidenceItem,
  type EvidenceType,
  type SourceClass,
  type VerificationState,
  type ContradictionRefs,
  type ToEvidenceInput,
} from './bridge/evidence.ts';
export {
  toActualUsage,
  toCostEventRow,
  avoidedProviderCalls,
  type ActualUsageLike,
  type CostEventRow,
} from './bridge/cost.ts';
export {
  budgetFor,
  backgroundBudget,
  narrow,
  type ExecutionGrantLike,
  type ResearchBudget,
} from './bridge/budget.ts';
export {
  documentFingerprint,
  profileFingerprint,
  coalescingKey,
  scopeToken,
  isResearchCoreFingerprint,
} from './bridge/cache-key.ts';
export {
  judgeDocumentAge,
  alwaysRecheck,
  type CacheFreshness,
  type DocumentAgeVerdict,
  type FactFreshnessPort,
} from './bridge/freshness.ts';
export {
  noProviderAccess,
  isDenied,
  type ProviderPort,
  type ProviderSearchRequest,
  type ProviderSearchResult,
  type ProviderSearchHit,
  type ProviderDenied,
  type ProviderDenialReason,
} from './bridge/provider-port.ts';

/* ── Research direction: the buyer-vs-property distinction ────────────── */
export {
  RESEARCH_DIRECTIONS,
  directionSatisfies,
  type ResearchDirection,
} from './core/types.ts';
export {
  classifyDirection,
  satisfiesJob,
  type DirectionVerdict,
} from './signals/direction.ts';

/* ── Multilingual planning and discovery ──────────────────────────────── */
export {
  RESEARCH_LANGUAGES,
  PROPERTY_TERMS,
  LEXICON,
  isResearchLanguage,
  languagesForMarket,
  allPhrases,
  allPropertyTerms,
  type ResearchLanguage,
  type PropertyTerm,
  type LanguageLexicon,
} from './discovery/lexicon.ts';
export {
  planQueries,
  acceptancePhrases,
  type ResearchSubject,
  type PlannedQuery,
  type QueryPlan,
  type QueryIntent,
  type PlanOptions,
} from './discovery/query-plan.ts';
export {
  FRESHNESS_WINDOWS,
  judgeFreshness,
  windowStart,
  canSkipOlderThanCursor,
  type FreshnessWindow,
  type FreshnessSpec,
  type FreshnessVerdict,
} from './discovery/freshness.ts';
export {
  selectSources,
  productivityScore,
  needsRescan,
  shouldBackOff,
  recordScan,
  type SourceRecord,
  type SourceProductivity,
  type SourceAccessState,
  type SourceSelection,
  type SelectionOptions,
  type SkipReason,
} from './discovery/source-registry.ts';
export {
  AdapterRegistry,
  supports,
  type SourceAdapter,
  type AdapterCapability,
  type AdapterContext,
  type AdapterDocument,
  type AdapterOutcome,
  type AdapterFailure,
  type DiscoverRequest,
  type DiscoveredSource,
  type ScanRequest,
  type ScanResult,
  type FetchCapability,
} from './discovery/adapter.ts';
export {
  climbLadder,
  LADDER,
  type LadderRung,
  type LadderInput,
  type LadderResult,
  type RungOutcome,
  type FirstPartyPort,
} from './discovery/ladder.ts';

/* ── Signals ──────────────────────────────────────────────────────────── */
export type {
  PublicSignal,
  ScoredSignal,
  SignalPlatform,
  SignalAuthor,
  ContentType,
  AccessClass,
} from './signals/types.ts';
export {
  filterSignals,
  type FilterInput,
  type FilterOutcome,
  type Rejection,
  type RejectionReason,
} from './signals/filter.ts';

/* ── Job profiles ─────────────────────────────────────────────────────── */
export {
  JOB_PROFILES,
  JOB_ALIASES,
  researchProfileRegistry,
  resolveJob,
  BUYER_SEARCH,
  RENTER_SEARCH,
  PROPERTY_SEARCH,
  LAND_SEARCH,
  INVESTOR_SEARCH,
  DEVELOPER_SEARCH,
} from './profiles/jobs.ts';
export type { JobContract } from './profiles/types.ts';

/* ── Platform adapters ────────────────────────────────────────────────── */
export { FacebookAdapter, canonicalizeFacebookUrl, isFacebookSourceUrl } from './adapters/facebook.ts';
export { InstagramAdapter, canonicalizeInstagramUrl, isInstagramSourceUrl } from './adapters/instagram.ts';
export { detectWall, assessDocument, buildSignal, type WallKind } from './adapters/meta-platform.ts';

/* ── Bridges for the source graph ─────────────────────────────────────── */
export {
  toRawSignalRow,
  toSourceRegistryRow,
  toSignalContextRow,
  stripContactDetails,
  type RawSignalRow,
  type SourceRegistryRow,
  type SignalContextRow,
} from './bridge/signal.ts';
export {
  redactConnection,
  connectionHealth,
  isUsable,
  scrub,
  toAccessRequest,
  sourceStateAfter,
  type ResearchConnection,
  type RedactedConnection,
  type ConnectionStatus,
  type ConnectionHealth,
  type AccessRequest,
  type AccessRequestState,
  type ResearchPlatform,
} from './bridge/research-access.ts';

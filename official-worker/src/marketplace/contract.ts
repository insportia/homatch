// Type-only snapshot of the authoritative marketplace contract; drift is tested.
export const WORKER_CONTRACT_VERSION = 'marketplace-worker-1';
export type MarketplacePropertyType =
  | 'APARTMENT' | 'HOUSE' | 'PENTHOUSE' | 'LAND' | 'COMMERCIAL' | 'OFFICE'
  | 'VILLA' | 'TOWNHOUSE' | 'STUDIO' | 'OTHER';
export type MarketplaceTransaction = 'BUY' | 'MONTHLY_RENT' | 'DAILY_RENT';
export type BuildingStatus = 'NEW_BUILD' | 'OLD_BUILD' | 'UNDER_CONSTRUCTION';
export type RenovationStatus = 'RENOVATED' | 'GREEN_FRAME' | 'WHITE_FRAME' | 'BLACK_FRAME' | 'NEEDS_RENOVATION';
export type WorkerSourceType = 'MARKETPLACE' | 'AGENCY' | 'DEVELOPER' | 'AGGREGATOR';
export type WorkerRunStatus =
  | 'QUEUED' | 'SEARCHING' | 'RESULTS_RECEIVED' | 'PROCESSING' | 'COMPLETE' | 'PARTIAL' | 'FAILED' | 'TIMED_OUT' | 'BLOCKED';
export type DeclaredSellerType = 'OWNER' | 'AGENCY' | 'BROKER' | 'DEVELOPER' | 'UNKNOWN';
export interface MarketplaceSearchRequest {
  contract: typeof WORKER_CONTRACT_VERSION;
  searchId: string;
  searchPlanId: string;
  market: string;
  country: string;
  city: string;
  districts: string[];
  transactionType: MarketplaceTransaction;
  propertyType: MarketplacePropertyType;
  priceMinUsd: number;
  priceMaxUsd: number;
  areaMinSqm: number | null;
  areaMaxSqm: number | null;
  rooms: { min: number | null; max: number | null } | null;
  bedrooms: { min: number | null; max: number | null } | null;
  bathrooms: { min: number | null; max: number | null } | null;
  buildingStatuses: BuildingStatus[];
  renovationPreferences: RenovationStatus[];
  furnished: boolean | null;
  parking: boolean | null;
  mustHave: string[];
  niceToHave: string[];
  exclusions: string[];
  searchLanguages: string[];
  /**
   * The hard ceiling a worker may collect up to. Workers collect slightly above
   * the customer's maximum (the Budget Upgrade window, ≤ +10%) so that layer has
   * candidates; the in-budget results are filtered by the core, never by a worker.
   */
  collectPriceMaxUsd: number;
  requestedAt: string;
}
export interface ExternalListingCandidate {
  source: string;
  sourceListingId: string;
  exactUrl: string;
  canonicalUrl: string | null;
  sourceName: string | null;
  sourceType: WorkerSourceType | null;
  title: string | null;
  description: string | null;
  price: number | null;
  currency: string | null;
  pricePerSqm: number | null;
  country: string | null;
  city: string | null;
  district: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  propertyType: MarketplacePropertyType | null;
  transactionType: MarketplaceTransaction | null;
  areaSqm: number | null;
  rooms: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floor: number | null;
  totalFloors: number | null;
  buildingStatus: BuildingStatus | null;
  renovationStatus: RenovationStatus | null;
  constructionYear: number | null;
  furnished: boolean | null;
  parking: boolean | null;
  amenities: string[];
  images: string[];
  imageHashes: string[];
  publishedAt: string | null;
  updatedAt: string | null;
  observedAt: string;
  seller: {
    name: string | null;
    publicPhone: string | null;
    publicEmail: string | null;
    publicProfile: string | null;
    declaredType: DeclaredSellerType | null;
    /** Other listings by this seller the worker saw on the same source, when it can say. */
    sourceListingCount: number | null;
  };
  provenance: { exactUrl: string; authorUrl: string | null; sourceUrl: string | null };
  evidence: Array<{ field: string; text: string }>;
  retrievalMetadata: Record<string, string | number | boolean | null>;
}
export interface MarketplaceWorkerResult {
  contract: typeof WORKER_CONTRACT_VERSION;
  searchId: string;
  searchPlanId: string;
  workerId: string;
  sourceId: string;
  status: WorkerRunStatus;
  startedAt: string | null;
  completedAt: string | null;
  queryApplied: Record<string, string | number | boolean | null | string[]>;
  discoveredCount: number;
  returnedCount: number;
  listings: ExternalListingCandidate[];
  errors: Array<{ code: string; message: string }>;
  metrics: WorkerMetrics;
}
export interface WorkerMetrics {
  durationMs: number | null;
  pagesVisited: number | null;
  actions: number | null;
  bytesTransferred: number | null;
  browserMs: number | null;
  estimatedCostUsd: number | null;
}

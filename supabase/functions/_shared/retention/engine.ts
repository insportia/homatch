// Retention cleanup engine — object level, allowlisted, idempotent, restart-safe.
//
// The DECISIONS live in Postgres (20261105090000_storage_retention_artifacts):
// which locations are disposable at all (retention_location_eligible), which
// category is enabled and since when, the lease, the notice prerequisite, the
// backoff and the dead letter. This file only does what SQL cannot: ask the
// worker whether a cache file can be rebuilt, talk to the storage provider,
// and prove each deletion before the database is told it happened.
//
//   tick
//    1. register internal-cache files created since their category was enabled
//    2. queue expiry notices for user-visible temporary files (gated)
//    3. claim a bounded batch (returns nothing while paused)
//    4. per artifact: allowlist re-check here as well -> regeneration proof
//       (caches) -> present? -> delete -> confirm gone -> outcome; any failure
//       backs off and ends in DEAD_LETTER
//
// Record-level retention (clearing Verify results, deleting Contracts
// originals) was retired on 2026-10-16 and has no code path here.
// Nothing here reads report or document content.

export type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<unknown>;

export interface RegenerationProof {
  regenerable: boolean;
  method: string;
  status?: number;
  contentType?: string | null;
  bytes?: number;
  error?: string;
  checkedAt: string;
}

export interface Providers {
  supabaseRemove(bucket: string, key: string): Promise<void>;
  r2Delete(key: string): Promise<void>;
  r2Exists(key: string): Promise<boolean>;
  /** Proves a regenerable cache file can be rebuilt from its source right now. */
  regenerate(method: string, objectKey: string): Promise<RegenerationProof>;
}

export interface TickOptions {
  registerLimit?: number;
  noticeLimit?: number;
  batch?: number;
  /** Pause between provider calls (rate limit). */
  pauseMs?: number;
  /**
   * Wall-clock budget for the claim loop. Items are claimed ONE AT A TIME and
   * no new claim starts after the budget, so a run the platform stops (Edge
   * Functions are killed at 150 s) never strands a batch of PURGING leases
   * that would each burn an attempt on the way to a false dead letter.
   */
  budgetMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface TickReport {
  registered: number;
  notices: unknown;
  claimed: number;
  deleted: number;
  alreadyGone: number;
  kept: number;
  failed: number;
  errors: string[];
}

export interface ArtifactClaim {
  artifact_id: string;
  category: string;
  kind: string;
  regeneration: string | null;
  provider: string;
  bucket: string;
  object_key: string;
  lease_token: string;
}

type Outcome = 'DELETED' | 'GONE' | 'KEPT' | 'FAILED';

const sleepDefault = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/**
 * The same allowlist as public.retention_location_eligible, checked again
 * here so that no database state alone can point a delete at a protected key.
 */
export function eligibleLocation(provider: string, bucket: string, key: string): boolean {
  if (!key || key.includes('..') || key.startsWith('/')) return false;
  if (provider === 'SUPABASE_STORAGE' && bucket === 'verify-documents') {
    return /^files\/[0-9]{1,12}\.(pdf|jpg|png)$/.test(key) || /^retention-selftest\/[0-9a-f-]{36}\.pdf$/.test(key);
  }
  if (provider === 'R2' && bucket === 'users') {
    return /^users\/[0-9a-f-]{36}\/generated-reports\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/.test(key);
  }
  if (provider === 'R2' && bucket === 'retention-selftest') {
    return /^retention-selftest\/[0-9a-f-]{36}\.txt$/.test(key);
  }
  return false;
}

/** The TAS attachment id a cached official document is stored under. */
export function tasAttachmentId(key: string): string | null {
  return /^files\/([0-9]{1,12})\.(pdf|jpg|png)$/.exec(key)?.[1] ?? null;
}

async function present(rpc: Rpc, providers: Providers, c: ArtifactClaim): Promise<boolean> {
  if (c.provider === 'SUPABASE_STORAGE') {
    return (await rpc('retention_storage_object_exists', { p_bucket: c.bucket, p_key: c.object_key })) === true;
  }
  if (c.provider === 'R2') return providers.r2Exists(c.object_key);
  throw new Error(`unknown provider ${c.provider}`);
}

async function remove(providers: Providers, c: ArtifactClaim): Promise<void> {
  if (c.provider === 'SUPABASE_STORAGE') return providers.supabaseRemove(c.bucket, c.object_key);
  if (c.provider === 'R2') return providers.r2Delete(c.object_key);
  throw new Error(`unknown provider ${c.provider}`);
}

export async function processArtifact(rpc: Rpc, providers: Providers, c: ArtifactClaim): Promise<Outcome> {
  const lease = { p_artifact_id: c.artifact_id, p_lease_token: c.lease_token };
  try {
    if (!eligibleLocation(c.provider, c.bucket, c.object_key)) {
      // Never reached in a correct database; refused without touching storage.
      await rpc('retention_artifacts_outcome', { ...lease, p_outcome: 'FAILED', p_error: 'NOT_ELIGIBLE (engine allowlist)' });
      return 'FAILED';
    }
    let proof: RegenerationProof | null = null;
    if (c.kind === 'REGENERABLE_CACHE') {
      proof = c.regeneration
        ? await providers.regenerate(c.regeneration, c.object_key)
        : { regenerable: false, method: 'NONE', error: 'no regeneration method', checkedAt: new Date().toISOString() };
      if (!proof.regenerable) {
        await rpc('retention_artifacts_outcome', { ...lease, p_outcome: 'NOT_REGENERABLE', p_error: proof.error ?? 'not regenerable', p_detail: proof });
        return 'KEPT';
      }
    }
    if (!(await present(rpc, providers, c))) {
      await rpc('retention_artifacts_outcome', { ...lease, p_outcome: 'ALREADY_GONE', p_detail: { regeneration: proof } });
      return 'GONE';
    }
    await remove(providers, c);
    if (await present(rpc, providers, c)) throw new Error('object still present after delete');
    await rpc('retention_artifacts_outcome', {
      ...lease, p_outcome: 'VERIFIED_DELETED',
      p_detail: { regeneration: proof, confirmedAbsent: c.provider === 'R2' ? 'r2-head' : 'storage-objects', at: new Date().toISOString() },
    });
    return 'DELETED';
  } catch (e) {
    await rpc('retention_artifacts_outcome', { ...lease, p_outcome: 'FAILED', p_error: message(e) }).catch(() => undefined);
    return 'FAILED';
  }
}

export async function tick(rpc: Rpc, providers: Providers, opts: TickOptions = {}): Promise<TickReport> {
  const sleep = opts.sleep ?? sleepDefault;
  const report: TickReport = {
    registered: 0, notices: null, claimed: 0, deleted: 0, alreadyGone: 0, kept: 0, failed: 0, errors: [],
  };
  try {
    report.registered = Number(await rpc('retention_register_artifacts', { p_limit: opts.registerLimit ?? 200 })) || 0;
  } catch (e) { report.errors.push(`register: ${message(e)}`); }
  try {
    report.notices = await rpc('retention_artifact_notices', { p_limit: opts.noticeLimit ?? 200 });
  } catch (e) { report.errors.push(`notices: ${message(e)}`); }

  const now = opts.now ?? Date.now;
  const deadline = now() + (opts.budgetMs ?? 90_000);
  const batch = Math.max(1, opts.batch ?? 10);
  while (report.claimed < batch && now() < deadline) {
    const [c] = ((await rpc('retention_artifacts_claim', { p_limit: 1, p_lease_seconds: 600 })) ?? []) as ArtifactClaim[];
    if (!c) break;
    report.claimed++;
    const outcome = await processArtifact(rpc, providers, c);
    if (outcome === 'DELETED') report.deleted++;
    else if (outcome === 'GONE') report.alreadyGone++;
    else if (outcome === 'KEPT') report.kept++;
    else report.failed++;
    if (opts.pauseMs) await sleep(opts.pauseMs);
  }
  return report;
}

// Retention cleanup engine — provider-aware, idempotent, restart-safe.
//
// The DECISIONS live in Postgres (20261102090000_storage_retention_lifecycle):
// what is due, what is shared, what is held, the lease, the backoff, the dead
// letter. This file only does what SQL cannot: talk to the storage providers
// and prove each deletion before the database is told it happened.
//
//   tick
//    1. register newly completed reports / analysed documents (no deletion)
//    2. record which shared official documents each new report names,
//       parsed with the SAME ledger parser research-agent's document_file
//       gate uses — before anything that names them can be purged
//    3. queue 7-day / 1-day reminders through notify_emit (gated)
//    4. claim a bounded batch (returns nothing unless purge_enabled)
//    5. per record: delete each exclusive object at its provider, CONFIRM it
//       is gone, report the outcome; retain shared ones; then clear the
//       database payload — or back off and retry, ending in DEAD_LETTER
//
// Nothing here reads report content. Nothing here is on the Verify path.

import { libraryItems } from '../../../../src/verify/officialDocumentLibrary.ts';

export type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<unknown>;

export interface Providers {
  /** Supabase Storage: remove, then the engine asks Postgres whether the row is gone. */
  supabaseRemove(bucket: string, key: string): Promise<void>;
  /** Cloudflare R2: delete, then HEAD. */
  r2Delete(key: string): Promise<void>;
  r2Exists(key: string): Promise<boolean>;
}

export interface TickOptions {
  registerLimit?: number;
  scanLimit?: number;
  batch?: number;
  /** Pause between provider calls (rate limit). */
  pauseMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface TickReport {
  registered: unknown;
  scanned: number;
  reminders: unknown;
  claimed: number;
  purged: number;
  failed: number;
  objectsDeleted: number;
  objectsRetained: number;
  errors: string[];
}

interface Claim { record_id: string; product: string; source_id: string; lease_token: string }
interface PlanRow { object_id: string; provider: string; bucket: string; object_key: string; action: string }

const sleepDefault = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Storage keys of the official documents a report's ledger names. */
export function officialDocumentKeys(docs: unknown): string[] {
  const keys = new Set<string>();
  for (const item of libraryItems(docs)) {
    if (!item.attachedFileId || !/^\d{1,12}$/.test(item.attachedFileId)) continue;
    // Mirrors ledgerFileFor's format choice so the key is the one research-agent caches under.
    const format = item.format === 'png' ? 'png' : item.format === 'jpg' || item.format === 'jpeg' ? 'jpg' : 'pdf';
    keys.add(`files/${item.attachedFileId}.${format}`);
  }
  return [...keys];
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** Delete one object and prove it is gone. Throws when it is not. */
export async function deleteAndVerify(rpc: Rpc, providers: Providers, row: PlanRow): Promise<void> {
  if (row.provider === 'SUPABASE_STORAGE') {
    await providers.supabaseRemove(row.bucket, row.object_key);
    const still = await rpc('retention_storage_object_exists', { p_bucket: row.bucket, p_key: row.object_key });
    if (still !== false) throw new Error('supabase object still present after remove');
    return;
  }
  if (row.provider === 'R2') {
    await providers.r2Delete(row.object_key);
    if (await providers.r2Exists(row.object_key)) throw new Error('r2 object still present after delete');
    return;
  }
  throw new Error(`unknown provider ${row.provider}`);
}

export async function processRecord(
  rpc: Rpc, providers: Providers, claim: Claim, opts: TickOptions = {}, report?: TickReport,
): Promise<'PURGED' | 'FAILED'> {
  const sleep = opts.sleep ?? sleepDefault;
  const lease = { p_record_id: claim.record_id, p_lease_token: claim.lease_token };
  let failure: string | null = null;
  try {
    const plan = (await rpc('retention_object_plan', lease)) as PlanRow[];
    for (const row of plan ?? []) {
      if (row.action === 'DONE') continue;
      if (row.action === 'MANUAL') { failure = failure ?? 'object in manual review'; continue; }
      if (row.action === 'RETAIN') {
        await rpc('retention_object_outcome', { ...lease, p_object_id: row.object_id, p_outcome: 'RETAINED' });
        if (report) report.objectsRetained++;
        continue;
      }
      try {
        await deleteAndVerify(rpc, providers, row);
        await rpc('retention_object_outcome', { ...lease, p_object_id: row.object_id, p_outcome: 'VERIFIED_DELETED' });
        if (report) report.objectsDeleted++;
      } catch (e) {
        failure = failure ?? message(e);
        await rpc('retention_object_outcome', { ...lease, p_object_id: row.object_id, p_outcome: 'FAILED', p_error: message(e) });
      }
      if (opts.pauseMs) await sleep(opts.pauseMs);
    }
    if (failure) {
      await rpc('retention_record_failed', { ...lease, p_error: failure });
      return 'FAILED';
    }
    await rpc('retention_purge_payload', lease);
    return 'PURGED';
  } catch (e) {
    // Lease lost, database hiccup: report it if we still can; the lease
    // expiry makes the record claimable again either way.
    await rpc('retention_record_failed', { ...lease, p_error: message(e) }).catch(() => undefined);
    if (report) report.errors.push(message(e));
    return 'FAILED';
  }
}

export async function tick(rpc: Rpc, providers: Providers, opts: TickOptions = {}): Promise<TickReport> {
  const report: TickReport = {
    registered: null, scanned: 0, reminders: null, claimed: 0, purged: 0, failed: 0,
    objectsDeleted: 0, objectsRetained: 0, errors: [],
  };
  report.registered = await rpc('retention_register_due', { p_limit: opts.registerLimit ?? 200 });

  const unscanned = (await rpc('retention_unscanned_reports', { p_limit: opts.scanLimit ?? 50 })) as
    Array<{ record_id: string; docs: unknown }> | null;
  for (const r of unscanned ?? []) {
    const keys = officialDocumentKeys(r.docs);
    await rpc('retention_add_object_refs', { p_record_id: r.record_id, p_objects: keys.map((key) => ({ key })) });
    report.scanned++;
  }

  report.reminders = await rpc('retention_emit_reminders', { p_limit: 200 });

  const claims = ((await rpc('retention_claim', { p_limit: opts.batch ?? 10, p_lease_seconds: 600 })) ?? []) as Claim[];
  report.claimed = claims.length;
  for (const c of claims) {
    const outcome = await processRecord(rpc, providers, c, opts, report);
    if (outcome === 'PURGED') report.purged++; else report.failed++;
  }
  return report;
}

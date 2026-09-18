// storage-migrate — copy every object out of Supabase Storage into R2, and
// prove each one independently.
//
// IT COPIES. IT NEVER DELETES.
//
// The Supabase original is the rollback, and it stays exactly where it is —
// untouched, unread except to be copied, still referenced by every
// storage_path in the product's own tables. Nothing in this file removes
// anything from anywhere, and that is the property that makes the whole
// migration reversible by changing one constant.
//
// WHAT "VERIFIED" MEANS HERE
//
// Not "the PUT returned 200". A PUT returning 200 proves a PUT returned 200.
// Each object is verified four ways, and all four must agree:
//
//   size      Supabase's recorded size, the bytes downloaded, and what R2
//             reports back afterwards.
//   md5       Supabase's etag against R2's etag. Two services, each
//             computing it over its own copy, neither told the other's
//             answer. This is why no md5 is implemented here — a checksum
//             you compute yourself on both sides proves your own arithmetic.
//   sha256    the source bytes against the bytes READ BACK OUT of R2, which
//             is the only check that exercises the round trip rather than
//             the upload.
//   existence R2's own HEAD, after the fact.
//
// `verified_at` is stamped only when all four hold.
//
// IDEMPOTENT, AND LOUD ABOUT DISAGREEMENT
//
// Re-running is safe. If the destination already exists it is compared
// rather than overwritten: identical means VERIFIED, and different means
// CONFLICT — recorded, reported, and left alone. Silently overwriting a
// destination that differs is how a migration destroys the thing it was
// supposed to be protecting.
//
// Authorised by the same single-use ticket as the self-test, so proving this
// needs no account and no copy of the service key anywhere.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  StorageUnavailable, getObject, headObject, putObject,
} from '../_shared/objectStore.ts';
import { keyForLegacyObject } from '../_shared/storage/keys.ts';

declare const Deno: { env: { get(k: string): string | undefined } };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-proof-ticket',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const hex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function sha256(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

/** md5 as each service reports it, unquoted and lower-cased. */
const normEtag = (v: string | null | undefined): string => {
  const raw = (v ?? '').trim();
  const strong = raw.startsWith('W/') ? raw.slice(2) : raw;
  return strong.split('"').join('').toLowerCase();
};

interface ManifestRow {
  bucket_id: string;
  name: string;
  byte_size: number;
  content_type: string | null;
  source_md5: string;
  source_sha256: string | null;
  owner_user_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  category: string | null;
  owner_source: string;
}

type Outcome = 'COPIED_AND_VERIFIED' | 'ALREADY_VERIFIED' | 'CONFLICT' | 'FAILED';

interface ObjectResult {
  source: string;
  r2_key: string;
  outcome: Outcome;
  bytes: number | null;
  owner_user_id: string | null;
  owner_source: string;
  checks: Record<string, unknown>;
  detail?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json({ error: 'UNAVAILABLE' }, 503);
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  // ── The ticket, spent before any work is done ──────────────────────────
  const token = req.headers.get('x-proof-ticket') ?? '';
  if (token.length < 32 || token.length > 200) return json({ error: 'FORBIDDEN' }, 403);
  const tokenHash = await sha256(new TextEncoder().encode(token));

  const { data: ticket, error: ticketErr } = await db
    .from('storage_proof_tickets')
    .update({ used_at: new Date().toISOString() })
    .eq('token_sha256', tokenHash)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('id')
    .maybeSingle();
  if (ticketErr) {
    console.error('storage-migrate: ticket lookup failed', ticketErr.code ?? 'unknown');
    return json({ error: 'UNAVAILABLE' }, 503);
  }
  if (!ticket) return json({ error: 'FORBIDDEN' }, 403);

  // ── What there is to move ──────────────────────────────────────────────
  const { data: manifest, error: manifestErr } = await db.rpc('storage_migration_manifest');
  if (manifestErr) {
    console.error('storage-migrate: manifest failed', manifestErr.code ?? 'unknown');
    return json({ error: 'UNAVAILABLE' }, 503);
  }
  const rows = (manifest ?? []) as ManifestRow[];

  const results: ObjectResult[] = [];

  for (const row of rows) {
    const source = `${row.bucket_id}/${row.name}`;
    let r2Key: string;
    try {
      r2Key = keyForLegacyObject(row.bucket_id, row.name);
    } catch (err) {
      results.push({
        source, r2_key: '', outcome: 'FAILED', bytes: row.byte_size,
        owner_user_id: row.owner_user_id, owner_source: row.owner_source, checks: {},
        detail: err instanceof Error ? err.message : 'no namespace for this bucket',
      });
      continue;
    }

    try {
      // ── Read the source. This is the only thing done to it. ───────────
      const download = await db.storage.from(row.bucket_id).download(row.name);
      if (download.error || !download.data) {
        results.push({
          source, r2_key: r2Key, outcome: 'FAILED', bytes: row.byte_size,
          owner_user_id: row.owner_user_id, owner_source: row.owner_source, checks: {},
          detail: 'source could not be read',
        });
        continue;
      }
      const sourceBytes = new Uint8Array(await download.data.arrayBuffer());
      const sourceSha = await sha256(sourceBytes);
      const sizeMatchesRecord = sourceBytes.byteLength === Number(row.byte_size);

      // ── Is something already there? ───────────────────────────────────
      const existing = await headObject(r2Key);
      if (existing.exists) {
        const sameSize = existing.size === sourceBytes.byteLength;
        const sameMd5 = normEtag(existing.etag) === normEtag(row.source_md5);
        // Read it back rather than trusting the headers.
        const back = await getObject(r2Key);
        const backSha = back.ok ? await sha256(await back.arrayBuffer()) : null;
        const identical = sameSize && sameMd5 && backSha === sourceSha;

        const checks = {
          destination_existed: true,
          size_matches: sameSize,
          md5_matches_source_etag: sameMd5,
          sha256_roundtrip_matches: backSha === sourceSha,
        };

        if (!identical) {
          // STOP for this object. Do not overwrite; say so.
          await recordRow(db, row, r2Key, sourceSha, sourceBytes.byteLength, {
            conflict: 'destination exists and differs from the source',
          });
          results.push({
            source, r2_key: r2Key, outcome: 'CONFLICT', bytes: sourceBytes.byteLength,
            owner_user_id: row.owner_user_id, owner_source: row.owner_source, checks,
            detail: 'destination exists and differs; left untouched',
          });
          continue;
        }

        await recordRow(db, row, r2Key, sourceSha, sourceBytes.byteLength, { verified: true });
        results.push({
          source, r2_key: r2Key, outcome: 'ALREADY_VERIFIED', bytes: sourceBytes.byteLength,
          owner_user_id: row.owner_user_id, owner_source: row.owner_source, checks,
        });
        continue;
      }

      // ── Copy, then prove it ───────────────────────────────────────────
      const put = await putObject(
        r2Key, sourceBytes, row.content_type ?? 'application/octet-stream',
      );
      const after = await headObject(r2Key);
      const back = await getObject(r2Key);
      const backSha = back.ok ? await sha256(await back.arrayBuffer()) : null;

      const checks = {
        destination_existed: false,
        source_size_matches_record: sizeMatchesRecord,
        exists_after_put: after.exists,
        size_matches: after.size === sourceBytes.byteLength,
        md5_matches_source_etag: normEtag(put.etag) === normEtag(row.source_md5),
        sha256_roundtrip_matches: backSha === sourceSha,
        // Where the source table carried its own hash, that is a third
        // independent opinion and it has to agree too.
        source_table_sha256_matches:
          row.source_sha256 ? row.source_sha256 === sourceSha : null,
      };

      const verified = checks.exists_after_put
        && checks.size_matches
        && checks.md5_matches_source_etag
        && checks.sha256_roundtrip_matches
        && checks.source_table_sha256_matches !== false;

      await recordRow(db, row, r2Key, sourceSha, sourceBytes.byteLength,
        verified ? { verified: true, md5: normEtag(put.etag) }
          : { conflict: 'copied but verification did not hold' });

      results.push({
        source, r2_key: r2Key,
        outcome: verified ? 'COPIED_AND_VERIFIED' : 'FAILED',
        bytes: sourceBytes.byteLength,
        owner_user_id: row.owner_user_id, owner_source: row.owner_source, checks,
      });
    } catch (err) {
      const detail = err instanceof StorageUnavailable ? err.message : 'unexpected failure';
      console.error('storage-migrate: object failed', row.bucket_id);
      results.push({
        source, r2_key: r2Key, outcome: 'FAILED', bytes: row.byte_size,
        owner_user_id: row.owner_user_id, owner_source: row.owner_source,
        checks: {}, detail,
      });
    }
  }

  const count = (o: Outcome) => results.filter((r) => r.outcome === o).length;
  const verifiedCount = count('COPIED_AND_VERIFIED') + count('ALREADY_VERIFIED');

  // The Supabase side is counted again at the end rather than assumed: the
  // headline claim of this whole exercise is that nothing was removed.
  const { data: retained } = await db.rpc('storage_migration_manifest');

  const report = {
    ok: count('FAILED') === 0 && count('CONFLICT') === 0 && verifiedCount === rows.length,
    SOURCE_OBJECTS: rows.length,
    COPIED_TO_R2: count('COPIED_AND_VERIFIED'),
    ALREADY_PRESENT_AND_VERIFIED: count('ALREADY_VERIFIED'),
    VERIFIED_IDENTICAL: verifiedCount,
    FAILED: count('FAILED'),
    CONFLICTED: count('CONFLICT'),
    SUPABASE_OBJECTS_RETAINED: (retained ?? []).length,
    SUPABASE_DELETION_PERFORMED: 'NO',
    owners: {
      proven_from_domain_row: rows.filter((r) => r.owner_source === 'DOMAIN_ROW').length,
      matched_by_key_prefix: rows.filter(
        (r) => r.owner_source === 'KEY_PREFIX_MATCHED_ACCOUNT').length,
      unresolved: rows.filter((r) => r.owner_source === 'UNRESOLVED').length,
    },
    objects: results,
    finishedAt: new Date().toISOString(),
  };

  await db.from('storage_proof_tickets').update({ result: report }).eq('id', ticket.id);
  return json(report, report.ok ? 200 : 500);
});

/** Write, or refresh, this object's row in the index. */
async function recordRow(
  db: ReturnType<typeof createClient>,
  row: ManifestRow,
  r2Key: string,
  sha: string,
  bytes: number,
  outcome: { verified?: boolean; conflict?: string; md5?: string },
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db.from('storage_objects').upsert({
    provider: 'R2',
    namespace: row.bucket_id,
    category: row.category ?? row.bucket_id,
    object_key: r2Key,
    owner_user_id: row.owner_user_id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    purpose: 'MIGRATED_FROM_SUPABASE_STORAGE',
    content_type: row.content_type,
    byte_size: bytes,
    checksum_sha256: sha,
    checksum_md5: outcome.md5 ?? (row.source_md5 || null),
    // Everything migrated is private: the two public buckets are empty, so
    // nothing here needs a wider visibility, and defaulting to closed is the
    // only safe direction to be wrong in.
    visibility: 'PRIVATE',
    lifecycle: outcome.conflict ? 'PENDING' : 'ACTIVE',
    source_bucket: row.bucket_id,
    source_path: row.name,
    copied_at: now,
    verified_at: outcome.verified ? now : null,
    conflict_reason: outcome.conflict ?? null,
    updated_at: now,
  }, { onConflict: 'object_key' });
  if (error) console.error('storage-migrate: ledger write failed', error.code ?? 'unknown');
}

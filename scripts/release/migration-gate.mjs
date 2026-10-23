#!/usr/bin/env node
/*
 * MIGRATION / DEPLOYMENT COMPATIBILITY GATE — fail closed.
 *
 * 2026-10-19: Finance V2's Edge code reached production at 07:05 UTC and its migration on
 * 2026-10-22 16:49 UTC. For 3.4 days the old pricing_policy CHECK would have refused every
 * new paid campaign. A green deploy run proved nothing about the database. This gate runs
 * BEFORE any Edge Function is uploaded and refuses the deploy unless every repository
 * migration newer than the frozen baseline is in the production ledger (or is an explicit,
 * re-proven exception in supabase/migration-gate.json).
 *
 * It only READS production (supabase_migrations.schema_migrations + the manifest's proof
 * queries). It never applies a migration: that stays a reviewed, owner-approved act
 * (RELEASE.md). Recovery: apply the listed migration(s) in version order, then re-run the
 * deploy (workflow_dispatch redeploy=edge).
 *
 *   node scripts/release/migration-gate.mjs --owed <owed.txt>   # CI (needs SUPABASE_ACCESS_TOKEN)
 *   node scripts/release/migration-gate.mjs --ledger <file.json> # offline, a saved ledger
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROJECT_REF = 'ptxajsjhobhvsfhmutjn';

/** The text the ledger stores, normalised the way every apply path differs (CR, trailing space). */
export function normalizeSql(sql) {
  return String(sql ?? '').replace(/\r/g, '').replace(/[ \t]+$/gm, '').replace(/\s+$/, '');
}
export const sqlHash = (sql) => crypto.createHash('md5').update(normalizeSql(sql), 'utf8').digest('hex');

/** Repository migrations newer than the baseline, in version order. */
export function repoMigrations(dir, baseline) {
  return fs.readdirSync(dir).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort()
    .map((f) => ({ version: f.slice(0, 14), stem: f.slice(0, -4), name: f.slice(15, -4), file: path.join(dir, f) }))
    .filter((m) => m.version > baseline);
}

/**
 * Pure decision. ledger: [{ version, name, hash }] (hash = sqlHash of the joined statements,
 * null when the ledger has no statements). proofs: { stem: boolean } for manifest.reconciled.
 * owed: function names this deploy would upload.
 */
export function evaluate({ migrations, ledger, manifest, proofs = {}, owed = [] }) {
  const byVersion = new Map(ledger.map((l) => [l.version, l]));
  const byName = new Map();
  for (const l of ledger) if (l.name) byName.set(l.name, l);
  const rows = [];
  for (const m of migrations) {
    const hit = byVersion.get(m.version) ?? byName.get(m.name) ?? byName.get(m.stem);
    if (hit) {
      const enforced = m.version >= (manifest.contentVerifiedFrom ?? '99999999999999');
      const content = hit.hash == null ? 'NO_STATEMENTS' : hit.hash === m.hash ? 'EXACT' : 'DIFFERS';
      const ok = !(enforced && content !== 'EXACT');
      rows.push({ stem: m.stem, state: 'APPLIED', ledger: `${hit.version} ${hit.name ?? ''}`.trim(), content, enforced, ok });
      continue;
    }
    const rec = manifest.reconciled?.[m.stem];
    if (rec) { rows.push({ stem: m.stem, state: 'RECONCILED', ok: proofs[m.stem] === true, detail: rec.note }); continue; }
    const held = manifest.held?.[m.stem];
    if (held) {
      const blocking = (held.dependents ?? []).filter((d) => owed.includes(d));
      rows.push({ stem: m.stem, state: 'HELD', ok: blocking.length === 0, detail: held.reason, blocking });
      continue;
    }
    rows.push({ stem: m.stem, state: 'PENDING', ok: false });
  }
  return { ok: rows.every((r) => r.ok), rows, failures: rows.filter((r) => !r.ok) };
}

export function report(result) {
  const lines = [];
  for (const r of result.failures) {
    if (r.state === 'PENDING') lines.push(`PENDING   ${r.stem} — not in the production ledger`);
    else if (r.state === 'APPLIED') lines.push(`MISMATCH  ${r.stem} — applied SQL (${r.ledger}) differs from the committed file`);
    else if (r.state === 'RECONCILED') lines.push(`UNPROVEN  ${r.stem} — its reconciliation proof did not return true`);
    else if (r.state === 'HELD') lines.push(`HELD      ${r.stem} — owed function(s) depend on it: ${r.blocking.join(', ')}`);
  }
  return lines;
}

async function query(sql) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('MIGRATION_GATE_NEEDS_SUPABASE_ACCESS_TOKEN');
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`MIGRATION_GATE_QUERY_HTTP_${res.status}`);
  return res.json();
}

async function main() {
  const arg = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null; };
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'supabase/migration-baseline.json'), 'utf8')).baselineThrough;
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'supabase/migration-gate.json'), 'utf8'));
  const migrations = repoMigrations(path.join(ROOT, 'supabase/migrations'), baseline)
    .map((m) => ({ ...m, hash: sqlHash(fs.readFileSync(m.file, 'utf8')) }));
  const owedFile = arg('--owed');
  const owed = owedFile ? fs.readFileSync(owedFile, 'utf8').trim().split(/\s+/).filter(Boolean) : [];

  let ledger; const proofs = {};
  const ledgerFile = arg('--ledger');
  if (ledgerFile) {
    ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
    for (const stem of Object.keys(manifest.reconciled ?? {})) proofs[stem] = true; // offline: proofs not re-run
  } else {
    /* Hash computed in SQL with the same normalisation as normalizeSql. */
    const rows = await query(`select version, name,
        case when statements is null then null else md5(regexp_replace(regexp_replace(replace(array_to_string(statements, ''), chr(13), ''), '[ \\t]+$', '', 'gn'), '\\s+$', '')) end as hash
      from supabase_migrations.schema_migrations`);
    ledger = rows;
    for (const [stem, rec] of Object.entries(manifest.reconciled ?? {})) {
      const r = await query(`select (${rec.proof}) as ok`);
      proofs[stem] = r?.[0]?.ok === true;
    }
  }
  const result = evaluate({ migrations, ledger, manifest, proofs, owed });
  const counts = result.rows.reduce((a, r) => ((a[r.state] = (a[r.state] ?? 0) + 1), a), {});
  console.log(`migration gate: ${migrations.length} migration(s) after baseline ${baseline}; ${JSON.stringify(counts)}`);
  for (const r of result.rows) if (r.state === 'APPLIED' && r.content === 'DIFFERS' && !r.enforced) console.log(`note      ${r.stem} — applied SQL differs from the file (before contentVerifiedFrom; reported only)`);
  if (!result.ok) {
    for (const l of report(result)) console.log(`::error::${l}`);
    console.log('::error::MIGRATION_GATE_FAILED — nothing was deployed. Apply the pending migration(s) in version order (reviewed MCP apply or the run_migrations dispatch), then re-run with redeploy=edge.');
    process.exit(1);
  }
  console.log('migration gate: PASS — production schema is compatible with this deploy.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.log(`::error::${e.message}`); process.exit(1); });
}

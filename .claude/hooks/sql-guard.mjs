#!/usr/bin/env node
/*
 * HOMATCH SQL GUARD — PreToolUse hook for the Supabase MCP SQL tools.
 *
 * The owner pre-approved two kinds of production SQL (docs/claude/RELEASE.md,
 * "Routine operations"):
 *
 *   1. read-only inspection — SELECT / WITH / EXPLAIN / SHOW / TABLE / VALUES
 *      with no data-changing statement, no SELECT INTO, no row locks and no
 *      function call outside a known read-only set;
 *   2. applying a repository-reviewed migration — the exact bytes of a file in
 *      supabase/migrations/ that is already on origin/main (merged = reviewed),
 *      on the HOMATCH project.
 *
 * Those are answered `allow` (no prompt). EVERYTHING ELSE is answered `ask`:
 * the person decides. This hook never answers `deny` and never widens a
 * permission beyond those two shapes. A parse it cannot be sure of is `ask`.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

export const PROJECT_REF = 'ptxajsjhobhvsfhmutjn';

const SAFE_FUNCTIONS = new Set(`
count sum min max avg bool_and bool_or every array_agg string_agg json_agg jsonb_agg json_object_agg jsonb_object_agg
coalesce nullif greatest least now current_date current_timestamp localtimestamp clock_timestamp statement_timestamp
lower upper length char_length octet_length substring substr position strpos split_part replace trim btrim ltrim rtrim
left right concat concat_ws format md5 encode decode abs round floor ceil ceiling trunc mod power sqrt random
date_trunc date_part extract age make_interval to_char to_date to_timestamp to_number
row_number rank dense_rank lag lead first_value last_value ntile percentile_cont percentile_disc
jsonb_typeof json_typeof jsonb_array_length json_array_length jsonb_each jsonb_each_text jsonb_object_keys
jsonb_array_elements jsonb_array_elements_text jsonb_extract_path jsonb_extract_path_text jsonb_build_object
json_build_object jsonb_build_array json_build_array jsonb_pretty to_jsonb to_json row_to_json jsonb_path_query
array_length array_to_string array_position unnest cardinality generate_series string_to_array regexp_replace
regexp_match regexp_matches regexp_split_to_array starts_with
format_type obj_description col_description shobj_description to_regclass to_regproc to_regprocedure to_regtype
pg_get_functiondef pg_get_function_arguments pg_get_function_result pg_get_function_identity_arguments
pg_get_viewdef pg_get_triggerdef pg_get_indexdef pg_get_constraintdef pg_get_expr pg_get_userbyid pg_get_serial_sequence
pg_size_pretty pg_relation_size pg_total_relation_size pg_table_size pg_indexes_size pg_database_size
has_table_privilege has_function_privilege has_schema_privilege has_column_privilege has_sequence_privilege
pg_has_role current_user session_user current_schema current_setting version txid_current_if_assigned
exists any all in values over filter cast as on using not and or is between like ilike similar distinct case when
`.split(/\s+/).filter(Boolean));

const WRITE_WORDS = /\b(insert|update|delete|merge|upsert|drop|alter|create|truncate|grant|revoke|copy|call|do|vacuum|analyze|reindex|cluster|refresh|lock|reset|notify|listen|unlisten|discard|prepare|execute|deallocate|checkpoint|import|security\s+label|comment\s+on|set\s+(role|session)|nextval|setval)\b/i;

/** SQL with comments and literals removed; null when it cannot be read safely. */
export function stripSql(sql) {
  let s = String(sql ?? '').replace(/\r\n?/g, '\n');
  s = s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
  if (/\$[a-z_]*\$/i.test(s)) return null; // dollar quoting in an inspection query: not provable
  s = s.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, 'ident');
  if (/['"]/.test(s.replace(/''/g, ''))) return null; // unbalanced quote
  return s;
}

/** Is this SQL provably read-only? Returns { ok, why }. */
export function readOnly(sql) {
  const s = stripSql(sql);
  if (s == null) return { ok: false, why: 'quoting the guard cannot read safely' };
  const statements = s.split(';').map((x) => x.trim()).filter(Boolean);
  if (!statements.length) return { ok: false, why: 'empty' };
  for (let st of statements) {
    if (/^explain\b/i.test(st)) {
      if (/\banaly[sz]e\b/i.test(st)) return { ok: false, why: 'EXPLAIN ANALYZE executes the statement' };
      st = st.replace(/^explain\s*(\([^)]*\)\s*)?(verbose\s+|costs\s+|format\s+\w+\s+)*/i, '');
    }
    if (!/^(select|with|show|table|values)\b/i.test(st)) return { ok: false, why: `statement starts with "${st.split(/\s+/)[0]}"` };
    const w = st.match(WRITE_WORDS);
    if (w) return { ok: false, why: `contains ${w[1].toUpperCase()}` };
    if (/\binto\b/i.test(st)) return { ok: false, why: 'SELECT … INTO creates a table' };
    if (/\bfor\s+(no\s+key\s+)?(update|share|key\s+share)\b/i.test(st)) return { ok: false, why: 'takes row locks' };
    for (const m of st.matchAll(/([a-z_][a-z0-9_$]*(?:\s*\.\s*[a-z_][a-z0-9_$]*)?)\s*\(/gi)) {
      const name = m[1].replace(/\s+/g, '').toLowerCase().replace(/^pg_catalog\./, '');
      if (!SAFE_FUNCTIONS.has(name)) return { ok: false, why: `calls ${name}() — not on the read-only list` };
    }
  }
  return { ok: true, why: 'read-only inspection' };
}

const norm = (t) => String(t ?? '').replace(/\r\n?/g, '\n').trim();

/** Is `query` byte-for-byte (modulo line endings / outer whitespace) a migration on origin/main? */
export function reviewedMigration(name, query, root = process.cwd(), show = (p) => execFileSync('git', ['show', `origin/main:${p}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) {
  const dir = join(root, 'supabase/migrations');
  if (!existsSync(dir)) return null;
  const want = norm(query);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql'))) {
    if (name && !f.includes(String(name).replace(/[^a-z0-9_]/gi, ''))) continue;
    const path = `supabase/migrations/${f}`;
    if (norm(readFileSync(join(dir, f), 'utf8')) !== want) continue;
    try { if (norm(show(path)) === want) return path; } catch { /* not on main: not reviewed */ }
  }
  return null;
}

/** The hook's answer for one PreToolUse payload. */
export function decide(payload, opts = {}) {
  const tool = payload?.tool_name ?? '';
  const input = payload?.tool_input ?? {};
  const ask = (why) => ({ permissionDecision: 'ask', permissionDecisionReason: `HOMATCH SQL guard: ${why}` });
  const allow = (why) => ({ permissionDecision: 'allow', permissionDecisionReason: `HOMATCH SQL guard: ${why}` });
  if (input.project_id && input.project_id !== PROJECT_REF) return ask(`project ${input.project_id} is not the HOMATCH project`);
  if (/execute_sql$/.test(tool)) {
    const r = readOnly(input.query);
    return r.ok ? allow('read-only inspection (pre-approved)') : ask(`not provably read-only (${r.why}) — confirm`);
  }
  if (/apply_migration$/.test(tool)) {
    const path = reviewedMigration(input.name, input.query, opts.root ?? payload?.cwd ?? process.cwd(), opts.show);
    return path ? allow(`applies reviewed migration ${path} exactly as merged (pre-approved)`) : ask('this SQL is not a migration file already on origin/main — confirm');
  }
  return null;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  let raw = '';
  process.stdin.on('data', (d) => { raw += d; }).on('end', () => {
    let out = null;
    try { out = decide(JSON.parse(raw)); } catch { out = { permissionDecision: 'ask', permissionDecisionReason: 'HOMATCH SQL guard could not read the request' }; }
    if (out) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...out } }));
    process.exit(0);
  });
}

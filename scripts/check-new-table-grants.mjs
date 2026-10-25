#!/usr/bin/env node
// Gate NEW migration files only; historical migrations are deliberately unchanged.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const base = process.env.RELEASE_BASE || 'origin/main';
let paths;
try {
  paths = execFileSync('git', ['diff', '--name-only', '--diff-filter=A', `${base}...HEAD`, '--', 'supabase/migrations/'], { encoding: 'utf8' }).trim().split('\n').filter(p => p.endsWith('.sql'));
} catch (error) {
  console.error(`Cannot compare new migrations against ${base}:`, error.message);
  process.exit(2);
}
let failed = false;
for (const path of paths) {
  const sql = readFileSync(path, 'utf8').replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
  const created = [...sql.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\.)?"?([a-zA-Z_][\w]*)"?\s*\(/gi)];
  for (const [, table] of created) {
    // Only explicit public-qualified CREATE TABLE is covered. Other schemas are not Data API public tables.
    const expression = new RegExp('\\bcreate\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?"?public"?\\."?' + table + '"?\\s*\\(', 'i');
    if (!expression.test(sql)) continue;
    const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const grant = new RegExp('\\bgrant\\s+[\\s\\S]*?\\bon\\s+(?:table\\s+)?(?:"?public"?\\.)?"?' + escaped + '"?\\s+to\\s+(?:service_role|authenticated|anon)\\b', 'i');
    if (!grant.test(sql)) {
      console.error(`${path}: public.${table} created without explicit API role GRANT. See docs/supabase-data-api-grants.md`);
      failed = true;
    }
  }
}
if (failed) process.exit(1);
console.log(`Explicit public table grant check passed (${paths.length} new migrations scanned).`);

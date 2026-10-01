/*
 * HOMATCH RELEASE — the frontend / test import graph.
 *
 * Which files can a change reach? Every `import … from`, `export … from`,
 * side-effect `import '…'` and dynamic `import('…')` in src/ and tests/,
 * resolved through the `@/` alias and relative paths, inverted so a changed
 * file walks UP to everything that depends on it.
 *
 * One boundary: a DYNAMIC import made by the application shell (the lazy
 * route table) does not carry a page's change into the shell. A page that
 * only the route table imports changes that route, not every route. A STATIC
 * import by the shell does carry it — that code runs on every screen.
 *
 * Pure apart from listFiles/read, which tests inject.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, posix } from 'node:path';

export const norm = (p) => String(p).replace(/\\/g, '/').replace(/\r/g, '').trim();

const SCANNED = /^(src|tests)\/.*\.(ts|tsx|js|jsx|mjs|cjs)$/;
const EXTS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '/index.ts', '/index.tsx', '/index.js', '/index.mjs'];
const STATIC_RE = /(?:^|[\s;])(?:import|export)\s+(?:type\s+)?[^'"`;]*?\sfrom\s*['"]([^'"\n]+)['"]/g;
const BARE_RE = /(?:^|[\s;])import\s*['"]([^'"\n]+)['"]/g;
const DYNAMIC_RE = /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g;

export function resolveSpecifier(from, spec, files) {
  const clean = spec.split('?')[0];
  let base;
  if (clean.startsWith('@/')) base = `src/${clean.slice(2)}`;
  else if (clean.startsWith('.')) base = posix.normalize(posix.join(dirname(from).replace(/\\/g, '/'), clean));
  else return null; // a package: outside the graph
  for (const ext of EXTS) if (files.has(base + ext)) return base + ext;
  return null;
}

/** Parse one file's imports: [{ spec, dynamic }]. */
export function parseImports(text) {
  const body = text.length > 2_000_000 ? text.slice(0, 200_000) : text;
  const out = [];
  for (const m of body.matchAll(STATIC_RE)) out.push({ spec: m[1], dynamic: false });
  for (const m of body.matchAll(BARE_RE)) out.push({ spec: m[1], dynamic: false });
  for (const m of body.matchAll(DYNAMIC_RE)) out.push({ spec: m[1], dynamic: true });
  return out;
}

function gitFiles(cwd) {
  const run = (...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  return [...run('ls-files').split('\n'), ...run('ls-files', '--others', '--exclude-standard').split('\n')].map(norm).filter(Boolean);
}

/**
 * Build the reverse graph. Returns { files, importers } where
 * importers.get(file) = [{ from, dynamic }].
 */
export function buildGraph({ cwd = process.cwd(), listFiles, read } = {}) {
  const all = (listFiles ? listFiles() : gitFiles(cwd)).map(norm);
  const files = new Set(all);
  const reader = read ?? ((f) => readFileSync(`${cwd}/${f}`, 'utf8'));
  const importers = new Map();
  for (const f of all) {
    if (!SCANNED.test(f)) continue;
    let text;
    try { text = reader(f); } catch { continue; }
    for (const { spec, dynamic } of parseImports(text)) {
      const target = resolveSpecifier(f, spec, files);
      if (!target || target === f) continue;
      if (!importers.has(target)) importers.set(target, []);
      importers.get(target).push({ from: f, dynamic });
    }
  }
  return { files, importers };
}

/**
 * Everything a change to `file` can reach, walking importers upward.
 * `isShell(f)` names the application-shell files whose dynamic imports are
 * route boundaries. Returns the set of reached files (including `file`).
 */
export function dependentsOf(graph, file, isShell = () => false) {
  const seen = new Set([file]);
  const stack = [file];
  while (stack.length) {
    const cur = stack.pop();
    for (const { from, dynamic } of graph.importers.get(cur) ?? []) {
      if (dynamic && isShell(from)) continue; // lazy route: the shell is not changed by its pages
      if (!seen.has(from)) { seen.add(from); stack.push(from); }
    }
  }
  return seen;
}

// NavigationStack — reliable parent/child traversal bookkeeping
// (2026-09-05, per the "NAVIGATION STACK" requirement).
//
// This module owns none of the actual browser navigation (that stays in
// index.js, since it needs Playwright pages/frames) — it is the pure
// "what have we already visited, what is still queued, what is the current
// parent/child path" bookkeeping that makes exhaustive-but-non-looping
// traversal possible: TAS_RESULTS -> RESULT #7 -> DOCUMENT #1 -> (back) ->
// DOCUMENT #2 -> (back) -> (back to TAS_RESULTS) -> RESULT #8 -> ...
//
// Dedup key: normalizeKey() strips whitespace/case and drops the most
// common tracking/session query params so two links that are the same
// underlying resource (differing only by a cache-busting or session
// parameter) are correctly treated as already-visited, while two genuinely
// different result rows/documents are not accidentally collapsed together.

const VOLATILE_PARAMS = new Set(['t', 'ts', '_', 'sid', 'sessionid', 'session_id', 'cachebust', 'rnd', 'random']);

function normalizeKey(idOrUrl) {
  const raw = String(idOrUrl || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    for (const p of [...u.searchParams.keys()]) if (VOLATILE_PARAMS.has(p.toLowerCase())) u.searchParams.delete(p);
    u.hash = '';
    return u.toString().toLowerCase();
  } catch {
    // Not a URL (e.g. a synthetic "grid-row-7" id) — just normalize
    // whitespace/case so trivially-different-looking ids that mean the
    // same thing still collide on purpose only when byte-identical.
    return raw.toLowerCase().replace(/\s+/g, ' ');
  }
}

class NavigationStack {
  constructor(rootLabel = 'ROOT') {
    this._visited = new Set();
    this._path = [{ label: rootLabel, key: normalizeKey(rootLabel) }];
    this._log = [];
  }

  /** True if this id/url has already been visited anywhere in this job
   * (not just under the current parent) — the global loop guard. */
  hasVisited(idOrUrl) { return this._visited.has(normalizeKey(idOrUrl)); }

  /** Enter a child node (a result row, a document, a page). Records it as
   * visited and pushes it onto the current path. Returns false without
   * changing state if this exact node was already visited (caller should
   * skip it instead of re-entering — the loop guard). */
  enter(label, idOrUrl) {
    const key = normalizeKey(idOrUrl ?? label);
    if (this._visited.has(key)) { this._log.push({ action: 'SKIP_ALREADY_VISITED', label, key }); return false; }
    this._visited.add(key);
    this._path.push({ label, key });
    this._log.push({ action: 'ENTER', label, key, depth: this._path.length - 1 });
    return true;
  }

  /** Leave the current node, returning to its parent. No-ops (and logs)
   * if already at the root — never throws on an unbalanced back(). */
  back() {
    if (this._path.length <= 1) { this._log.push({ action: 'BACK_AT_ROOT' }); return; }
    const left = this._path.pop();
    this._log.push({ action: 'BACK', from: left.label, to: this._path[this._path.length - 1].label, depth: this._path.length - 1 });
  }

  /** The current parent/child breadcrumb, e.g.
   * ["TAS_RESULTS","RESULT #7","DOCUMENT #1"]. */
  currentPath() { return this._path.map(p => p.label); }

  visitedCount() { return this._visited.size; }

  /** Full ordered ENTER/BACK/SKIP trace — exposed per-source for human
   * audit, same spirit as the interaction traces index.js already records
   * for search/submit steps. */
  trace() { return this._log.slice(); }
}

export { NavigationStack, normalizeKey };

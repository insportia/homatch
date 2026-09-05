// Entity discovery — source-agnostic (2026-09-05, per the "ENTITY DISCOVERY
// — GLOBAL RULE" requirement).
//
// It does not matter which source (TAS, NAPR/MyGov, an online document, an
// extract, a decision) a company name + identification code is found in —
// whenever both appear together in retrieved text, that is a
// DISCOVERED_ENTITY worth queuing for ENREG research. This module only does
// the deterministic extraction + store/merge part; it has no knowledge of
// Playwright, HTTP, or any specific source and is fully unit-testable with
// plain fixture text.
//
// Georgian legal-entity markers this recognizes (deliberately conservative
// — real markers actually used in registry documents, not a guess at every
// possible business-name pattern):
//   შპს   - შეზღუდული პასუხისმგებლობის საზოგადოება (LLC)
//   სს    - სააქციო საზოგადოება (JSC)
//   ააიპ  - არასამეწარმეო (არაკომერციული) იურიდიული პირი (non-profit)
//   ინდივიდუალური მეწარმე / ინდ. მეწარმე (individual entrepreneur)
//
// Georgian legal-entity identification codes are 9-digit numbers (the
// standard format issued by the Revenue Service / registered at enreg) —
// this module only ever extracts a 9-digit run explicitly adjacent to (on
// the same line as, or within a short window of) an entity-name match; a
// bare 9-digit number elsewhere in a document (which could be almost
// anything — a phone number, a cadastral fragment, a case number) is never
// treated as an identification code on its own. That keeps this an
// evidence-following extractor, never a speculative regex-everything net.

const ENTITY_MARKER = /(შპს|ააიპ|სს|ინდივიდუალურ(?:ი|ი\s*მეწარმე))/;
// A name is "markerword" + a following run of words up to punctuation/EOL,
// capped so a runaway sentence never gets swallowed as a "company name".
const ENTITY_NAME_RE = new RegExp(`(${ENTITY_MARKER.source})\\s*[«"“”'\\u201e\\u201c]?\\s*([^,.;\\n()«»"“”]{2,80})`, 'g');
const ID_CODE_RE = /\b(\d{9})\b/;

/** Extracts every plausible (entityName, idCode|null) pair from a block of
 * text. idCode is set only when a 9-digit run appears within `windowChars`
 * of the matched entity name (same sentence/line, not merely "somewhere in
 * the document") — otherwise the candidate is returned with idCode:null so
 * callers can still track it as an incomplete candidate per the spec
 * ("if only the company name is initially discovered, store an incomplete
 * entity candidate"). */
function extractEntityCandidates(text, { windowChars = 120 } = {}) {
  if (!text) return [];
  const out = [];
  let m;
  ENTITY_NAME_RE.lastIndex = 0;
  while ((m = ENTITY_NAME_RE.exec(text))) {
    const marker = m[1].trim();
    const rawName = `${marker} ${m[2].trim()}`.replace(/\s+/g, ' ').trim();
    if (rawName.length < marker.length + 2) continue; // marker with no real name after it
    const start = Math.max(0, m.index - windowChars);
    const end = Math.min(text.length, m.index + m[0].length + windowChars);
    const window = text.slice(start, end);
    const idMatch = ID_CODE_RE.exec(window);
    out.push({ name: rawName, idCode: idMatch ? idMatch[1] : null });
  }
  return out;
}

const normalizeName = n => String(n || '').toLowerCase().replace(/[«»"“”'„“]/g, '').replace(/\s+/g, ' ').trim();

/** A small in-memory ledger of discovered entities for one Verify job.
 * Dedup/merge key: identification code when known (the reliable identity),
 * else the normalized name (best-effort, may later be merged into the
 * id-code record once one is discovered for the same name — see upgrade()).
 * Never merges two DIFFERENT id codes into one record, and never silently
 * drops the earlier discovery when a later mention lacks the code — it
 * keeps the richer of the two. */
class EntityLedger {
  constructor() { this._byId = new Map(); this._byName = new Map(); }

  /** Record one candidate discovery. `source` (e.g. 'tas'), `sourceDocument`
   * (url), `documentDate`, `relationship` (free-text context, e.g.
   * "listed as applicant on this TAS record") and `evidenceRef` (a short
   * pointer back to where in the evidence this came from) are all optional
   * but should be supplied whenever known — this never fabricates any of
   * them when omitted. */
  add(candidate, meta = {}) {
    if (!candidate?.name) return null;
    const nameKey = normalizeName(candidate.name);
    if (!nameKey) return null;
    const existingById = candidate.idCode ? this._byId.get(candidate.idCode) : null;
    const existingByName = this._byName.get(nameKey);
    let rec = existingById || existingByName;
    if (!rec) {
      rec = {
        name: candidate.name,
        idCode: candidate.idCode || null,
        status: candidate.idCode ? 'CONFIRMED' : 'INCOMPLETE',
        discoveries: [],
      };
      this._byName.set(nameKey, rec);
      if (rec.idCode) this._byId.set(rec.idCode, rec);
    } else if (candidate.idCode && !rec.idCode) {
      // Upgrade an incomplete candidate to confirmed once its id code shows
      // up in a later discovery — merge, never duplicate.
      rec.idCode = candidate.idCode;
      rec.status = 'CONFIRMED';
      this._byId.set(rec.idCode, rec);
    } else if (candidate.idCode && rec.idCode && rec.idCode !== candidate.idCode) {
      // Genuinely different id codes sharing a similar name are NOT the
      // same entity — record the second one separately rather than
      // corrupting the first.
      rec = { name: candidate.name, idCode: candidate.idCode, status: 'CONFIRMED', discoveries: [] };
      this._byId.set(candidate.idCode, rec);
    }
    rec.discoveries.push({
      source: meta.source || null,
      sourceDocument: meta.sourceDocument || null,
      documentDate: meta.documentDate || null,
      relationship: meta.relationship || null,
      evidenceRef: meta.evidenceRef || null,
      retrievedAt: meta.retrievedAt || null,
    });
    return rec;
  }

  /** Convenience: scan a block of text and add every candidate found in it
   * with the same shared metadata. */
  scanText(text, meta = {}) {
    for (const c of extractEntityCandidates(text)) this.add(c, meta);
  }

  all() { return [...new Set([...this._byId.values(), ...this._byName.values()])]; }
  confirmed() { return this.all().filter(e => e.status === 'CONFIRMED'); }
  incomplete() { return this.all().filter(e => e.status === 'INCOMPLETE'); }
}

export { extractEntityCandidates, EntityLedger, normalizeName };

// RE-QUALIFICATION — the same decision the live pipeline makes, applied to
// leads that are already stored. Used to correct a finished campaign's
// results from its stored evidence (no provider call, no money) and as the
// regression harness for the VILLION baseline. Nothing is deleted: callers
// write the category/reasons next to the original evidence.

import { classifyComment, classifyDemand, type DemandReading, type DemandRole } from './demandClassifier.ts';
import { qualify, type Qualification } from './qualify.ts';
import { contentFingerprint } from './identity.ts';
import type { PropertyDna } from './propertyDna.ts';

export interface StoredLead {
  id: string;
  text: string;
  publishedAt: string | null;
  url?: string | null;
  /** A deterministic author key or the display name on the same network. */
  author?: string | null;
  kind?: 'POST' | 'COMMENT' | 'MESSAGE';
  parent?: { role: DemandRole | null; similarity: number } | null;
}

export interface Requalified {
  id: string;
  reading: DemandReading;
  qualification: Qualification;
  duplicateOf: string | null;
}

const DAY = 86_400_000;

/** One URL per post: host/case/query/fragment noise and FB permalink forms folded. */
export function canonicalSourceUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try { u = new URL(String(url)); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile|web|mbasic)\./, '');
  let path = u.pathname.replace(/\/+$/, '');
  /* facebook.com/groups/<g>/posts/<id> ≡ /groups/<g>/permalink/<id> */
  path = path.replace(/^\/groups\/([^/]+)\/posts\/(\d+)/, '/groups/$1/permalink/$2');
  const keep = host.endsWith('facebook.com') && path === '/permalink.php'
    ? ['story_fbid', 'id'].map((k) => (u.searchParams.get(k) ? `${k}=${u.searchParams.get(k)}` : '')).filter(Boolean).join('&') : '';
  return `${host}${path}${keep ? `?${keep}` : ''}`;
}

/** The same words from the same author (or the same canonical URL) are one candidate. */
export function duplicateKey(l: Pick<StoredLead, 'text' | 'author' | 'url'>): string[] {
  const keys: string[] = [];
  const canon = canonicalSourceUrl(l.url);
  if (canon) keys.push(`url:${canon}`);
  const fp = contentFingerprint(l.text);
  if (l.author) keys.push(`author:${String(l.author).trim().toLowerCase()}|${fp}`);
  /* Long identical texts are the same post even from an unknown author. */
  if (String(l.text ?? '').trim().length >= 80) keys.push(`text:${fp}`);
  return keys;
}

export function requalifyLeads(leads: StoredLead[], dna: PropertyDna, opts: { now?: number; fx?: Partial<Record<string, number>> } = {}): Requalified[] {
  const now = opts.now ?? Date.now();
  const seen = new Map<string, string>();
  const ordered = [...leads].sort((a, b) => Date.parse(a.publishedAt ?? '') - Date.parse(b.publishedAt ?? ''));
  const out = new Map<string, Requalified>();
  for (const l of ordered) {
    const keys = duplicateKey(l);
    const dupOf = keys.map((k) => seen.get(k)).find(Boolean) ?? null;
    keys.forEach((k) => { if (!seen.has(k)) seen.set(k, l.id); });
    const reading = l.kind === 'COMMENT' ? classifyComment(l.text, l.parent ?? null) : classifyDemand(l.text, { kind: l.kind ?? 'POST' });
    const t = Date.parse(l.publishedAt ?? '');
    const ageDays = Number.isFinite(t) ? Math.max(0, (now - t) / DAY) : null;
    out.set(l.id, { id: l.id, reading, qualification: qualify(reading, dna, { ageDays, duplicate: Boolean(dupOf), fx: opts.fx }), duplicateOf: dupOf });
  }
  return leads.map((l) => out.get(l.id)!);
}

export interface CampaignQuality {
  candidates: number;
  shown: number;
  byCategory: Record<'STRONG' | 'POTENTIAL' | 'WEAK' | 'REJECTED', number>;
  byRole: Record<string, number>;
  byReason: Record<string, number>;
}

export function summarize(rows: Requalified[]): CampaignQuality {
  const byCategory = { STRONG: 0, POTENTIAL: 0, WEAK: 0, REJECTED: 0 };
  const byRole: Record<string, number> = {};
  const byReason: Record<string, number> = {};
  for (const r of rows) {
    byCategory[r.qualification.category]++;
    byRole[r.reading.role] = (byRole[r.reading.role] ?? 0) + 1;
    for (const x of r.qualification.reasons) byReason[x] = (byReason[x] ?? 0) + 1;
  }
  return { candidates: rows.length, shown: rows.length - byCategory.REJECTED, byCategory, byRole, byReason };
}

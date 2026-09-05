// EvidenceLedger.ts — mandate Section 17: "the authoritative source of
// truth ... AI synthesis must not receive arbitrary browser text and invent
// a report." Every fact that can ever reach a customer report, an internal
// status field, or narrative prose must first exist here as a structured
// EvidenceItem. Section 23 restates the concrete production bug this fixes:
// UI fields and narrative text must consume the SAME ledger, so it is
// structurally impossible for the narrative to know something the
// structured fields don't.
import type { EvidenceItem, EvidenceType } from './EvidenceTypes.js';

let counter = 0;
function nextId(): string {
  counter += 1;
  return `ev_${Date.now().toString(36)}_${counter}`;
}

export class EvidenceLedger {
  private readonly items: EvidenceItem[] = [];

  /**
   * Add one evidence item. Enforces "NO EVIDENCE = NO FACT" at the
   * boundary: an item with no source (neither a URL nor a named source) or
   * no retrieval timestamp is refused outright rather than silently stored
   * as if it were normal evidence — this is the structural version of the
   * old applyEvidenceGate() narrative-redaction patch, moved to the point
   * of entry instead of a post-hoc regex sweep over generated prose.
   */
  add(item: Omit<EvidenceItem, 'id' | 'retrievedAt'> & { retrievedAt?: string }): EvidenceItem {
    if (!item.source && !item.sourceUrl) {
      throw new Error('EvidenceLedger.add: refused — an evidence item must name a source or sourceUrl (NO EVIDENCE = NO FACT)');
    }
    const full: EvidenceItem = { id: nextId(), retrievedAt: item.retrievedAt || new Date().toISOString(), ...item } as EvidenceItem;
    this.items.push(full);
    return full;
  }

  all(): EvidenceItem[] {
    return this.items.slice();
  }

  byType(type: EvidenceType): EvidenceItem[] {
    return this.items.filter((i) => i.type === type);
  }

  byEntity(entityId: string): EvidenceItem[] {
    return this.items.filter((i) => i.relatedEntityId === entityId);
  }

  byProperty(propertyId: string): EvidenceItem[] {
    return this.items.filter((i) => i.relatedPropertyId === propertyId);
  }

  /** Only VERIFIED, non-historical items — the set a "CURRENT_FACT" claim
   * (mandate Section 15) is allowed to be built from. */
  currentVerified(): EvidenceItem[] {
    return this.items.filter((i) => i.verificationState === 'VERIFIED' && !i.historical);
  }

  contradictions(): EvidenceItem[] {
    return this.byType('CONTRADICTION');
  }

  /**
   * The structural synthesis-gate primitive (mandate Section 23): true only
   * when the ledger actually contains a VERIFIED item naming this exact
   * field-like claim (by simple substring/id match against the id or
   * claim). This is what SynthesizeReport-style code must call before
   * letting a narrative sentence assert a specific cadastral code / company
   * name / developer / project — replacing the old post-hoc regex
   * redaction (applyEvidenceGate in research-agent) with a check performed
   * BEFORE the sentence is allowed to exist, not after.
   */
  supports(claimSubstring: string): boolean {
    const needle = claimSubstring.trim();
    if (!needle) return false;
    return this.items.some(
      (i) => i.verificationState === 'VERIFIED' && (i.claim.includes(needle) || (i.supportingText || '').includes(needle))
    );
  }

  count(): number {
    return this.items.length;
  }

  toJSON(): EvidenceItem[] {
    return this.all();
  }
}

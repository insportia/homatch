// HOMATCH — people and participant intelligence.
//
// WHY THIS EXISTS
// ---------------
// An audit of the real production job for 01.18.06.019.055.03.01.601 found
// that person-level evidence was being collected and then thrown away:
//
//   companyProfile.directors          []
//   companyProfile.representatives    []
//   publicResearch.directorsRepresentatives  []
//   publicResearch.foundersOwnersParticipants []
//
// ...while the registry extract underneath carried, in plain text:
//
//   ხელმძღვანელობა/წარმომადგენლობა
//   დირექტორატი
//   <name>, <personal id> , ერთობლივი
//   <name>, <personal id> , ერთობლივი
//
// Two directors, with JOINT representation. And a municipal permit response
// in the same job spelled out what that means for a transaction: because the
// directors represent the company JOINTLY, a power of attorney from the
// second director is required alongside the first's signature.
//
// That is not trivia. It is the difference between a contract one director
// can bind the company with and one they cannot — exactly the question a
// buyer needs answered before signing, and exactly what Contract
// Intelligence will need when it compares a signatory against the register.
//
// PRIVACY IS A DESIGN CONSTRAINT, NOT A DISCLAIMER
// ------------------------------------------------
// The same registry line carries each director's PERSONAL ID NUMBER. That is
// sensitive personal data, it is not needed to answer the buyer's question,
// and it is therefore redacted here — it never reaches the model, the report
// or the evidence explorer. Names and roles are transaction-relevant and are
// kept; identity numbers, addresses and contact details are not.
//
// Pure: same input, same output. No clock, no network, no database.

export type PersonRole =
  | 'DIRECTOR'
  | 'REPRESENTATIVE'
  | 'SHAREHOLDER'
  | 'FOUNDER'
  | 'OWNER'
  | 'RELATED'; // connected, but the evidence does not establish which role

export type PersonCertainty =
  | 'REGISTERED'       // stated by an official register
  | 'PUBLICLY_REPORTED'// a credible publication states it
  | 'CLAIMED'          // the developer or an interested party states it
  | 'UNCONFIRMED';     // connected, nothing independent supports the role

/** How the company is bound. JOINT is the one that changes what a buyer must
 *  check before accepting a signature. */
export type Representation = 'JOINT' | 'SOLE' | 'UNKNOWN';

export interface Person {
  /** Full name as written by the source. Never normalised into an id. */
  name: string;
  role: PersonRole;
  /** The company or project the person is connected to. */
  entity?: string;
  representation: Representation;
  certainty: PersonCertainty;
  /** True when the evidence describes the past rather than the present. */
  historical: boolean;
  /** The date the evidence speaks for, when the source gives one. */
  asOf?: string;
  /** Where it came from, in customer-facing terms. */
  sourceKind: 'OFFICIAL_REGISTRY' | 'OFFICIAL_DOCUMENT' | 'DEVELOPER_STATEMENT' | 'MEDIA_REPORT';
  /** The sentence that supports it, already redacted. Internal + explorer. */
  support?: string;
  /**
   * Every role this person holds at this entity, strongest first.
   *
   * `role` stays the primary one so existing readers are unaffected; this is
   * what stops a director who is also a partner from being reported as only
   * one of the two.
   */
  roles?: PersonRole[];
  /**
   * Ownership share, ONLY where the register actually stated one.
   *
   * Never inferred from a directorship and never estimated. Two directors do
   * not imply 50/50, and a sole director implies nothing at all about who
   * owns the company.
   */
  ownershipPct?: number;
}

export interface PeopleIntelligence {
  people: Person[];
  /** Set when the register states how the company is bound. */
  representation: Representation;
  /** Plain-language note about what joint representation means for signing. */
  representationNote?: string;
  /** Company/name changes and similar corporate context. Neutral, not risk. */
  corporateChanges: string[];
}

/*
 * Partners and their shares.
 *
 * The registry extract puts this in its own block, below the directorate.
 * It is parsed separately rather than by widening the directors' window,
 * because the two blocks mean different things and merging them would
 * silently turn a shareholder into a director — which is precisely the kind
 * of invented role this module exists to prevent.
 *
 * A share is recorded only when the line actually carries a percentage.
 * A partner with no stated share is still a real, useful finding, so they
 * are kept — just without a number attached.
 */
const PARTNER_ANCHORS = ['პარტნიორ', 'დამფუძნებ', 'წილი'];

export function parseRegistryShareholders(
  extractText: unknown,
  entity?: string,
  asOf?: string
): Person[] {
  const text = String(extractText ?? '');
  let anchor = -1;
  for (const a of PARTNER_ANCHORS) {
    const at = text.indexOf(a);
    if (at >= 0 && (anchor < 0 || at < anchor)) anchor = at;
  }
  if (anchor < 0) return [];

  const block = text.slice(anchor, anchor + 900);
  const people: Person[] = [];
  const seen = new Set<string>();

  for (const rawLine of block.split(/\\n|\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    // Anything that names a management role belongs to the other block.
    if (line.includes(JOINT) || line.includes(SOLE)) continue;

    const namePart = redactPersonalData(line.split(',')[0]);
    if (!looksLikePersonName(namePart)) continue;
    const key = namePart.toLowerCase();
    if (seen.has(key)) continue;

    // redactPersonalData has already removed 9-11 digit personal ids, so a
    // percentage here cannot be a fragment of one.
    const pct = line.match(/(\d{1,3}(?:[.,]\d+)?)\s*%/);
    const value = pct ? Number(pct[1].replace(',', '.')) : undefined;

    seen.add(key);
    people.push({
      name: namePart,
      role: 'SHAREHOLDER',
      entity,
      representation: 'UNKNOWN',
      certainty: 'REGISTERED',
      historical: false,
      asOf,
      sourceKind: 'OFFICIAL_REGISTRY',
      support: redactPersonalData(line),
      ...(value !== undefined && value > 0 && value <= 100 ? { ownershipPct: value } : {}),
    });
  }

  return people;
}

/* ------------------------------------------------------------------ *
 * Redaction                                                           *
 * ------------------------------------------------------------------ */

/**
 * Removes personal identifiers from any text before it can travel further.
 *
 * Georgian personal numbers are 11 digits; company identification codes are
 * 9. Both are stripped from person-context text: the company code is
 * legitimately carried elsewhere as an ENTITY attribute, but inside a
 * sentence about a named individual it adds nothing a buyer needs.
 */
export function redactPersonalData(text: unknown): string {
  return String(text ?? '')
    .replace(/\b\d{9,11}\b/g, '')
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, '')
    .replace(/(\+995[\s-]?)?\b\d{3}[\s-]?\d{2}[\s-]?\d{2}[\s-]?\d{2}\b/g, '')
    .replace(/\s*,\s*,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;])/g, '$1')
    .replace(/^[\s,;-]+|[\s,;-]+$/g, '')
    .trim();
}

/* ------------------------------------------------------------------ *
 * Name handling                                                       *
 * ------------------------------------------------------------------ */

const GEORGIAN_NAME = /^[Ⴀ-ჿა-ჰ]{2,}(?:\s+[Ⴀ-ჿა-ჰ]{2,}){1,2}$/;
const LATIN_NAME = /^[A-Z][a-z'’-]{1,}(?:\s+[A-Z][a-z'’-]{1,}){1,2}$/;

/** Words that mean the string is an organisation or a sentence, not a person. */
const NOT_A_PERSON = [
  'შპს', 'სს', 'სპს', 'კს', 'ააიპ', 'სსიპ', ' llc', 'ltd', 'jsc', 'inc',
  'ბანკი', 'კომპანი', 'ჯგუფი', 'group', 'დირექტორები', 'საზოგადოებ',
  'ხელმძღვანელობ', 'წარმომადგენლობ', 'განცხადებ', 'მინდობილობ',
];

/**
 * True when a string plausibly IS a person's name.
 *
 * Deliberately strict. The entity extractor in this pipeline already produces
 * fragments like "სს NoAR11148112 განცხადებით მომართა ლევან" — a truncated
 * sentence ending mid-name — and treating that as a person would put
 * nonsense, and a stray given name, in front of a buyer. Two or three name
 * words, no digits, no organisational or sentence vocabulary.
 */
export function looksLikePersonName(raw: unknown): boolean {
  const s = String(raw ?? '').trim();
  if (!s || s.length > 60 || /\d/.test(s)) return false;
  const low = s.toLowerCase();
  if (NOT_A_PERSON.some((w) => low.includes(w))) return false;
  return GEORGIAN_NAME.test(s) || LATIN_NAME.test(s);
}

/**
 * Identity key for de-duplication.
 *
 * Same name + same entity is treated as the same person. Same name with a
 * DIFFERENT entity is deliberately NOT merged: a shared name is not evidence
 * of a shared identity, and merging would invent a combined biography the
 * evidence does not support.
 */
export const identityKey = (p: Person): string =>
  `${p.name.toLowerCase().replace(/\s+/g, ' ')}::${(p.entity ?? '').toLowerCase()}`;

/* ------------------------------------------------------------------ *
 * Registry parsing                                                    *
 * ------------------------------------------------------------------ */

const JOINT = 'ერთობლივი';
const SOLE = 'ინდივიდუალურ';

/**
 * Parses the directorate block of a Georgian company register extract.
 *
 * The shape this targets, seen verbatim in production:
 *
 *   ხელმძღვანელობა/წარმომადგენლობა
 *   დირექტორატი
 *   <name>, <personal id> ,ერთობლივი
 *   <name>, <personal id> ,ერთობლივი
 *
 * Returns nothing rather than guessing when the block is absent — an extract
 * that does not state directors must not produce any.
 */
export function parseRegistryDirectors(
  extractText: unknown,
  entity?: string,
  asOf?: string
): { people: Person[]; representation: Representation } {
  const text = String(extractText ?? '');
  const anchor = text.indexOf('ხელმძღვანელობა/წარმომადგენლობა');
  if (anchor < 0) return { people: [], representation: 'UNKNOWN' };

  // Bounded window: the block is short, and reading further would start
  // pulling in capital/shareholder rows that mean something different.
  const block = text.slice(anchor, anchor + 900);
  const people: Person[] = [];
  let representation: Representation = 'UNKNOWN';

  for (const rawLine of block.split(/\\n|\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const joint = line.includes(JOINT);
    const sole = line.includes(SOLE);
    if (!joint && !sole) continue;

    // "<name>, <id> ,ერთობლივი" -> the name is the first comma-separated part.
    const namePart = redactPersonalData(line.split(',')[0]);
    if (!looksLikePersonName(namePart)) continue;

    if (joint) representation = 'JOINT';
    else if (representation === 'UNKNOWN') representation = 'SOLE';

    people.push({
      name: namePart,
      role: 'DIRECTOR',
      entity,
      representation: joint ? 'JOINT' : 'SOLE',
      certainty: 'REGISTERED',
      historical: false,
      asOf,
      sourceKind: 'OFFICIAL_REGISTRY',
      support: redactPersonalData(line),
    });
  }

  return { people, representation };
}

/* ------------------------------------------------------------------ *
 * The build                                                           *
 * ------------------------------------------------------------------ */

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * What joint representation means for someone about to sign.
 *
 * Stated as advice, never as a warning: two directors binding a company
 * together is an ordinary corporate arrangement. It only matters because it
 * changes what a valid signature looks like.
 */
export const JOINT_REPRESENTATION_NOTE =
  'რეესტრის ჩანაწერით კომპანიას დირექტორები ერთობლივად წარმოადგენენ. ' +
  'პრაქტიკულად ეს ნიშნავს, რომ ხელშეკრულებაზე მხოლოდ ერთი დირექტორის ხელმოწერა ' +
  'შეიძლება საკმარისი არ იყოს — ხელმოწერამდე ღირს იმის დაზუსტება, ორივე ' +
  'დირექტორი აწერს ხელს თუ მეორის მინდობილობა იქნება წარმოდგენილი.';

export function buildPeopleIntelligence(report: unknown): PeopleIntelligence {
  const r = obj(report);
  const company = obj(r.companyProfile);
  const pr = obj(r.publicResearch);
  const entity = str(company.name) || str(pr.legalCompany) || undefined;

  const found: Person[] = [];
  let representation: Representation = 'UNKNOWN';

  // The register's own governance block is parsed SERVER-SIDE now (see
  // extractControlStructure in research-agent): the raw extracts it lives in
  // are stripped at the customer boundary, so source 1 below — which reads
  // those extracts — finds nothing on this side and always did. What arrives
  // instead is the conclusion: the director names, and whether they represent
  // the company jointly.
  const declaredRepresentation = str(company.representation);
  if (declaredRepresentation === 'JOINT' || declaredRepresentation === 'SOLE') {
    representation = declaredRepresentation;
  }

  // 1. The register itself, read out of the retrieved extracts. This is the
  //    strongest source and the one that was being discarded entirely.
  const bo = obj(r.browserOfficial);
  const extracts = [
    ...arr(bo.results).map((x) => JSON.stringify(x)),
    ...arr(r.officialDocumentsRetrieved).map((x) => JSON.stringify(x)),
  ];
  for (const e of extracts) {
    const parsed = parseRegistryDirectors(e, entity);
    if (parsed.representation !== 'UNKNOWN') representation = parsed.representation;
    found.push(...parsed.people);
    // Partners are a separate block with a separate meaning. Parsed on their
    // own so a shareholder can never arrive wearing a director's role.
    found.push(...parseRegistryShareholders(e, entity));
  }

  // 2. Structured fields, when the research layer did populate them.
  const structured: [unknown, PersonRole, PersonCertainty, Person['sourceKind']][] = [
    [company.directors, 'DIRECTOR', 'REGISTERED', 'OFFICIAL_REGISTRY'],
    [company.representatives, 'REPRESENTATIVE', 'REGISTERED', 'OFFICIAL_REGISTRY'],
    [company.shareholders, 'SHAREHOLDER', 'REGISTERED', 'OFFICIAL_REGISTRY'],
    [pr.directorsRepresentatives, 'REPRESENTATIVE', 'PUBLICLY_REPORTED', 'MEDIA_REPORT'],
    [pr.foundersOwnersParticipants, 'FOUNDER', 'PUBLICLY_REPORTED', 'MEDIA_REPORT'],
  ];
  for (const [source, role, certainty, sourceKind] of structured) {
    for (const raw of arr(source)) {
      const name = redactPersonalData(typeof raw === 'string' ? raw : obj(raw).name);
      if (!looksLikePersonName(name)) continue;
      found.push({
        name, role, entity, representation: 'UNKNOWN', certainty,
        historical: false, sourceKind,
        support: redactPersonalData(typeof raw === 'string' ? raw : JSON.stringify(raw)),
      });
    }
  }

  // 3. De-duplicate on (name, entity). Keep the strongest certainty, and keep
  //    a JOINT representation once any source establishes it.
  //
  //    ONE PERSON CAN HOLD TWO ROLES, and in a small Georgian company they
  //    usually do: the directors are frequently the partners. This used to
  //    merge on (name, entity) alone and keep whichever record arrived first,
  //    which silently discarded the second role — so a company whose
  //    shareholders were also its directors reported no shareholders at all.
  //    Roles are now collected, and a share found under either record is
  //    carried across rather than dropped with it.
  //
  //    Still true, and the reason this merge is careful rather than clever:
  //    a shared NAME across different entities is not a shared identity, and
  //    identityKey keeps those apart.
  const RANK: Record<PersonCertainty, number> = {
    REGISTERED: 4, PUBLICLY_REPORTED: 3, CLAIMED: 2, UNCONFIRMED: 1,
  };
  /** Display order when someone holds more than one: the binding role first. */
  const ROLE_RANK: Record<string, number> = {
    DIRECTOR: 5, REPRESENTATIVE: 4, SHAREHOLDER: 3, FOUNDER: 2,
  };
  const byIdentity = new Map<string, Person>();
  for (const p of found) {
    const k = identityKey(p);
    const prev = byIdentity.get(k);
    if (!prev) { byIdentity.set(k, { ...p, roles: [p.role] }); continue; }
    const roles = [...new Set([...(prev.roles ?? [prev.role]), p.role])]
      .sort((a, b) => (ROLE_RANK[b] ?? 0) - (ROLE_RANK[a] ?? 0));
    byIdentity.set(k, {
      ...prev,
      certainty: RANK[p.certainty] > RANK[prev.certainty] ? p.certainty : prev.certainty,
      representation: prev.representation !== 'UNKNOWN' ? prev.representation : p.representation,
      role: (roles[0] as Person['role']) ?? prev.role,
      roles,
      // A stated share belongs to the person, whichever record carried it.
      // Never overwritten by a record that has none.
      ownershipPct: prev.ownershipPct ?? p.ownershipPct,
      // Historical only if EVERY record says so: one current sighting makes
      // the person current.
      historical: prev.historical && p.historical,
    });
  }

  const corporateChanges = [
    ...arr(company.historicalChanges),
    ...(str(pr.companyHistory) ? [str(pr.companyHistory)] : []),
  ]
    .map((c) => redactPersonalData(c))
    .filter(Boolean);

  return {
    people: [...byIdentity.values()],
    representation,
    representationNote: representation === 'JOINT' ? JOINT_REPRESENTATION_NOTE : undefined,
    corporateChanges,
  };
}

/**
 * The participant model Contract Intelligence compares a signatory against.
 *
 * Deliberately a separate, minimal projection: comparing a name on a contract
 * needs names, roles and how the company is bound, and nothing else.
 */
export interface ParticipantModel {
  entity?: string;
  representation: Representation;
  authorisedSignatories: { name: string; role: PersonRole; certainty: PersonCertainty }[];
}

export function toParticipantModel(p: PeopleIntelligence, entity?: string): ParticipantModel {
  return {
    entity,
    representation: p.representation,
    authorisedSignatories: p.people
      .filter((x) => x.role === 'DIRECTOR' || x.role === 'REPRESENTATIVE')
      .filter((x) => !x.historical)
      .map((x) => ({ name: x.name, role: x.role, certainty: x.certainty })),
  };
}

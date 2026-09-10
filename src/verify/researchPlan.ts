// HOMATCH VERIFY — what we derive about a property from evidence we already
// have, and what that means for how deeply we research it.
//
// Three things live here, and they share a rule: each reads evidence that is
// already in hand and never invents any.
//
//   publicResearchScope()      what is worth researching for this archetype
//   resolveAssetClass()        what kind of property this is
//   extractControlStructure()  who can actually sign for the company
//
// They are in one module because they are all imported by BOTH the Deno edge
// functions and the test suite — which is the point: the tests exercise the
// code that ships rather than a copy of it.
//
// This decides the PUBLIC_RESEARCH plan from the property's classification.
// It is the point where an archetype stops being a label and starts changing
// behaviour: a bare land parcel is not asked about its facade or its lifts, a
// private resale is not sent looking for a developer it does not have, and a
// classification we are genuinely unsure of is researched at FULL breadth
// rather than narrowed on a guess.
//
// WHY IT LIVES HERE RATHER THAN IN THE EDGE FUNCTION
//
// It used to sit inside supabase/functions/research-agent/index.ts, with a
// verbatim COPY in a test file under a "keep this in sync" comment. That
// proves a copy adapts by archetype; it proves nothing about the code that
// ships, and the two can drift apart silently the moment either is edited.
//
// verify-synthesis already imports shared modules from src/ into a Deno edge
// function, so there is no reason for this one to be duplicated. Both the
// edge function and the archetype regression tests now import THIS file.

export const PUBLIC_RESEARCH_TARGETS = [
  'architect',
  'architecture studio',
  'founders owners participants',
  'directors representatives',
  'company history',
  'previous projects',
  'contractors',
  'construction companies',
  'engineers',
  'suppliers',
  'facade',
  'windows',
  'elevators',
  'structural system',
  'construction materials',
  'insulation',
  'MEP (mechanical/electrical/plumbing)',
  'energy efficiency',
  'seismic design',
  'amenities',
  'landscaping',
  'parking',
  'bank financing',
  'partners',
  'construction start',
  'construction chronology',
  'progress history',
  'current physical status',
  'quality',
  'developer reputation',
  'architect reputation',
  'complaints',
  'disputes',
  'court records',
  'media coverage',
  'Facebook',
  'Instagram',
  'LinkedIn',
  'YouTube',
  'TikTok',
  'Telegram',
  'forums',
  'reviews',
];

export function publicResearchScope(assetClass: string | null | undefined): { targets: string[]; scopeNote: string } {
  const buildingTargets = ['facade', 'windows', 'elevators', 'structural system', 'construction materials', 'insulation', 'MEP (mechanical/electrical/plumbing)', 'energy efficiency', 'seismic design', 'amenities', 'landscaping', 'parking'];
  const developerTargets = ['founders owners participants', 'directors representatives', 'company history', 'previous projects', 'developer reputation', 'bank financing', 'partners'];
  const constructionTeamTargets = ['architect', 'architecture studio', 'architect reputation', 'contractors', 'construction companies', 'engineers', 'suppliers', 'construction start', 'construction chronology', 'progress history', 'current physical status', 'quality'];
  const reputationTargets = ['complaints', 'disputes', 'court records', 'media coverage', 'Facebook', 'Instagram', 'LinkedIn', 'YouTube', 'TikTok', 'Telegram', 'forums', 'reviews'];
  switch (assetClass) {
    case 'PRIVATE_RESALE':
    case 'RENTAL':
      // A private individual's resale/rental unit has no developer/project
      // history to research by default — only worth pursuing if evidence
      // already on hand (Identity/Official) actually names one.
      return {
        targets: [...reputationTargets, 'quality'],
        scopeNote:
          'ASSET-CLASS SCOPE (private resale/rental — no forced developer research): this is a private individual\'s unit, not a marketed development project. Do NOT go looking for a developer, architect, contractor, or construction-company just to fill those fields — only research and populate them if the evidence already gathered (Identity/Official above) actually names one for this exact unit/building. It is entirely normal and CORRECT for developer/architect/contractor/companyHistory/previousProjects fields to stay null here; never invent a plausible-sounding value to avoid an empty field. Focus your search instead on: the property\'s own public reputation/reviews, its immediate micro-location, and any publicly reported quality signals or complaints about this exact address/unit.',
      };
    case 'PRIVATE_HOUSE':
      return {
        targets: ['quality', 'current physical status', ...reputationTargets],
        scopeNote:
          'ASSET-CLASS SCOPE (private house — no forced developer/project research): this is a standalone private house, not a unit in a marketed development. Only populate developer/architect/contractor/companyHistory/previousProjects if the evidence already gathered actually names one (e.g. a custom-build architect/builder is sometimes publicly documented) — otherwise leave them null; that is the expected, correct outcome, not a gap. Focus your search on the property\'s own public reputation and its immediate micro-location.',
      };
    case 'LAND':
      // A bare parcel has no building at all — every building-fabric target
      // (facade/windows/elevators/MEP/insulation/energy efficiency/seismic
      // design/amenities-as-building-feature) is inapplicable by definition.
      return {
        targets: ['previous projects', 'developer reputation', 'quality', 'current physical status', ...reputationTargets],
        scopeNote:
          'ASSET-CLASS SCOPE (land parcel — no building-fabric research applies): this is a bare land parcel, not a building or unit. Facade/windows/elevators/structural system/construction materials/insulation/MEP/energy efficiency/seismic design/amenities/landscaping-as-a-building-feature/parking simply do not apply — leave every one of those fields null rather than describing the parcel\'s physical state under them. If a developer or project already publicly plans to build on this exact parcel, that is worth reporting (developer/previousProjects/companyHistory) — but never invent one. Focus your search on how this parcel and its immediate area are publicly discussed (development plans, land use, reputation of any named developer).',
      };
    case 'COMMERCIAL':
      return {
        targets: [...constructionTeamTargets, ...buildingTargets, ...developerTargets, ...reputationTargets],
        scopeNote:
          'ASSET-CLASS SCOPE (commercial property): research the same construction/developer/reputation topics as a residential project, but frame amenities/landscaping/parking findings in commercial terms (tenant/business-facing features, accessibility, signage/visibility) rather than residential ones — only when the evidence actually supports it.',
      };
    case 'APARTMENT_IN_PROJECT':
    case 'UNDER_CONSTRUCTION':
    case 'COMPANY_OWNED':
    case 'MIXED_OR_UNKNOWN':
    default:
      // Safe default (also covers an unset/unrecognized value): research the
      // full breadth, exactly as before this mandate — never narrow scope
      // when the asset class is genuinely unclear.
      return { targets: PUBLIC_RESEARCH_TARGETS, scopeNote: '' };
  }
}

/** The archetypes whose research plan genuinely differs from the default. */
export const NARROWED_ASSET_CLASSES = ['PRIVATE_RESALE', 'RENTAL', 'PRIVATE_HOUSE', 'LAND', 'COMMERCIAL'] as const;

/* ── classification ──────────────────────────────────────────────────── */

/*
 * WHO CAN ACTUALLY SIGN FOR THE COMPANY.
 *
 * The registry extract carries the governance block in plain Georgian:
 *
 *   ხელმძღვანელობა/წარმომადგენლობა
 *   დირექტორატი
 *   კობა კვანტალიანი, <personal id> ,ერთობლივი
 *   ლევან ჩაჩუა,      <personal id> ,ერთობლივი
 *   კაპიტალი
 *
 * "ერთობლივი" means the directors represent the company JOINTLY — neither of
 * them can bind it alone. For someone about to sign a purchase contract with
 * a developer that is not trivia, it is the difference between a valid
 * signature and an invalid one.
 *
 * None of it was reaching the customer. The frontend has a people-intelligence
 * layer that parses exactly this block, but it runs in the browser against the
 * SANITIZED report — and browserOfficial, the 232KB of registry extracts this
 * block lives in, is stripped at the customer boundary because it is full of
 * raw OCR, mojibake and personal numbers. So the parser ran on nothing, and
 * companyProfile.directors was [] on every report in production.
 *
 * Shipping the raw extracts to the browser to fix that would undo the privacy
 * work. The parsing belongs on this side of the boundary instead: read the
 * evidence here, emit names and a representation mode, and let the raw text
 * stay behind.
 *
 * The personal numbers ARE matched — they are what makes the pattern specific
 * enough to find only the governance block — and they are then discarded. A
 * name is a role-holder; the number is not the customer's business.
 */
const DIRECTORATE_RE =
  /([\u10A0-\u10FF][\u10A0-\u10FF ]{2,60}?),\s*\d{11}\s*,\s*(ერთობლივი|ერთპიროვნულ[ია]?[და]?|დამოუკიდებლად)/gu;

export function extractControlStructure(browserOfficial: unknown): {
  directors: string[];
  representation: 'JOINT' | 'SOLE' | null;
} {
  const empty = { directors: [] as string[], representation: null as 'JOINT' | 'SOLE' | null };
  if (!browserOfficial) return empty;

  let text: string;
  try {
    text = typeof browserOfficial === 'string' ? browserOfficial : JSON.stringify(browserOfficial);
  } catch {
    return empty;
  }
  if (!text) return empty;

  const directors: string[] = [];
  let representation: 'JOINT' | 'SOLE' | null = null;

  for (const m of text.matchAll(DIRECTORATE_RE)) {
    const name = String(m[1] || '').trim().replace(/\s+/g, ' ');
    // A single token is a fragment, not a person's full name.
    if (name.split(' ').length < 2) continue;
    if (!directors.includes(name)) directors.push(name);
    // Joint wins outright: if any director is bound to act jointly, a lone
    // signature is not enough, and that is the fact that matters.
    if (m[2].startsWith('ერთობლივი')) representation = 'JOINT';
    else if (representation === null) representation = 'SOLE';
  }

  return { directors: directors.slice(0, 12), representation };
}

export function resolveAssetClass(r: any): string {
  const declared = typeof r?.assetClass === 'string' ? r.assetClass : null;
  if (declared && declared !== 'MIXED_OR_UNKNOWN') return declared;

  const projectName = r?.projectProfile?.name || r?.reconciledIdentity?.project || null;
  // Any one of these means somebody is actually behind the development, as
  // opposed to a project name the research merely mentioned.
  const developer =
    r?.projectProfile?.developer || r?.projectProfile?.developerCompany || r?.projectProfile?.website || null;
  const unitCode = r?.exactUnit?.code || null;

  // A named development, a developer behind it, and an identified unit inside
  // it. A cadastral code on its own never gets here.
  if (projectName && developer && unitCode) return 'APARTMENT_IN_PROJECT';

  // Land evidence, with no development named on it.
  if (r?.landProfile && !projectName) return 'LAND';

  return declared || 'MIXED_OR_UNKNOWN';
}

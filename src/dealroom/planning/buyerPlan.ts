// buyerPlan.ts — the Deal Room's Buyer Action Plan, Questions and Document
// checklist.
//
// All three are GENERATED FROM EVIDENCE, never from a static checklist. The
// rule that governs the whole module is the same one that governs the report:
//
//   NO EVIDENCE = NO FACT.
//
// So every produced item carries `groundedIn` — the specific findings that
// caused it. An item that cannot name its grounding is not emitted at all.
// That is what stops this becoming generic filler like "check the documents".
//
// Deterministic and pure: same evidence in, same plan out. An LLM may later
// rephrase these for tone, but it must not invent the items, because an
// invented action ("confirm the parking title") for a property with no
// parking is worse than saying nothing.

export type PropertyType =
  | 'DEVELOPER_APARTMENT'
  | 'PRIVATE_APARTMENT'
  | 'PRIVATE_HOUSE'
  | 'LAND'
  | 'COMMERCIAL'
  | 'UNKNOWN';

export type EvidenceState = 'CONFIRMED' | 'CORROBORATED' | 'INFERRED' | 'CONFLICTING' | 'UNAVAILABLE';

/** One normalized finding from Verify. */
export interface Finding {
  /** Canonical fact type, e.g. 'ownership.owner', 'encumbrance.mortgage'. */
  type: string;
  subject?: string | null;
  value?: unknown;
  state: EvidenceState;
  /** Where it came from — source key plus document reference. */
  source: string;
  documentRef?: string | null;
  effectiveDate?: string | null;
}

export interface VerifyContext {
  cadastralCode?: string | null;
  findings: Finding[];
}

export interface PlanItem {
  key: string;
  title: string;
  why: string;
  category: string;
  priority: 1 | 2 | 3;
  groundedIn: string[];
}

export interface QuestionItem {
  key: string;
  question: string;
  why: string;
  audience: 'DEVELOPER' | 'SELLER' | 'AGENT' | 'LAWYER' | 'BANK';
  category: string;
  groundedIn: string[];
}

export interface DocumentItem {
  key: string;
  label: string;
  state: 'RECOMMENDED' | 'VERIFIED_BY_VERIFY';
  why: string;
  groundedIn: string[];
}

const has = (c: VerifyContext, type: string) => c.findings.some((f) => f.type === type && f.state !== 'UNAVAILABLE');
const get = (c: VerifyContext, type: string) => c.findings.find((f) => f.type === type && f.state !== 'UNAVAILABLE');
const refsFor = (c: VerifyContext, ...types: string[]) =>
  c.findings
    .filter((f) => types.includes(f.type) && f.state !== 'UNAVAILABLE')
    .map((f) => `${f.type}@${f.source}${f.documentRef ? `#${f.documentRef}` : ''}`);

/**
 * Infers what KIND of property this is before planning anything (the mandate's
 * "property type first, then appropriate research"). Deliberately returns
 * UNKNOWN rather than guessing: a wrong classification produces confidently
 * wrong advice, which is worse than a generic-but-honest plan.
 */
export function inferPropertyType(c: VerifyContext): { type: PropertyType; state: EvidenceState; groundedIn: string[] } {
  const grounded = refsFor(
    c,
    'property.kind',
    'construction.status',
    'ownership.ownerType',
    'land.category',
    'building.registered'
  );

  const kind = get(c, 'property.kind');
  const explicit = String(kind?.value ?? '').toUpperCase();
  if (explicit === 'LAND' || has(c, 'land.category')) {
    return { type: 'LAND', state: kind ? kind.state : 'INFERRED', groundedIn: grounded };
  }
  if (explicit === 'COMMERCIAL') return { type: 'COMMERCIAL', state: kind!.state, groundedIn: grounded };
  if (explicit === 'HOUSE') return { type: 'PRIVATE_HOUSE', state: kind!.state, groundedIn: grounded };

  const ownerType = String(get(c, 'ownership.ownerType')?.value ?? '').toUpperCase();
  const underConstruction = /UNDER_CONSTRUCTION|CONSTRUCTION/.test(
    String(get(c, 'construction.status')?.value ?? '').toUpperCase()
  );

  if (explicit === 'APARTMENT' || has(c, 'property.unitNumber')) {
    if (ownerType === 'COMPANY' || underConstruction) {
      return { type: 'DEVELOPER_APARTMENT', state: 'INFERRED', groundedIn: grounded };
    }
    if (ownerType === 'INDIVIDUAL') {
      return { type: 'PRIVATE_APARTMENT', state: 'INFERRED', groundedIn: grounded };
    }
  }
  return { type: 'UNKNOWN', state: 'UNAVAILABLE', groundedIn: grounded };
}

/* ------------------------------------------------------------------ *
 * BUYER ACTION PLAN                                                   *
 * ------------------------------------------------------------------ */

export function buildActionPlan(c: VerifyContext, type: PropertyType): PlanItem[] {
  const items: PlanItem[] = [];
  const push = (i: PlanItem) => {
    if (i.groundedIn.length) items.push(i);
  };

  // --- universal, but still evidence-gated -------------------------------
  if (has(c, 'ownership.owner')) {
    push({
      key: 'confirm-owner-matches-seller',
      title: 'დაადასტურეთ, რომ გამყიდველი რეესტრში დაფიქსირებული მესაკუთრეა',
      why: 'ხელშეკრულების ხელმოწერამდე მნიშვნელოვანია, რომ ვინც ყიდის, სწორედ ის იყოს, ვინც რეესტრში მესაკუთრედ ჩანს.',
      category: 'OWNERSHIP',
      priority: 1,
      groundedIn: refsFor(c, 'ownership.owner'),
    });
  }

  const mortgage = get(c, 'encumbrance.mortgage');
  if (mortgage && mortgage.state !== 'UNAVAILABLE') {
    push({
      key: 'mortgage-release-terms',
      title: 'დააზუსტეთ იპოთეკის მოხსნის პირობები',
      why: 'ქონებაზე რეგისტრირებულია იპოთეკა. საჭიროა წერილობით იცოდეთ, როდის და რა პირობით მოიხსნება ის თქვენს სახელზე რეგისტრაციამდე.',
      category: 'LEGAL',
      priority: 1,
      groundedIn: refsFor(c, 'encumbrance.mortgage'),
    });
  }

  if (has(c, 'encumbrance.seizure')) {
    push({
      key: 'seizure-check',
      title: 'გადაამოწმეთ ყადაღა/აკრძალვის სტატუსი გარიგებამდე',
      why: 'რეგისტრირებული შეზღუდვა შეიძლება ხელს უშლიდეს საკუთრების გადაფორმებას.',
      category: 'LEGAL',
      priority: 1,
      groundedIn: refsFor(c, 'encumbrance.seizure'),
    });
  }

  // --- developer apartment ------------------------------------------------
  if (type === 'DEVELOPER_APARTMENT') {
    if (has(c, 'company.idCode') || has(c, 'company.name')) {
      push({
        key: 'latest-purchase-agreement',
        title: 'მოითხოვეთ ნასყიდობის ხელშეკრულების ბოლო რედაქცია',
        why: 'დეველოპერის ტიპური ხელშეკრულება პერიოდულად იცვლება — უნდა ნახოთ ზუსტად ის ვერსია, რომელსაც ხელს მოაწერთ.',
        category: 'CONTRACT',
        priority: 1,
        groundedIn: refsFor(c, 'company.idCode', 'company.name'),
      });
    }
    if (has(c, 'construction.status')) {
      push({
        key: 'handover-date-and-condition',
        title: 'დააფიქსირეთ ჩაბარების ვადა და მდგომარეობა წერილობით',
        why: 'ობიექტი მშენებლობის პროცესშია. ჩაბარების თარიღი და რა მდგომარეობაში ბარდება ბინა უნდა იყოს ხელშეკრულებაში, არა მხოლოდ სიტყვიერად.',
        category: 'HANDOVER',
        priority: 1,
        groundedIn: refsFor(c, 'construction.status'),
      });
      push({
        key: 'payment-schedule-vs-progress',
        title: 'შეადარეთ გადახდის გრაფიკი მშენებლობის რეალურ ეტაპს',
        why: 'გადახდები ლოგიკურად უნდა უკავშირდებოდეს მშენებლობის მიმდინარეობას.',
        category: 'PAYMENT',
        priority: 2,
        groundedIn: refsFor(c, 'construction.status'),
      });
    }
    if (mortgage) {
      push({
        key: 'parent-mortgage-release',
        title: 'დააზუსტეთ მიწის/ძირითადი ნაკვეთის იპოთეკის მოხსნის მექანიზმი',
        why: 'როცა პროექტი დაფინანსებულია, ხშირად ძირითად ნაკვეთზეა იპოთეკა. მნიშვნელოვანია გესმოდეთ, როგორ თავისუფლდება კონკრეტულად თქვენი ბინა.',
        category: 'LEGAL',
        priority: 1,
        groundedIn: refsFor(c, 'encumbrance.mortgage', 'company.name'),
      });
    }
  }

  // --- private apartment / house -----------------------------------------
  if (type === 'PRIVATE_APARTMENT' || type === 'PRIVATE_HOUSE') {
    if (has(c, 'ownership.owner')) {
      push({
        key: 'seller-authority',
        title: 'გადაამოწმეთ გამყიდველის უფლებამოსილება',
        why: 'თუ ყიდის წარმომადგენელი ან თანამესაკუთრეა, საჭიროა შესაბამისი უფლებამოსილების დამადასტურებელი დოკუმენტი.',
        category: 'OWNERSHIP',
        priority: 1,
        groundedIn: refsFor(c, 'ownership.owner', 'ownership.coOwnership'),
      });
    }
    if (has(c, 'building.registered') || has(c, 'construction.status')) {
      push({
        key: 'condition-vs-registration',
        title: 'შეადარეთ ფაქტობრივი მდგომარეობა რეგისტრირებულ მონაცემებს',
        why: 'გადაგეგმარება ან დაუფიქსირებელი ცვლილება მოგვიანებით პრობლემა შეიძლება გახდეს.',
        category: 'CONSTRUCTION',
        priority: 2,
        groundedIn: refsFor(c, 'building.registered', 'construction.status'),
      });
    }
  }

  // --- land ---------------------------------------------------------------
  if (type === 'LAND') {
    if (has(c, 'land.category')) {
      push({
        key: 'land-category-implications',
        title: 'დააზუსტეთ მიწის დანიშნულება და მისი შეზღუდვები',
        why: 'სასოფლო/არასასოფლო სტატუსი პირდაპირ განსაზღვრავს, რა შეიძლება აშენდეს ნაკვეთზე.',
        category: 'LAND',
        priority: 1,
        groundedIn: refsFor(c, 'land.category'),
      });
    }
    if (has(c, 'land.k2') || has(c, 'land.k1') || has(c, 'land.k3')) {
      push({
        key: 'development-coefficients',
        title: 'გაარკვიეთ განაშენიანების კოეფიციენტების პრაქტიკული მნიშვნელობა',
        why: 'კ2 განსაზღვრავს, რამდენი ფართის აშენება შეიძლება — ეს პირდაპირ დაკავშირებულია ნაკვეთის ღირებულებასთან.',
        category: 'LAND',
        priority: 1,
        groundedIn: refsFor(c, 'land.k1', 'land.k2', 'land.k3'),
      });
    }
  }

  return items.sort((a, b) => a.priority - b.priority);
}

/* ------------------------------------------------------------------ *
 * QUESTIONS TO ASK                                                    *
 * ------------------------------------------------------------------ */

export function buildQuestions(c: VerifyContext, type: PropertyType): QuestionItem[] {
  const out: QuestionItem[] = [];
  const push = (q: QuestionItem) => {
    if (q.groundedIn.length) out.push(q);
  };

  if (type === 'DEVELOPER_APARTMENT') {
    if (has(c, 'construction.status')) {
      push({
        key: 'q-handover-date',
        question: 'ზუსტად რომელი თარიღით ბარდება ბინა და რა ხდება ვადის გადაცილების შემთხვევაში?',
        why: 'ვადის გადაცილებაზე პასუხისმგებლობა ხელშეკრულებაში ხშირად ბუნდოვნად წერია.',
        audience: 'DEVELOPER',
        category: 'HANDOVER',
        groundedIn: refsFor(c, 'construction.status'),
      });
      push({
        key: 'q-handover-condition',
        question: 'რა მდგომარეობაში ბარდება ბინა — რა შედის და რა არა?',
        why: 'შავი/თეთრი/მწვანე კარკასი მნიშვნელოვნად ცვლის რემონტის ბიუჯეტს.',
        audience: 'DEVELOPER',
        category: 'HANDOVER',
        groundedIn: refsFor(c, 'construction.status'),
      });
    }
    if (has(c, 'company.name') || has(c, 'company.idCode')) {
      push({
        key: 'q-warranty',
        question: 'რა გარანტია ვრცელდება კონსტრუქციაზე და საინჟინრო სისტემებზე და რამდენი ხნით?',
        why: 'გარანტიის ვადა და მოცულობა შემდგომი ხარჯების მთავარი განმსაზღვრელია.',
        audience: 'DEVELOPER',
        category: 'WARRANTY',
        groundedIn: refsFor(c, 'company.name', 'company.idCode'),
      });
      push({
        key: 'q-service-fee',
        question: 'რამდენია მოსალოდნელი მომსახურების საფასური და რა შედის მასში?',
        why: 'ყოველთვიური ხარჯი პირდაპირ მოქმედებს ბინის რეალურ ღირებულებაზე.',
        audience: 'DEVELOPER',
        category: 'FEES',
        groundedIn: refsFor(c, 'company.name', 'company.idCode'),
      });
    }
    if (get(c, 'encumbrance.mortgage')) {
      push({
        key: 'q-mortgage-release',
        question: 'როგორ და როდის მოიხსნება იპოთეკა კონკრეტულად ამ ბინიდან?',
        why: 'თქვენს სახელზე რეგისტრაცია დამოკიდებულია ამ მექანიზმზე.',
        audience: 'DEVELOPER',
        category: 'LEGAL',
        groundedIn: refsFor(c, 'encumbrance.mortgage'),
      });
    }
  }

  if (type === 'PRIVATE_APARTMENT' || type === 'PRIVATE_HOUSE') {
    if (has(c, 'ownership.owner')) {
      push({
        key: 'q-who-sells',
        question: 'ვინ ხელს აწერს ხელშეკრულებას და რა უფლებამოსილებით?',
        why: 'თანამესაკუთრეობის ან წარმომადგენლობის შემთხვევაში საჭიროა დამატებითი დოკუმენტი.',
        audience: 'SELLER',
        category: 'OWNERSHIP',
        groundedIn: refsFor(c, 'ownership.owner'),
      });
    }
  }

  if (type === 'LAND' && (has(c, 'land.k2') || has(c, 'land.category'))) {
    push({
      key: 'q-buildable',
      question: 'რა ფართობის აშენება არის რეალურად დაშვებული ამ ნაკვეთზე?',
      why: 'კოეფიციენტები და ზონირება ერთად განსაზღვრავს რეალურ პოტენციალს.',
      audience: 'AGENT',
      category: 'LAND',
      groundedIn: refsFor(c, 'land.k2', 'land.category'),
    });
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * DOCUMENT CHECKLIST                                                  *
 * ------------------------------------------------------------------ */

export function buildDocumentChecklist(c: VerifyContext, type: PropertyType): DocumentItem[] {
  const out: DocumentItem[] = [];

  // Anything Verify already evidenced is marked as such, so the buyer is
  // never sent chasing a document Homatch already holds.
  if (has(c, 'registry.extract')) {
    out.push({
      key: 'registry-extract',
      label: 'ამონაწერი საჯარო რეესტრიდან',
      state: 'VERIFIED_BY_VERIFY',
      why: 'ეს დოკუმენტი უკვე მოვიძიეთ და გამოვიყენეთ კვლევაში.',
      groundedIn: refsFor(c, 'registry.extract'),
    });
  }

  if (type === 'DEVELOPER_APARTMENT') {
    if (has(c, 'company.name') || has(c, 'company.idCode')) {
      out.push({
        key: 'purchase-agreement',
        label: 'ნასყიდობის ხელშეკრულების პროექტი',
        state: 'RECOMMENDED',
        why: 'ხელმოწერამდე უნდა ნახოთ ზუსტი ვერსია.',
        groundedIn: refsFor(c, 'company.name', 'company.idCode'),
      });
    }
    if (has(c, 'permit.reference') || has(c, 'construction.status')) {
      out.push({
        key: 'construction-permit',
        label: 'მშენებლობის ნებართვა',
        state: has(c, 'permit.reference') ? 'VERIFIED_BY_VERIFY' : 'RECOMMENDED',
        why: 'ადასტურებს, რომ მშენებლობა კანონიერ საფუძველზე მიმდინარეობს.',
        groundedIn: refsFor(c, 'permit.reference', 'construction.status'),
      });
    }
  }

  if (type === 'LAND' && has(c, 'land.category')) {
    out.push({
      key: 'zoning-info',
      label: 'ზონირების/განაშენიანების ინფორმაცია',
      state: 'RECOMMENDED',
      why: 'განსაზღვრავს ნაკვეთის რეალურ სამშენებლო პოტენციალს.',
      groundedIn: refsFor(c, 'land.category', 'land.k2'),
    });
  }

  return out;
}

/** One call for the whole Deal Room planning surface. */
export function buildBuyerPlan(c: VerifyContext) {
  const inferred = inferPropertyType(c);
  return {
    propertyType: inferred.type,
    propertyTypeState: inferred.state,
    actions: buildActionPlan(c, inferred.type),
    questions: buildQuestions(c, inferred.type),
    documents: buildDocumentChecklist(c, inferred.type),
  };
}

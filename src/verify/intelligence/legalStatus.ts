/*
 * LEGAL STATUS — what the records actually establish, claim by claim.
 *
 * Distinct legal states are never inferred from one another, from a document
 * title, a decision number, a date or another building's papers:
 *
 *   PERMIT_ISSUED            a construction permit was issued
 *   CONSTRUCTION_STARTED     works began (a notice / inspection says so)
 *   CONSTRUCTION_COMPLETED   works completed (an act or inspection says so)
 *   COMMISSIONING_APPLIED    an application for acceptance into operation was filed
 *   COMMISSIONING_APPROVED   the building was accepted into operation
 *
 * Each claim carries a status:
 *   CONFIRMED            an authoritative record for THIS building establishes it
 *   PARTIALLY_CONFIRMED  a record establishes part of it (e.g. another block)
 *   CONFLICTING          records disagree
 *   NOT_VERIFIED         nothing read establishes it — which is NOT the same as
 *                        "it did not happen"
 *   NOT_APPLICABLE       the state cannot apply (e.g. no permit stage yet)
 *
 * The narrative layer may only phrase what these claims allow; it never
 * upgrades a NOT_VERIFIED claim (owner live run, 2026-10-10: a project that had
 * not even applied for commissioning was reported "accepted into operation"
 * nine times — from a cited law and a banner rule).
 */

export type LegalClaimKey =
  | 'PERMIT_ISSUED'
  | 'CONSTRUCTION_STARTED'
  | 'CONSTRUCTION_COMPLETED'
  | 'COMMISSIONING_APPLIED'
  | 'COMMISSIONING_APPROVED';

export type LegalClaimStatus = 'CONFIRMED' | 'PARTIALLY_CONFIRMED' | 'CONFLICTING' | 'NOT_VERIFIED' | 'NOT_APPLICABLE';

export interface LegalClaim {
  key: LegalClaimKey;
  status: LegalClaimStatus;
  /** The decision(s) that establish it: case reference, number, date. */
  basis: Array<{ caseRef: string | null; decisionNumber: string | null; date: string | null; block: string | null }>;
}

/**
 * Acceptance into operation as an OPERATIVE act. Kept identical to the
 * worker's COMMISSIONED rule (official-worker/src/workflows/tas/api/decisions.ts);
 * a test holds the two together.
 */
export const COMMISSIONING_OPERATIVE = /(მიღებულ\s+(?:იქნეს|იქნა)\s+ექსპლუატაციაში|ექსპლუატაციაში\s+მიღებულ\s+(?:იქნეს|იქნა)|ექსპლუატაციაში\s+(?:შეყვანილ|შესულ)\s+(?:იქნეს|იქნა)|ექსპლუატაციაში\s+მიღების\s+(?:შესახებ\s+)?აქტ(?:ი|ის)?\s+(?:დამტკიცდ|გაიცეს|გაცემულ)|(?:is|be|was)\s+(?:hereby\s+)?(?:accepted|put)\s+into\s+operation|принять\s+в\s+эксплуатацию|принят\S*\s+в\s+эксплуатацию)/iu;

/** A TAS case whose OWN service is acceptance into operation (the application, not its outcome). */
const COMMISSIONING_SERVICE = /(?:ნომენკლატურა|მომსახურება|სახეობა)\s*:?\s*[^\n]{0,80}ექსპლუატაციაში\s+მიღება/iu;
/** A short case type that IS the service ("შენობა-ნაგებობის ექსპლუატაციაში მიღება"), never a long text quoting it. */
const SERVICE_NAME = /^[^\n]{0,60}ექსპლუატაციაში\s+მიღებ[^\n]{0,40}$/iu;

/** The document's own result line, when it states one. */
const RESULT_LINE = /შედეგი\s*:\s*(შუალედური|დადებითი|უარყოფითი)/iu;

const POSITIVE = new Set(['PERMIT_ISSUED', 'APPROVED', 'AMENDMENT_APPROVED', 'DEADLINE_EXTENDED', 'COMMISSIONED']);

/**
 * Re-check a decision read by an older worker. Results stored before the
 * operative-only rule must not keep their "accepted into operation": the
 * stored evidence window must itself carry the operative wording, and a
 * document whose own result line says "intermediate" decided nothing final.
 */
export function revalidateDecision<T extends { outcome?: unknown; evidence?: unknown } | null | undefined>(d: T): T {
  if (!d || typeof d !== 'object') return d;
  const outcome = String((d as any).outcome ?? '');
  const evidence = String((d as any).evidence ?? '');
  if (outcome === 'COMMISSIONED' && !COMMISSIONING_OPERATIVE.test(evidence)) {
    return { ...(d as any), outcome: 'UNDETERMINED', revalidated: 'COMMISSIONING_NOT_OPERATIVE' };
  }
  if (POSITIVE.has(outcome) && /შუალედური/iu.test(RESULT_LINE.exec(evidence)?.[1] ?? '')) {
    return { ...(d as any), outcome: 'INTERMEDIATE', revalidated: 'RESULT_LINE_INTERMEDIATE' };
  }
  return d;
}

export interface LegalStatusEvent {
  date: string | null;
  caseRef: string | null;
  block: string | null;
  decision: { number: string | null; outcome: string; evidence: string | null } | null;
  /** The case's own service / nomenclature text, when read. */
  serviceText?: string | null;
}

/**
 * The claim set for one building, from its timeline. Events belonging to a
 * different block than the target (when both are known) count only as
 * PARTIALLY_CONFIRMED — never as this building's own status.
 */
export function legalClaims(events: LegalStatusEvent[], target: { block: string | null } = { block: null }): LegalClaim[] {
  const sameBuilding = (e: LegalStatusEvent) => !target.block || !e.block || e.block === target.block;
  const basisOf = (e: LegalStatusEvent) => ({ caseRef: e.caseRef, decisionNumber: e.decision?.number ?? null, date: e.date, block: e.block });
  const claim = (key: LegalClaimKey, hits: LegalStatusEvent[], negatives: LegalStatusEvent[] = []): LegalClaim => {
    const own = hits.filter(sameBuilding);
    const other = hits.filter((e) => !sameBuilding(e));
    let status: LegalClaimStatus = 'NOT_VERIFIED';
    if (own.length && negatives.filter(sameBuilding).some((n) => (n.date ?? '') > (own[own.length - 1].date ?? ''))) status = 'CONFLICTING';
    else if (own.length) status = 'CONFIRMED';
    else if (other.length) status = 'PARTIALLY_CONFIRMED';
    return { key, status, basis: (own.length ? own : other).map(basisOf) };
  };
  const by = (pred: (e: LegalStatusEvent) => boolean) => events.filter(pred).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  const outcome = (e: LegalStatusEvent) => e.decision?.outcome ?? '';
  const permits = by((e) => outcome(e) === 'PERMIT_ISSUED' || outcome(e) === 'AMENDMENT_APPROVED');
  const revoked = by((e) => outcome(e) === 'CANCELLED' || outcome(e) === 'SUSPENDED');
  const commissioned = by((e) => outcome(e) === 'COMMISSIONED' && COMMISSIONING_OPERATIVE.test(String(e.decision?.evidence ?? '')));
  const applied = by((e) => { const t = String(e.serviceText ?? ''); return COMMISSIONING_SERVICE.test(t) || (t.length <= 110 && SERVICE_NAME.test(t)); });
  return [
    claim('PERMIT_ISSUED', permits, revoked),
    // Works starting / finishing are facts no decision outcome establishes on its own.
    { key: 'CONSTRUCTION_STARTED', status: 'NOT_VERIFIED', basis: [] },
    { key: 'CONSTRUCTION_COMPLETED', status: commissioned.some(sameBuilding) ? 'CONFIRMED' : 'NOT_VERIFIED', basis: commissioned.filter(sameBuilding).map(basisOf) },
    claim('COMMISSIONING_APPLIED', [...applied, ...commissioned]),
    claim('COMMISSIONING_APPROVED', commissioned),
  ];
}

/* ───────────────────────── The legal findings a buyer reads ───────────────────────── */

/*
 * LEGAL FINDINGS, SCOPE BY SCOPE, EACH WITH ITS DATE (owner, 2026-10-11).
 *
 * The exact apartment, its parcel, its building, who owns it now and who
 * owned it before, a mortgage that was cancelled, a mortgage in force, the
 * developer's obligations, the project's financing and the applications on
 * file are different things. Each finding says which one it is about and the
 * date of the record it rests on. An extract shows the register as of its
 * own date, never "today": the one note that says so is part of the result.
 *
 * Never contradictory: when the register extract names this exact unit
 * (unitIdentity.exactUnit.verified, or unitLegalPosition scope EXACT_UNIT
 * from a NAPR extract), no finding calls the unit unverified, and the
 * parcel's land area and function are never the apartment's.
 *
 * Private owners are never named here: a person is "კერძო პირი". Pure.
 */

export type LegalFindingKey =
  | 'EXACT_UNIT' | 'PARCEL' | 'BUILDING' | 'OWNERSHIP_CURRENT' | 'OWNERSHIP_HISTORY'
  | 'MORTGAGE_CANCELLED' | 'MORTGAGE_CURRENT' | 'RESTRICTIONS' | 'COMPANY_OBLIGATIONS' | 'PROJECT_FINANCING' | 'PENDING_APPLICATIONS';
export type LegalFindingScope = 'EXACT_UNIT' | 'PARENT_PARCEL' | 'BUILDING' | 'COMPANY' | 'PROJECT';

export interface LegalFinding {
  key: LegalFindingKey;
  scope: LegalFindingScope;
  tone: 'positive' | 'neutral' | 'attention';
  text: string;
  /** The date of the record this rests on (extract preparation, registry check, filing). */
  observedOn: string | null;
  /** A code a buyer may want (cadastral code), shown apart from the sentence. */
  ref: string | null;
}

const o = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});
const t = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const d10 = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const KA_MONTH_GEN = ['იანვრის', 'თებერვლის', 'მარტის', 'აპრილის', 'მაისის', 'ივნისის', 'ივლისის', 'აგვისტოს', 'სექტემბრის', 'ოქტომბრის', 'ნოემბრის', 'დეკემბრის'];
const KA_MONTH_DAT = ['იანვარს', 'თებერვალს', 'მარტს', 'აპრილს', 'მაისს', 'ივნისს', 'ივლისს', 'აგვისტოს', 'სექტემბერს', 'ოქტომბერს', 'ნოემბერს', 'დეკემბერს'];
const kaGen = (iso: string | null) => (iso ? `${iso.slice(0, 4)} წლის ${Number(iso.slice(8, 10))} ${KA_MONTH_GEN[Number(iso.slice(5, 7)) - 1]}` : null);
const kaDat = (iso: string | null) => (iso ? `${iso.slice(0, 4)} წლის ${Number(iso.slice(8, 10))} ${KA_MONTH_DAT[Number(iso.slice(5, 7)) - 1]}` : null);
const sqm = (n: number) => String(Math.round(n * 100) / 100).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const whoOf = (owners: unknown): string => {
  const list = Array.isArray(owners) ? owners.map(o) : [];
  const names = list.map((w) => (t(w.kind).toUpperCase() === 'COMPANY' ? t(w.name) : 'კერძო პირი')).filter(Boolean);
  const uniq = [...new Set(names)];
  if (!uniq.length) return '';
  if (uniq.length === 1 && list.length > 1 && uniq[0] === 'კერძო პირი') return 'კერძო პირები';
  return uniq.join(', ');
};
const BASIS_KA: Record<string, string> = { PURCHASE: 'ნასყიდობის საფუძველზე', GIFT: 'ჩუქების საფუძველზე', INHERITANCE: 'მემკვიდრეობის საფუძველზე', EXCHANGE: 'გაცვლის საფუძველზე' };

export interface LegalFindingsInput {
  unitLegalPosition?: unknown;
  unitIdentity?: unknown;
  companyFinance?: unknown;
  /** Open applications (projectEvolution.openApplications) and the ones decided by a published act. */
  applications?: { open: Array<{ caseRef: string | null; date: string | null }>; resolvedOn: string[] } | null;
}

export interface LegalFindingsView {
  findings: LegalFinding[];
  /** The register extract's own date: every unit finding is "as of" this day. */
  extractDate: string | null;
  /** The extract shows its own date, not today. */
  freshnessNote: string | null;
}

export function legalFindings(input: LegalFindingsInput): LegalFindingsView | null {
  const ulp = o(input.unitLegalPosition);
  const ui = o(input.unitIdentity);
  const exact = o(ui.exactUnit);
  const parcel = o(ui.parentParcel);
  const extractDate = d10(o(ulp.evidence).extractIssuedAt) ?? d10(exact.evidenceDate) ?? d10(o(ulp.mortgages).asOf);
  const unitVerified = exact.verified === true || (t(ulp.scope) === 'EXACT_UNIT' && t(o(ulp.evidence).source) === 'NAPR_EXTRACT');
  const out: LegalFinding[] = [];

  /* the exact apartment */
  if (unitVerified) {
    const where = [
      t(exact.apartment) ? `ბინა N${t(exact.apartment)}` : null,
      t(exact.floor) ? `${t(exact.floor)} სართული` : null,
      t(exact.block) ? `ბლოკი „${t(exact.block)}“` : null,
      typeof exact.areaSqm === 'number' ? `${sqm(exact.areaSqm)} მ²` : null,
    ].filter(Boolean).join(', ');
    out.push({
      key: 'EXACT_UNIT', scope: 'EXACT_UNIT', tone: 'positive',
      text: `საჯარო რეესტრის ამონაწერი ზუსტად ამ ბინას ეხება${where ? ` (${where})` : ''}. ბინა რეესტრში ცალკე ერთეულად არის რეგისტრირებული.`,
      observedOn: d10(exact.evidenceDate) ?? extractDate, ref: t(exact.code) || t(ulp.cadastralCode) || null,
    });
  } else if (Object.keys(ulp).length || Object.keys(exact).length) {
    out.push({
      key: 'EXACT_UNIT', scope: 'EXACT_UNIT', tone: 'attention',
      text: 'ზუსტად ამ ბინის ამონაწერი ჩანაწერებში არ არის. ქვემოთ მოცემული ჩანაწერები ნაკვეთს ან შენობას ეხება და ბინის სამართლებრივ მდგომარეობად ვერ ჩაითვლება.',
      observedOn: null, ref: t(exact.code) || null,
    });
  }

  /* the parcel */
  if (t(parcel.code) || typeof parcel.landAreaSqm === 'number') {
    out.push({
      key: 'PARCEL', scope: 'PARENT_PARCEL', tone: 'neutral',
      text: [
        typeof parcel.landAreaSqm === 'number' ? `შენობა დგას ${sqm(parcel.landAreaSqm)} მ² ფართობის მიწის ნაკვეთზე` : 'შენობა დგას ცალკე რეგისტრირებულ მიწის ნაკვეთზე',
        t(parcel.landFunction) ? `, რომლის დანიშნულებაა „${t(parcel.landFunction)}“.` : '.',
        ' მიწის დანიშნულება და ფართობი ნაკვეთს ეხება და არა ბინას.',
      ].join(''),
      observedOn: t(parcel.source) === 'NAPR_EXTRACT' ? extractDate : null, ref: t(parcel.code) || null,
    });
  }

  /* the building */
  if (exact.underConstruction === true || t(o(ui.building).block)) {
    const block = t(o(ui.building).block) || t(exact.block);
    out.push({
      key: 'BUILDING', scope: 'BUILDING', tone: 'neutral',
      text: [
        block ? `ბინა ეკუთვნის ბლოკს „${block}“.` : null,
        exact.underConstruction === true ? 'ამონაწერში შენობა მშენებარედაა აღრიცხული. ეს ექსპლუატაციაში მიღებამდე ჩვეულებრივი მდგომარეობაა და პრობლემას არ ნიშნავს.' : null,
      ].filter(Boolean).join(' '),
      observedOn: extractDate, ref: null,
    });
  }

  /* ownership now, and before */
  const own = o(ulp.ownership);
  const currentWho = whoOf(own.owners);
  if (currentWho) {
    out.push({
      key: 'OWNERSHIP_CURRENT', scope: 'EXACT_UNIT', tone: 'neutral',
      text: `ამონაწერის თარიღისთვის ბინის მესაკუთრედ რეგისტრირებულია ${currentWho}${d10(own.registeredOn) ? `, ${kaDat(d10(own.registeredOn))}` : ''}${BASIS_KA[t(own.basis).toUpperCase()] ? ` ${BASIS_KA[t(own.basis).toUpperCase()]}` : ''}.`,
      observedOn: d10(own.asOf) ?? extractDate, ref: null,
    });
  }
  const earlier = (Array.isArray(ulp.ownershipHistory) ? ulp.ownershipHistory.map(o) : [])
    .filter((h) => d10(h.registeredOn) !== d10(own.registeredOn) || whoOf(h.owners) !== currentWho);
  if (earlier.length) {
    out.push({
      key: 'OWNERSHIP_HISTORY', scope: 'EXACT_UNIT', tone: 'neutral',
      text: `ადრინდელი ამონაწერებით: ${earlier.map((h) => `${kaDat(d10(h.registeredOn)) ?? 'ადრე'} მესაკუთრედ რეგისტრირდა ${whoOf(h.owners) || 'სხვა პირი'}`).join('; ')}.`,
      observedOn: earlier.map((h) => d10(h.seenInExtractOf)).filter(Boolean).sort().pop() ?? null, ref: null,
    });
  }

  /* mortgages: cancelled, and in force */
  const mort = o(ulp.mortgages);
  const hist = Array.isArray(mort.history) ? mort.history.map(o) : [];
  for (const h of hist.filter((x) => t(x.lifecycle).toUpperCase() === 'CANCELLATION_REGISTERED')) {
    const steps = Array.isArray(h.steps) ? h.steps.map(o) : [];
    const reg = d10(h.registeredOn) ?? d10(steps.find((x) => t(x.step) === 'MORTGAGE_REGISTERED')?.date);
    const cancelled = d10(steps.find((x) => t(x.step) === 'CANCELLATION_REGISTERED')?.date);
    out.push({
      key: 'MORTGAGE_CANCELLED', scope: 'EXACT_UNIT', tone: 'positive',
      text: `ბინაზე ${reg ? `${kaDat(reg)} ` : ''}რეგისტრირებული იპოთეკა${t(h.creditor) ? ` (კრედიტორი: ${t(h.creditor)})` : ''} ${cancelled ? `${kaDat(cancelled)} ` : ''}გაუქმდა.`.replace(/\s+/g, ' '),
      observedOn: cancelled ?? extractDate, ref: null,
    });
  }
  const active = hist.filter((x) => ['ACTIVE', 'MORTGAGE_REGISTERED', 'TERMINATION_APPLIED', 'TERMINATION_SUSPENDED'].includes(t(x.lifecycle).toUpperCase()));
  if (active.length) {
    out.push({
      key: 'MORTGAGE_CURRENT', scope: 'EXACT_UNIT', tone: 'attention',
      text: `ამონაწერის თარიღისთვის ბინაზე რეგისტრირებულია იპოთეკა${t(active[0].creditor) ? ` (${t(active[0].creditor)})` : ''}. ხელშეკრულებაში უნდა ჩაიწეროს, როდის და როგორ გაუქმდება ის.`,
      observedOn: d10(mort.asOf) ?? extractDate, ref: null,
    });
  } else if (t(mort.state).toUpperCase() === 'NONE_REGISTERED') {
    out.push({
      key: 'MORTGAGE_CURRENT', scope: 'EXACT_UNIT', tone: 'positive',
      text: 'ამონაწერის თარიღისთვის ბინაზე მოქმედი იპოთეკა რეგისტრირებული არ არის.',
      observedOn: d10(mort.asOf) ?? extractDate, ref: null,
    });
  }

  /* other restrictions */
  const r = o(ulp.restrictions);
  if (['seizure', 'taxLien', 'debtorRegistry'].every((k) => t(r[k]).toUpperCase() === 'NONE')) {
    out.push({
      key: 'RESTRICTIONS', scope: 'EXACT_UNIT', tone: 'positive',
      text: 'ყადაღა, საგადასახადო გირავნობა და მოვალეთა რეესტრის ჩანაწერი ბინაზე არ ფიქსირდება.',
      observedOn: d10(r.asOf) ?? extractDate, ref: null,
    });
  } else if (['seizure', 'taxLien', 'debtorRegistry'].some((k) => /ACTIVE|REGISTERED|PRESENT/i.test(t(r[k])))) {
    out.push({
      key: 'RESTRICTIONS', scope: 'EXACT_UNIT', tone: 'attention',
      text: 'ამონაწერში ბინაზე შეზღუდვა ფიქსირდება (ყადაღა, საგადასახადო გირავნობა ან მოვალეთა რეესტრის ჩანაწერი). გარიგებამდე მისი გაუქმება აუცილებელია.',
      observedOn: d10(r.asOf) ?? extractDate, ref: null,
    });
  }

  /* the developer's obligations, and the project's financing */
  const cf = o(input.companyFinance);
  const company = t(cf.companyName);
  if (company) {
    const pledges = Array.isArray(cf.pledges) ? cf.pledges.map(o) : [];
    const debtor = t(o(cf.debtorRegistry).state).toUpperCase();
    out.push({
      key: 'COMPANY_OBLIGATIONS', scope: 'COMPANY', tone: pledges.length ? 'neutral' : 'positive',
      text: [
        pledges.length
          ? `დეველოპერის (${company}) ქონებაზე რეგისტრირებულია ${pledges.length === 1 ? 'გირავნობა' : `${pledges.length} გირავნობა`}${t(pledges[0].creditor) ? ` (${t(pledges[0].creditor).replace(/\s+\d{9}$/, '')}${d10(pledges[0].registeredOn) ? `, ${kaGen(d10(pledges[0].registeredOn))} რეგისტრაციით` : ''})` : ''}. ეს დეველოპერის ვალდებულებაა და არა ბინაზე რეგისტრირებული იპოთეკა.`
          : `დეველოპერის (${company}) ქონებაზე გირავნობა კომპანიის ამონაწერში არ ფიქსირდება.`,
        debtor === 'NO_ENTRY' ? 'კომპანია მოვალეთა რეესტრში არ არის.' : debtor === 'LISTED' || debtor === 'ENTRY' ? 'კომპანია მოვალეთა რეესტრშია რეგისტრირებული.' : null,
        cf.liquidationRegistered === true ? 'კომპანიის ლიკვიდაცია რეგისტრირებულია.' : null,
      ].filter(Boolean).join(' '),
      observedOn: d10(cf.registryExtractDate) ?? d10(o(cf.debtorRegistry).checkedOn), ref: null,
    });
    const partner = t(cf.financingPartner).split(/\s[—–-]\s|[.,;]/)[0].trim();
    if (partner) {
      out.push({
        key: 'PROJECT_FINANCING', scope: 'PROJECT', tone: 'neutral',
        text: `დეველოპერის საჯარო ინფორმაციაში პროექტის დაფინანსების პარტნიორად ${partner} არის დასახელებული. ეს დეველოპერის დაფინანსებაა და ბინაზე ვალდებულებად არ აისახება.`,
        observedOn: null, ref: null,
      });
    }
  }

  /* applications on file */
  const apps = input.applications;
  if (apps && (apps.open.length || apps.resolvedOn.length)) {
    const latest = [...apps.open.map((a) => a.date ?? '')].filter(Boolean).sort().pop() ?? null;
    out.push({
      key: 'PENDING_APPLICATIONS', scope: 'PROJECT', tone: apps.open.length ? 'attention' : 'neutral',
      text: apps.open.length
        ? `ქალაქში ${apps.open.length === 1 ? 'ერთი განაცხადი' : `${apps.open.length} განაცხადი`} ჯერ გადაწყვეტილების გარეშეა. ის პროექტს ეხება და ბინის ამონაწერზე არ აისახება, სანამ გადაწყვეტილება არ მიიღება.`
        : 'ქალაქის სიაში განხილვაში მყოფად ნაჩვენები განაცხადები უკვე გადაწყვეტილია: გამოქვეყნებული ბრძანებები ფართობების მაჩვენებლებს ასწორებს. ისინი პროექტის ისტორიაშია აღწერილი.',
      observedOn: apps.open.length ? latest : [...apps.resolvedOn].sort().pop() ?? null, ref: null,
    });
  }

  if (!out.length) return null;
  return {
    findings: out,
    extractDate,
    freshnessNote: extractDate ? `ბინის მონაცემები ${kaGen(extractDate)} ამონაწერს ეყრდნობა და იმ დღის მდგომარეობას ასახავს. გარიგების დღეს ახალი ამონაწერი აიღეთ.` : null,
  };
}

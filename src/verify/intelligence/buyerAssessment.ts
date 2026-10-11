/*
 * THE BUYER ASSESSMENT — the block right before the final verdict.
 *
 * After everything the report has shown, one question remains: would this
 * project reasonably deserve a buyer's confidence, and why? This module owns
 * the answer's SHAPE and its guard rails:
 *
 *   synthesis   one line per area (legal, history, construction documentation,
 *               people, neighbourhood, market), only for areas with evidence;
 *   narrative   a warm, balanced paragraph answering the question;
 *   strengths / concerns / checks.
 *
 * The model may write it (report.buyerAssessment, strict schema). Its text is
 * refused when it states a percentage, claims HOMATCH inspected the
 * property, claims commissioning, or is automatic praise; a concern the
 * evidence establishes (an audit finding about the works, an application
 * still under review, thin market evidence) is never allowed to disappear.
 * Without a usable model answer the block is ASSEMBLED from verified facts:
 * buildBuyerAssessment().
 *
 * The closing sentence (the decision belongs to the buyer) is fixed UI copy,
 * never model text. Pure and deterministic.
 */

import { replaceDashes } from './editorial.ts';
import { kaInMonth, kaOfMonth, kaOfDay, kaOnDay } from './kaDates.ts';
import { readProjectSignals } from './projectStory.ts';

export type AssessmentArea = 'LEGAL' | 'HISTORY' | 'CONSTRUCTION' | 'PEOPLE' | 'NEIGHBORHOOD' | 'MARKET';
export const ASSESSMENT_AREAS: AssessmentArea[] = ['LEGAL', 'HISTORY', 'CONSTRUCTION', 'PEOPLE', 'NEIGHBORHOOD', 'MARKET'];

export interface BuyerAssessment {
  synthesis: Array<{ area: AssessmentArea; text: string }>;
  narrative: string;
  strengths: string[];
  concerns: string[];
  checks: string[];
  source: 'MODEL' | 'DETERMINISTIC';
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/* ───────────────────────── Guard rails ───────────────────────── */

/** A percentage, a confidence score, or any "N%" figure. */
const PERCENT = /\d\s*%|პროცენტ|percent|процент/iu;
/** HOMATCH (or "we") inspected / visited / checked the property in person. */
const INSPECTED = /(HOMATCH|ჰომატჩ|ჩვენ)\S*\s+(?:\S+\s+){0,3}(?:დაათვალიერ|ადგილზე\s+(?:შეამოწმ|ნახ)|ინსპექტირ|inspect|visited|осмотрел)|(?:we|HOMATCH)\s+(?:have\s+)?(?:inspected|visited|surveyed)/iu;
/** Commissioning stated as fact. */
const COMMISSIONED = /ექსპლუატაციაში\s+(?:მიღებულია|მიღებული\s+(?:არის|შენობა)|შევიდა)|has\s+been\s+commissioned|accepted\s+into\s+operation|введен\S*\s+в\s+эксплуатацию/iu;
/** Praise that is a verdict, not an assessment. */
const PRAISE = /უნაკლო|იდეალურ|გარანტირებულ|უსაფრთხო\s+ინვესტიცი|საუკეთესო\s+ინვესტიცი|აუცილებლად\s+(?:იყიდეთ|შეიძინეთ)|ურისკო|risk[-\s]?free|guaranteed|perfect\s+(?:choice|investment)|flawless|must\s+buy|confirmed\s+buyer/iu;

export function assessmentProblems(a: Partial<BuyerAssessment> | null | undefined): string[] {
  if (!a) return ['no assessment'];
  const problems: string[] = [];
  const all = [a.narrative ?? '', ...(a.synthesis ?? []).map((s) => s.text), ...(a.strengths ?? []), ...(a.concerns ?? []), ...(a.checks ?? [])].join('\n');
  if (!str(a.narrative)) problems.push('assessment has no narrative');
  if (PERCENT.test(all)) problems.push('assessment states a percentage');
  if (INSPECTED.test(all)) problems.push('assessment claims HOMATCH inspected the property');
  if (COMMISSIONED.test(all)) problems.push('assessment claims commissioning');
  if (PRAISE.test(all)) problems.push('assessment is automatic praise');
  if (/https?:\/\/|www\./i.test(all)) problems.push('assessment contains a URL');
  return problems;
}

export function parseBuyerAssessment(v: unknown): Omit<BuyerAssessment, 'source'> | null {
  const o = obj(v);
  if (!Object.keys(o).length) return null;
  const list = (x: unknown, max: number) => arr(x).map(str).filter(Boolean).slice(0, max);
  const synthesis = arr(o.synthesis)
    .map((s) => obj(s))
    .map((s) => ({ area: str(s.area).toUpperCase() as AssessmentArea, text: str(s.text) }))
    .filter((s) => ASSESSMENT_AREAS.includes(s.area) && s.text)
    .filter((s, i, all) => all.findIndex((x) => x.area === s.area) === i)
    .sort((a, b) => ASSESSMENT_AREAS.indexOf(a.area) - ASSESSMENT_AREAS.indexOf(b.area));
  const out = { synthesis, narrative: str(o.narrative), strengths: list(o.strengths, 5), concerns: list(o.concerns, 5), checks: list(o.checks, 5) };
  return out.narrative ? out : null;
}

/* ───────────────────────── Facts it rests on ───────────────────────── */

export interface AssessmentFacts {
  /** The unit's mortgage was registered and later cancelled. */
  mortgageCancelled: { registeredOn: string | null; cancelledOn: string | null; creditor: string | null } | null;
  mortgageActive: boolean;
  restrictionsNone: boolean;
  extractDate: string | null;
  ownedByPurchaseSince: string | null;
  permitInForce: { date: string | null; until: string | null } | null;
  pending: Array<{ caseRef: string | null; date: string | null }>;
  auditFinding: { date: string | null } | null;
  constructionDocumented: boolean;
  developerSaysComplete: boolean;
  commissioned: boolean;
  namedProfessionals: number;
  neighbourhoodPlaces: number;
  district: string | null;
  marketThin: boolean;
  marketState: string | null;
}

export function assessmentFacts(synthesis: unknown): AssessmentFacts {
  const s = obj(synthesis);
  const ulp = obj(s.unitLegalPosition);
  const mortgages = obj(ulp.mortgages);
  const hist = arr(mortgages.history).map(obj);
  const cancelled = hist.find((h) => str(h.lifecycle).toUpperCase() === 'CANCELLATION_REGISTERED');
  const steps = cancelled ? arr(cancelled.steps).map(obj) : [];
  const restr = obj(ulp.restrictions);
  const ownership = obj(ulp.ownership);
  const history = obj(s.officialHistory);
  const status = obj(history.status);
  const report = obj(s.report);
  const signals = readProjectSignals(report.projectSignals ?? s.projectSignals);
  const pending = arr(history.pendingApplications).map(obj).map((p) => ({ caseRef: str(p.caseRef) || null, date: str(p.date).slice(0, 10) || null }));
  const market = obj(s.market);
  const valuation = obj(market.valuation);
  const location = obj(s.location);
  const team = arr(s.projectTeamV2).map(obj).filter((m) => m.official !== false && arr(m.roles).some((r) => !/APPLICANT|CLIENT|DEVELOPER|OTHER/i.test(str(obj(r).code))));
  const day = (v: unknown) => str(v).slice(0, 10) || null;
  return {
    mortgageCancelled: cancelled ? {
      registeredOn: day(cancelled.registeredOn) ?? day(steps.find((x) => str(x.step) === 'MORTGAGE_REGISTERED')?.date),
      cancelledOn: day(steps.find((x) => str(x.step) === 'CANCELLATION_REGISTERED')?.date),
      creditor: str(cancelled.creditor) || null,
    } : null,
    mortgageActive: hist.some((h) => ['ACTIVE', 'TERMINATION_APPLIED', 'TERMINATION_SUSPENDED', 'MORTGAGE_REGISTERED'].includes(str(h.lifecycle).toUpperCase())),
    restrictionsNone: ['seizure', 'taxLien', 'debtorRegistry'].every((k) => str(restr[k]).toUpperCase() === 'NONE'),
    extractDate: day(obj(ulp.evidence).extractIssuedAt) ?? day(mortgages.asOf),
    ownedByPurchaseSince: str(ownership.basis).toUpperCase() === 'PURCHASE' ? day(ownership.registeredOn) : null,
    permitInForce: str(status.state).toUpperCase() === 'PERMITTED' ? { date: day(status.since), until: day(status.validUntil) } : null,
    pending,
    auditFinding: signals?.auditFinding ? { date: signals.auditFinding.date } : null,
    constructionDocumented: !!(signals?.auditFinding || signals?.photoCases.length),
    developerSaysComplete: !!signals?.developerStatus && /დასრულებულ|complet/iu.test(signals.developerStatus.text),
    commissioned: str(status.state).toUpperCase() === 'COMMISSIONED',
    namedProfessionals: team.length,
    neighbourhoodPlaces: arr(location.nearby).length,
    district: str(location.district) || null,
    marketThin: market.basisIsThin === true || str(valuation.state).toUpperCase() === 'INSUFFICIENT_EVIDENCE',
    marketState: str(valuation.state) || null,
  };
}

/* ───────────────────────── The deterministic assessment ───────────────────────── */

export function buildBuyerAssessment(synthesis: unknown): BuyerAssessment {
  const f = assessmentFacts(synthesis);
  const synthesisLines: BuyerAssessment['synthesis'] = [];
  const strengths: string[] = [];
  const concerns: string[] = [];
  const checks: string[] = [];

  /* legal */
  if (f.extractDate) {
    const parts: string[] = [];
    if (f.mortgageCancelled) parts.push(`ბინაზე ${kaOnDay(f.mortgageCancelled.registeredOn) ?? ''} რეგისტრირებული ბანკის იპოთეკა ${kaOnDay(f.mortgageCancelled.cancelledOn) ?? ''} გაუქმდა`.replace(/\s+/g, ' '));
    if (f.restrictionsNone) parts.push('ყადაღა, საგადასახადო გირავნობა და მოვალეთა რეესტრის ჩანაწერი არ ფიქსირდება');
    if (parts.length) {
      synthesisLines.push({ area: 'LEGAL', text: `${kaOfDay(f.extractDate)} ამონაწერით ${parts.join('; ')}.` });
      strengths.push('ბინის სამართლებრივი მდგომარეობა ამონაწერის თარიღისთვის დატვირთვისგან თავისუფალია.');
    }
    checks.push('ხელმოწერის დღეს აიღეთ ახალი ამონაწერი საჯარო რეესტრიდან.');
  }
  if (f.mortgageActive) concerns.push('ამონაწერში ბინაზე იპოთეკა ჯერ კიდევ რეგისტრირებულია. მისი გაუქმების წესი ხელშეკრულებაში უნდა ჩაიწეროს.');

  /* history */
  if (f.permitInForce) {
    synthesisLines.push({ area: 'HISTORY', text: `პროექტი ქალაქთან რამდენჯერმე შეთანხმდა და შესწორდა. მოქმედი ნებართვა ${kaOnDay(f.permitInForce.date)} გაიცა${f.permitInForce.until ? ` და ${kaOnDay(f.permitInForce.until)} იწურება` : ''}.` });
    strengths.push('მშენებლობას მოქმედი ნებართვა აქვს.');
  }
  if (f.pending.length) {
    const latest = [...f.pending].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))[0];
    concerns.push(f.pending.length === 1
      ? `${kaOnDay(latest.date) ?? ''} შეტანილ განაცხადზე საბოლოო გადაწყვეტილება ჯერ არ ჩანს. მისი შედეგი შეიძლება პროექტს ცვლიდეს.`.trim()
      : `${({ 2: 'ორ', 3: 'სამ', 4: 'ოთხ' } as Record<number, string>)[f.pending.length] ?? f.pending.length} განაცხადზე, რომელთაგან ბოლო ${kaOnDay(latest.date) ?? ''} შევიდა, საბოლოო გადაწყვეტილება ჯერ არ ჩანს. მათი შედეგი შეიძლება პროექტს ცვლიდეს.`.replace(/\s+/g, ' '));
  }
  if (f.pending.length) checks.push('ჰკითხეთ გამყიდველს, რას ეხება განხილვის პროცესში მყოფი განაცხადი და ეხება თუ არა ის თქვენს ბინას.');

  /* construction */
  if (f.constructionDocumented || f.auditFinding) {
    synthesisLines.push({ area: 'CONSTRUCTION', text: [
      f.auditFinding ? `მშენებლობა დაწყებულია, ამას მერიის აუდიტის ${kaOfMonth(f.auditFinding.date) ?? ''} დასკვნაც აჩვენებს.`.replace(/\s+/g, ' ') : 'მშენებლობის მიმდინარეობას ქალაქში წარდგენილი ფოტოები აჩვენებს.',
      f.commissioned ? 'შენობა ქალაქის აქტით ექსპლუატაციაში მიღებულია.' : 'ექსპლუატაციაში მიღების აქტი ჩანაწერებში არ ჩანს.',
    ].join(' ') });
  }
  if (f.auditFinding) {
    concerns.push(`${kaInMonth(f.auditFinding.date) ?? ''} მერიის აუდიტმა მიუთითა, რომ მშენებლობა შეთანხმებული პროექტისგან განსხვავებით მიმდინარეობდა. შემდეგ შესწორებული პროექტისთვის ნებართვა გაიცა, თუმცა ღირს გარკვევა, რა შეიცვალა.`.trim());
    checks.push('ჰკითხეთ, რა განსხვავება დააფიქსირა აუდიტმა და მოიცავს თუ არა შესწორებული პროექტი თქვენს ბინას.');
  }
  if (!f.commissioned) checks.push('ჰკითხეთ, როდის არის მოსალოდნელი ექსპლუატაციაში მიღება, და ჩაწერეთ ეს ვადა ხელშეკრულებაში.');

  /* people */
  if (f.namedProfessionals) {
    synthesisLines.push({ area: 'PEOPLE', text: `ქალაქის საქმეებში დასახელებულია ${f.namedProfessionals} პროფესიონალი თუ კომპანია, თითოეული თავისი დოკუმენტირებული როლით.` });
    strengths.push('პროექტის არქიტექტორები და ექსპერტები ოფიციალურ დოკუმენტებში სახელით არიან დასახელებული.');
  }

  /* neighbourhood */
  if (f.neighbourhoodPlaces) {
    synthesisLines.push({ area: 'NEIGHBORHOOD', text: `წყაროებში ბინის ახლოს ${f.neighbourhoodPlaces} ყოველდღიური დანიშნულების ადგილია დასახელებული.` });
  }

  /* market */
  if (f.marketState) {
    synthesisLines.push({ area: 'MARKET', text: f.marketThin ? 'ამ პროექტის ფასის შესაფასებლად საბაზრო მონაცემები ცოტაა.' : 'ახლომდებარე შეთავაზებები ფასის შესაფასებლად საკმარის ორიენტირს იძლევა.' });
    if (f.marketThin) {
      concerns.push('საბაზრო მონაცემები მწირია, ამიტომ ფასის სამართლიანობის დამოუკიდებლად შეფასება რთულია.');
      checks.push('შეადარეთ ფასი იმავე პროექტში ან ქუჩაზე გაყიდულ ბინებს და, საჭიროების შემთხვევაში, დაუკვეთეთ შეფასება.');
    }
  }

  const narrative = [
    strengths.length
      ? 'ამ ეტაპზე პროექტი მყიდველის გონივრულ ნდობას იმსახურებს იმ ნაწილში, რასაც დოკუმენტები ადასტურებს: ბინის სამართლებრივი მდგომარეობა და მოქმედი ნებართვა მყარ საფუძველს ქმნის.'
      : 'დოკუმენტებით დადასტურებული ფაქტები ჯერ საკმარისი არ არის, რომ პროექტზე ნდობის შესახებ მტკიცე დასკვნა გაკეთდეს.',
    concerns.length
      ? 'ნდობა სრული რომ იყოს, რამდენიმე საკითხი ჯერ კიდევ გასარკვევია და ისინი ქვემოთ ცალკეა ჩამოთვლილი. არცერთი მათგანი თავისთავად უარყოფითი დასკვნა არ არის, მაგრამ ხელმოწერამდე თითოეულზე პასუხი უნდა გქონდეთ.'
      : null,
  ].filter(Boolean).join(' ');

  return {
    synthesis: synthesisLines,
    narrative,
    strengths: strengths.slice(0, 5),
    concerns: concerns.slice(0, 5),
    checks: [...new Set(checks)].slice(0, 5),
    source: 'DETERMINISTIC',
  };
}


/**
 * The model's assessment when it passes the guard, with every concern the
 * evidence establishes kept; otherwise the assembled one. Dashes are removed
 * either way.
 */
export function finalBuyerAssessment(modelValue: unknown, synthesis: unknown): BuyerAssessment {
  const fallback = buildBuyerAssessment(synthesis);
  const parsed = parseBuyerAssessment(modelValue);
  const polish = (a: BuyerAssessment): BuyerAssessment => ({
    ...a,
    synthesis: a.synthesis.map((s) => ({ ...s, text: replaceDashes(s.text) })),
    narrative: replaceDashes(a.narrative),
    strengths: a.strengths.map(replaceDashes),
    concerns: a.concerns.map(replaceDashes),
    checks: a.checks.map(replaceDashes),
  });
  if (!parsed || assessmentProblems(parsed).length) return polish(fallback);
  const f = assessmentFacts(synthesis);
  const concerns = [...parsed.concerns];
  const mentions = (re: RegExp) => concerns.some((c) => re.test(c));
  // Never automatic praise: the concerns the record establishes stay.
  if (f.auditFinding && !mentions(/აუდიტ|დარღვევ|განსხვავებ|გადახვევ|audit|deviat/iu)) concerns.push(fallback.concerns.find((c) => /აუდიტ/u.test(c))!);
  if (f.pending.length && !mentions(/განაცხად|application|заявлен/iu)) concerns.push(fallback.concerns.find((c) => /განაცხად/u.test(c))!);
  if (f.marketThin && !mentions(/საბაზრო|ბაზრ|market|рын/iu)) concerns.push(fallback.concerns.find((c) => /საბაზრო/u.test(c))!);
  return polish({
    synthesis: parsed.synthesis.length ? parsed.synthesis : fallback.synthesis,
    narrative: parsed.narrative,
    strengths: parsed.strengths.length ? parsed.strengths : fallback.strengths,
    concerns: concerns.filter(Boolean).slice(0, 6),
    checks: parsed.checks.length ? parsed.checks : fallback.checks,
    source: 'MODEL',
  });
}

export function readBuyerAssessment(v: unknown): BuyerAssessment | null {
  const p = parseBuyerAssessment(v);
  if (!p) return null;
  return { ...p, source: obj(v).source === 'MODEL' ? 'MODEL' : 'DETERMINISTIC' };
}

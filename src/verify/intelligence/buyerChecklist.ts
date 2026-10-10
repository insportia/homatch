// HOMATCH — "რას გადავამოწმებდი ყიდვამდე".
//
// The short, practical list a knowledgeable person would hand a buyer before
// they pay. Built from what THIS report actually found.
//
// WHY IT IS NOT THE MODEL'S JOB
//
// The report schema has a `nextSteps` array and the live Villion synthesis
// returned it empty, so the whole section disappeared. A useful closing
// checklist is not an optional flourish the model may skip when it runs out
// of room: it is the part of the report a buyer acts on. So it is computed
// from the evidence, and the model's own steps are merged in rather than
// depended upon.
//
// THE TWO RULES
//
// 1. Every item must be EARNED by a finding. A pledge on the company earns
//    "check the property's own extract"; no pledge earns nothing. This is
//    deliberately not a fixed fifteen-point list — a checklist that says the
//    same thing about every property is wallpaper, and a buyer learns to
//    scroll past it.
//
// 2. Nothing already conclusively established is asked for again. Telling
//    somebody to verify the company's registration when the register has
//    already confirmed it wastes the one piece of attention they have.
//
// It is also NOT the material-risks section. Unknowns belong here, phrased as
// something to do. Adverse evidence belongs in risks, phrased as what is
// true. The distinction is the whole reason both exist.

import type { CompanyIntelligence } from './companyIntelligence.ts';
import type { MarketIntelligence } from './marketIntelligence.ts';
import type { PropertyRegister } from './propertyRegister.ts';

/** A single practical action. `detail` explains why it is worth doing. */
export interface ChecklistItem {
  /** Stable identifier, so the UI can translate and tests can assert. */
  key: string;
  /** i18n key for the action itself. */
  labelKey: string;
  /** i18n key for the one-line reason. */
  detailKey: string;
  /**
   * A real public destination, when one exists for this action. Never
   * invented: only services Homatch already links to elsewhere.
   */
  url?: string;
  /** The value the buyer needs in hand — a cadastral code, a company id. */
  value?: string;
  /** Interpolation values for the label/detail strings ({{date}}, {{creditor}}…). */
  params?: Record<string, string>;
}

/** Official destinations this product already uses elsewhere. */
const MYGOV_PROPERTY = 'https://www.my.gov.ge/ka-ge/services/5/service/176';
const RS_TAXPAYER = 'https://www.rs.ge/TaxPayersRegistry';

export interface ChecklistInput {
  cadastralCode?: string | null;
  company?: CompanyIntelligence | null;
  market?: MarketIntelligence | null;
  /** Utilities whose state the research could not establish. */
  unknownUtilities?: string[];
  /** True when the report says parking is included/available. */
  parkingMentioned?: boolean;
  /** The subject's own asking price, when the research found one. */
  subjectPriceKnown?: boolean;
  /** The unit's own register, parsed from the extract HOMATCH retrieved. */
  register?: PropertyRegister | null;
}

/** dd.mm.yyyy, the way a Georgian document prints a date. */
const dmy = (iso: string | null | undefined): string => {
  const m = typeof iso === 'string' ? iso.match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
};
/** The creditor as a reader names it: the quoted brand when there is one. */
const creditorName = (c: string | null | undefined): string => {
  const v = String(c ?? '').trim();
  return v.match(/["„“]([^"„“”]+)["“”]/)?.[1]?.trim() || v;
};

/**
 * Builds the checklist. Order is the order a buyer would actually do them:
 * the property record first, then who they are paying, then what they are
 * paying for.
 */
export function buildBuyerChecklist(input: ChecklistInput): ChecklistItem[] {
  const out: ChecklistItem[] = [];
  const company = input.company ?? null;
  const cadastral = (input.cadastralCode ?? '').trim();

  /* ---- the property's own record ---- */

  const reg = input.register?.latest ? input.register : null;
  const asOf = dmy(reg?.latest?.issuedAt);
  const owners = reg?.latest?.owners ?? [];
  const privateOwner = owners.length > 0 && owners.every((o) => o.kind === 'PERSON');

  /*
   * HOMATCH ALREADY READ THE EXTRACT — SAY SO, DON'T ASK FOR IT.
   *
   * The c80f7237 report told the buyer to "get the newest extract" while
   * HOMATCH held one dated 22.09.2026. With an extract in hand the honest
   * advice is narrower and more useful: the register can change after that
   * date, so ask for one dated the signing day.
   */
  if (cadastral && reg && asOf) {
    out.push({
      key: 'EXTRACT_ON_SIGNING_DAY',
      labelKey: 'bc_fresh_extract_label',
      detailKey: 'bc_fresh_extract_detail',
      url: MYGOV_PROPERTY,
      value: cadastral,
      params: { date: asOf },
    });
  } else if (cadastral) {
    out.push({
      key: 'PROPERTY_EXTRACT',
      labelKey: 'bc_extract_label',
      detailKey: 'bc_extract_detail',
      url: MYGOV_PROPERTY,
      value: cadastral,
    });
  }

  /* A mortgage ON THIS APARTMENT is the buyer's business at closing. */
  for (const m of (reg?.currentMortgages ?? []).slice(0, 3)) {
    out.push({
      key: `UNIT_MORTGAGE${m.agreementNumber ? `_${m.agreementNumber}` : ''}`,
      labelKey: 'bc_unit_mortgage_label',
      detailKey: 'bc_unit_mortgage_detail',
      params: { date: asOf, creditor: creditorName(m.creditor), registered: dmy(m.registeredOn) },
    });
  }

  /* The seller must be the person the register names. */
  if (reg && privateOwner) {
    out.push({
      key: 'SELLER_IS_OWNER',
      labelKey: 'bc_seller_owner_label',
      // Owner, 2026-10-10: name the owner exactly as the extract does.
      ...(() => {
        const names = owners.map((o) => o.name).filter((n): n is string => !!n);
        return names.length
          ? { detailKey: 'bc_seller_owner_named_detail', params: { date: asOf, since: dmy(reg.latest!.ownershipRegisteredOn), name: names.join(', ') } }
          : { detailKey: 'bc_seller_owner_detail', params: { date: asOf, since: dmy(reg.latest!.ownershipRegisteredOn) } };
      })(),
    });
  }

  /*
   * A COMPANY-LEVEL CHARGE, ONLY WHEN THE UNIT'S OWN RECORD IS UNKNOWN.
   *
   * Without an extract, the developer's pledge earns a property-level
   * question. With one, the apartment's mortgages are known and listed above;
   * restating the company's pledge as a question about the flat would put
   * the two back together.
   */
  if (!reg && company?.encumbrances.length && cadastral) {
    out.push({
      key: 'ENCUMBRANCE_SCOPE',
      labelKey: 'bc_encumbrance_label',
      detailKey: 'bc_encumbrance_detail',
      url: MYGOV_PROPERTY,
      value: cadastral,
    });
  }

  /* No commissioning task (owner, 2026-10-09): a finished building the
     register still lists as „მშენებარე“ is the normal registration lag, not
     something the buyer should be sent to chase. */

  /* ---- who the money goes to ---- */

  /*
   * The developer is the counterparty only when it is (or may be) the owner.
   * When the extract names a private owner, the developer's taxpayer status
   * and signing rule describe somebody who is not selling this flat.
   */
  const companyIsCounterparty = !privateOwner;

  if (companyIsCounterparty && company?.idCode) {
    out.push({
      key: 'TAXPAYER_STATUS',
      labelKey: 'bc_taxpayer_label',
      detailKey: 'bc_taxpayer_detail',
      url: RS_TAXPAYER,
      value: company.idCode,
    });
  }

  // Joint representation is a signing rule with a practical consequence, and
  // it is only worth raising when the register actually established it.
  if (companyIsCounterparty && company?.representationRule === 'JOINT') {
    out.push({
      key: 'JOINT_SIGNATURE',
      labelKey: 'bc_joint_label',
      detailKey: 'bc_joint_detail',
    });
  }

  // The account money is sent to is the one thing no register can confirm
  // afterwards — whoever the seller is.
  if (privateOwner) {
    out.push({
      key: 'PAYMENT_ACCOUNT',
      labelKey: 'bc_payment_label',
      detailKey: 'bc_payment_owner_detail',
    });
  } else if (company?.legalName) {
    out.push({
      key: 'PAYMENT_ACCOUNT',
      labelKey: 'bc_payment_label',
      detailKey: 'bc_payment_detail',
    });
  }

  /* ---- what is actually being bought ---- */

  if (input.unknownUtilities?.length) {
    out.push({
      key: 'UTILITIES_ON_SITE',
      labelKey: 'bc_utilities_label',
      detailKey: 'bc_utilities_detail',
    });
  }

  if (input.parkingMentioned) {
    out.push({
      key: 'PARKING_RIGHTS',
      labelKey: 'bc_parking_label',
      detailKey: 'bc_parking_detail',
    });
  }

  /*
   * Only when there IS a market picture but no price for this unit. Asking a
   * buyer to compare against a market we could not describe would be asking
   * them to do our work; asking when they already have both is noise.
   */
  if (input.market?.contextAvailable && !input.subjectPriceKnown) {
    out.push({
      key: 'PRICE_AGAINST_MARKET',
      labelKey: 'bc_price_label',
      detailKey: 'bc_price_detail',
    });
  }

  return out;
}

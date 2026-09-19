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
}

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

  if (cadastral) {
    out.push({
      key: 'PROPERTY_EXTRACT',
      labelKey: 'bc_extract_label',
      detailKey: 'bc_extract_detail',
      url: MYGOV_PROPERTY,
      value: cadastral,
    });
  }

  /*
   * A COMPANY-LEVEL CHARGE EARNS A PROPERTY-LEVEL QUESTION.
   *
   * This is the single most useful thing the Villion report can tell its
   * reader: the registry shows a pledge against the DEVELOPER, and whether
   * anything is registered against this apartment is a different document
   * that the buyer can obtain. Stating the distinction is not enough — the
   * action that resolves it belongs here.
   */
  if (company?.encumbrances.length && cadastral) {
    out.push({
      key: 'ENCUMBRANCE_SCOPE',
      labelKey: 'bc_encumbrance_label',
      detailKey: 'bc_encumbrance_detail',
      url: MYGOV_PROPERTY,
      value: cadastral,
    });
  }

  /* ---- who the money goes to ---- */

  if (company?.idCode) {
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
  if (company?.representationRule === 'JOINT') {
    out.push({
      key: 'JOINT_SIGNATURE',
      labelKey: 'bc_joint_label',
      detailKey: 'bc_joint_detail',
    });
  }

  // Always relevant once a company is the counterparty: the account money is
  // sent to is the one thing no register can confirm afterwards.
  if (company?.legalName) {
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

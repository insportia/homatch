// SERVICE ACTIONS — the OTHER kind of chip, and the wall between the two.
//
// A suggested reply (suggestedReplies.ts) is something the PERSON says: it
// sends text and can never navigate. A service action is the opposite: it
// OPENS a real HOMATCH product and can never say anything. Keeping them in
// two modules with two validators is what keeps a chip that spends nothing
// visually and semantically distinct from a road toward something that
// might (§64 of the master mandate: nobody spends credits because a control
// looked like a reply chip).
//
// THE MODEL PICKS FROM A CATALOGUE, IT NEVER WRITES A DESTINATION.
//
// The model returns bare IDs ("VERIFY"). Everything renderable — the route,
// the label key — lives HERE, in code, against real registered routes. A
// hallucinated service cannot appear because an unknown ID does not survive
// validation; a mistranslated label cannot appear because labels come from
// the i18n bundle, not from the model.
//
// OPENING A PRODUCT IS FREE. Every route below lands on a product's own
// screen, where its own flow states any price and asks for its own
// confirmation. Nothing here charges, starts, or submits anything.
//
// No React, no Deno, no Supabase: importable from the browser bundle, from
// the edge function by relative path, and from node:test directly.

/** One product the conversation can hand off to. */
export interface ServiceAction {
  /** Catalogue ID — also the analytics key. */
  id: ServiceActionId;
  /** The real SPA route the chip navigates to. */
  route: string;
  /** i18n key for the chip's label (resolved by the client, per locale). */
  labelKey: string;
}

/** More than three is advertising, not help (§7: usually 0–3). */
export const MAX_SERVICE_ACTIONS = 3;

/**
 * The catalogue. Every route is a REAL registered route (routes.tsx), and
 * the list deliberately mirrors the products the assistant's own prompt
 * describes — nothing here the prompt does not know, nothing in the prompt
 * this cannot render.
 */
export const SERVICE_ACTION_CATALOGUE = Object.freeze({
  VERIFY: { route: '/verify', labelKey: 'ai_action_verify' },
  CONTRACT_INTELLIGENCE: { route: '/contracts', labelKey: 'ai_action_contracts' },
  INVESTMENT: { route: '/investment', labelKey: 'ai_action_investment' },
  MORTGAGE: { route: '/mortgage', labelKey: 'ai_action_mortgage' },
  FIND_PROPERTY: { route: '/find-property', labelKey: 'ai_action_find_property' },
  FIND_BUYERS_TENANTS: { route: '/property', labelKey: 'ai_action_find_buyers' },
  BROKERS: { route: '/brokers', labelKey: 'ai_action_brokers' },
  META_ADS: { route: '/outreach/meta/create', labelKey: 'ai_action_meta_ads' },
} as const);

export type ServiceActionId = keyof typeof SERVICE_ACTION_CATALOGUE;

const IDS = Object.keys(SERVICE_ACTION_CATALOGUE) as ServiceActionId[];

/**
 * Model output → renderable actions. Unknown IDs, duplicates, wrong shapes
 * and overlong lists all fall away silently: a bad suggestion costs the
 * response nothing but the chip.
 */
export function parseServiceActions(raw: unknown): ServiceAction[] {
  if (!Array.isArray(raw)) return [];
  const out: ServiceAction[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const id = item.trim().toUpperCase() as ServiceActionId;
    if (!IDS.includes(id)) continue;
    if (out.some((a) => a.id === id)) continue;
    const entry = SERVICE_ACTION_CATALOGUE[id];
    out.push({ id, route: entry.route, labelKey: entry.labelKey });
    if (out.length >= MAX_SERVICE_ACTIONS) break;
  }
  return out;
}

/**
 * The instruction the edge function appends to the extraction contract.
 * Kept beside the catalogue so the two cannot drift: the IDs the model is
 * offered are generated from the same object the validator accepts.
 */
/**
 * CONTEXT TRAVELS, BUT ONLY THROUGH CODE.
 *
 * When the conversation already knows which property it is about, the chip's
 * destination carries that forward — the person should never re-enter what
 * HOMATCH already knows. The mapping is deterministic and lives here: the
 * model still returns bare IDs, and only routes that actually PARSE a query
 * parameter receive one (MetaAdsCreatePage reads ?property=, VerifyPage reads
 * ?code= for a cadastral code). Everything else navigates to the product's
 * own start, which reads shared context through its own flow.
 */
export function routeForAction(
  action: ServiceAction,
  context?: { propertyId?: string | null; cadastralCode?: string | null },
): string {
  if (action.id === 'META_ADS' && context?.propertyId) {
    return `${action.route}?property=${encodeURIComponent(context.propertyId)}`;
  }
  if (action.id === 'VERIFY' && context?.cadastralCode) {
    return `${action.route}?code=${encodeURIComponent(context.cadastralCode)}`;
  }
  return action.route;
}

export const SERVICE_ACTIONS_INSTRUCTION = [
  'SERVICE ACTIONS',
  'In the same JSON block, also return "suggested_actions": an array of 0 to 3 service IDs, ONLY',
  `from this exact list: ${IDS.join(', ')}.`,
  'Include one ONLY when that product is the obvious next step for what the user just asked —',
  'the same judgement as the service-mention rule above, expressed as IDs instead of prose. A',
  'reply that recommends a service in its text should carry the matching ID; a reply that',
  'recommends nothing returns []. Most replies return []. Never invent an ID, never repeat one,',
  'never exceed three.',
].join('\n');

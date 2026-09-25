// HOMATCH — the app's one door onto the core's search-language logic.
//
// WHY A SEAM AND NOT A DIRECT IMPORT
//
// research-core is runtime-neutral and has one way in per consumer, and
// __tests__/runtimeNeutrality.test.mjs enforces it by name. Its own comment
// says the quiet part: "If a component ever appears in this list, that is the
// signal the seam has stopped being a seam."
//
// A React component importing campaign-languages.ts directly would have been
// exactly that. It looks harmless — the module is pure, it has no fetch path
// and no rate constant — but the rule is not about this module. It is about
// the next one: once a component reaches into the core for a helper, the
// component after it reaches in for a fetch primitive and bypasses the
// network policy, the rate limits and the cost accounting, and nothing
// notices until production.
//
// So the seam is one file, it re-exports only what the launch screen and the
// workspace actually need, and adding to it is a deliberate edit.
//
// WHAT IS DELIBERATELY NOT HERE
//
// Nothing is re-implemented. Every function below is the core's own, so the
// set the customer is shown is computed by the same code that computes the
// set the server runs. A "simplified version for the UI" would be a second
// answer to a question that already has one, and the day they disagree the
// screen and the receipt disagree.


export type {
  CampaignLanguageSelection,
  CampaignSearchLanguage,
  CommunicationRequirement,
  CommunicationVerdict,
  LanguageCoverage,
  LanguageEvidence,
  LanguageMode,
  LanguageRationale,
} from '@/research-core/discovery/campaign-languages';
export {
  CAMPAIGN_SEARCH_LANGUAGES,
  communicationVerdict,
  estimateLanguagePlan,
  excludedByCommunication,
  isCampaignSearchLanguage,
  languageDelta,
  marketLanguages,
  resolveCampaignLanguages,
  summariseCoverage,
} from '@/research-core/discovery/campaign-languages';

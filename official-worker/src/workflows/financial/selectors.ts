// selectors.ts — live-confirmed financial/company source contracts.

// RS Taxpayers Registry (rs.ge).
export const RSTAX_URL = 'https://www.rs.ge/TaxpayersRegistry';
export const RSTAX_ID_INPUT_SELECTORS = ['#tin', 'input[name="tin" i]', 'input[placeholder*="სნ" i]'];
export const RSTAX_CAPTCHA_BLOCK_PHRASE = /უსაფრთხოების\s*ღილაკი/i;

// MyGov debtor lookup.
export const DEBTOR_URL = 'https://my.gov.ge/ka-ge/services/38/searchdebtorinfo';
export const DEBTOR_ID_INPUT_SELECTORS = ['input[name="debtorIdNumber" i]'];

// Keep the internal source keys/URLs for execution and evidence provenance,
// but expose only a generic government-source label to customer-facing data.
export const RSTAX_SOURCE_META = { name: 'Official Government Sources', class: 'OFFICIAL_GOVERNMENT', url: RSTAX_URL };
export const DEBTOR_SOURCE_META = { name: 'Official Government Sources', class: 'OFFICIAL_GOVERNMENT', url: DEBTOR_URL };

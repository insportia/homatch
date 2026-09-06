// Exact mandated entry point — service 176 under service GROUP 10, never the
// homepage, a generic /search?keyword= query, or a different service id/group.
export const MYGOV_URL = 'https://www.my.gov.ge/ka-ge/services/10/service/176';
export const CADASTRAL_INPUT_SELECTORS = ['input[placeholder*="საკადასტრო" i]', 'input[name*="cad" i]', 'input[id*="cad" i]'];
// naprweb's Angular app doesn't always show up as a Playwright frame — but
// its iframe src IS present in the raw DOM. Its invisible reCAPTCHA anchor
// can take up to 20-30s to finish executing before the real app iframe
// appears at all (Google's own declared readiness window), hence the long
// poll in MyGovPage.pollForRegistryIframe.
export const REGISTRY_IFRAME_PATTERN = /reestri\.gov\.ge|naprweb/i;

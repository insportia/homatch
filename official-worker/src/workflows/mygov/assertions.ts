// assertions.ts (MyGov) — the direct fix for the reported false
// "no matching record" bug. A field found only via a weak, generic
// candidate-scan (not a known-good HINT selector, and not even a
// cadastral-keyword-matched candidate) must NEVER be trusted as the real
// search context — however the page happens to read afterward.
export { canMarkMygovExhausted } from '../../state/transitions.js';

const TRUSTED_TIERS = new Set(['HINT_MATCH', 'CADASTRAL_FIELD_MATCH']);

export function assertCorrectSearchContext(contextConfidence: string | null | undefined): boolean {
  return !!contextConfidence && TRUSTED_TIERS.has(contextConfidence);
}

export function assertPropertySearchContextConfirmed(service176Opened: boolean, registryAppOpened: boolean): boolean {
  return service176Opened && registryAppOpened;
}

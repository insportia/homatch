// RsTaxpayerParsing.ts — the PURE (no Playwright) result-page parsing and
// success-evidence gate for RS Taxpayers Registry, split out of
// RsTaxpayerWorker.ts so it is independently unit-testable like every other
// workflow's assertions.ts (RsTaxpayerWorker.ts itself stays Playwright-
// driving and is excluded from tsconfig.test.json for that reason).
//
// 2026-09 "report intelligence v2" mandate, Section 7/18: "RS successful
// verification requires actual parsed taxpayer-result fields... never mark
// RS success merely because the page loaded... captcha skipped != success."
import type { RsTaxpayerPublicData } from '../WorkflowResult.js';

/** Best-effort deterministic label:value extraction from the result page's
 * visible text. Every field is nullable; a label this run cannot
 * confidently locate is left null rather than guessed. Never AI-assisted
 * (mandate: "AI is never authoritative for a deterministic workflow
 * decision"). */
export function parseRsTaxpayerFields(text: string, idCode: string): RsTaxpayerPublicData {
  const grab = (labelPattern: RegExp): string | null => {
    const m = labelPattern.exec(text);
    return m ? m[1].trim().replace(/\s+/g, ' ').slice(0, 300) : null;
  };
  const otherPublicFields: Record<string, string> = {};
  const identificationCode = grab(/საიდენტიფიკაციო\s*(?:კოდი|ნომერი)?\s*[:։]?\s*([0-9-]{6,})/i) || (text.includes(idCode) ? idCode : null);
  const taxpayerName = grab(/(?:დასახელება|სახელწოდება|გადამხდელის\s*დასახელება)\s*[:։]\s*([^\n]{2,200})/i);
  const legalForm = grab(/სამართლებრივი\s*ფორმა\s*[:։]\s*([^\n]{2,120})/i);
  const status = grab(/სტატუსი\s*[:։]\s*([^\n]{2,80})/i);
  const registrationDate = grab(/რეგისტრაციის\s*თარიღი\s*[:։]\s*([0-9./\-]{6,20})/i);
  const vatStatus = grab(/დღგ[\s-]*(?:გადამხდელი|სტატუსი)?\s*[:։]\s*([^\n]{2,80})/i);
  const address = grab(/მისამართი\s*[:։]\s*([^\n]{2,250})/i);
  return { identificationCode, taxpayerName, legalForm, status, registrationDate, vatStatus, address, otherPublicFields };
}

/** Real-evidence gate: a new result signal plus the absence of a no-result
 * phrase is not, by itself, proof the page actually shows a taxpayer
 * record — it could be an unrecognized layout, a partial render, or a
 * signal change unrelated to a real result. `identificationCode` alone
 * doesn't count: parseRsTaxpayerFields() falls back to just echoing the
 * searched idCode when it merely appears somewhere in the page text, which
 * is not independent evidence. Require at least one of the genuinely-
 * parsed descriptive fields before a result can be called confirmed. */
export function hasParsedTaxpayerEvidence(d: RsTaxpayerPublicData | null): boolean {
  if (!d) return false;
  return Boolean(d.taxpayerName || d.legalForm || d.status || d.registrationDate || d.vatStatus || d.address);
}

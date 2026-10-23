// The ladder a CRM prospect climbs, from a Find Buyers discovery to an email-eligible contact.
// Each step is a recorded fact; none is inferred, and discovery alone reaches only the first.

/** The ladder a CRM prospect climbs. Each step is a fact, never an inference. */
export type CrmLadderStep = 'DISCOVERED' | 'QUALIFIED' | 'CONTACTABLE' | 'EMAIL_ELIGIBLE';

export function crmLadder(c: {
  matchCategory?: string | null; email?: string | null; phone?: string | null; consentStatus?: string | null;
  suppressed?: boolean | null; unsubscribed?: boolean | null; doNotContact?: boolean | null;
}): CrmLadderStep[] {
  const steps: CrmLadderStep[] = ['DISCOVERED'];
  if (c.matchCategory === 'STRONG' || c.matchCategory === 'POTENTIAL') steps.push('QUALIFIED');
  if (c.email || c.phone) steps.push('CONTACTABLE');
  if (c.email && c.consentStatus === 'CONSENTED' && !c.suppressed && !c.unsubscribed && !c.doNotContact) steps.push('EMAIL_ELIGIBLE');
  return steps;
}

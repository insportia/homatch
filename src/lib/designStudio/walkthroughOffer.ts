// Whether the result offers "Experience in 3D" as an action.
//
// OFF until the walkthrough is proven correct (PR2: every door kept, every
// room reachable, a failed build never navigates). The walkthrough route and
// its code stay; only the customer-facing offer is held back. Flip this, and
// the result shows the action again — nothing else changes.
export const WALKTHROUGH_OFFERED = false;

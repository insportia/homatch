// HOMATCH Verify — "Market position".
//
// The MARKET prose only, for now (owner, 2026-10-10: the market is explained
// in friendly words, not rows of numbers).
//
// MOUNT POINT: `market` is accepted and deliberately unused. The market data
// contract is being rebuilt in parallel; when it lands, its numbers card
// renders here — under the prose, inside this chapter — and nowhere else.

import React from 'react';

export interface MarketPositionSection {
  key: string;
  title: string;
  body: string;
  metrics?: { label: string; value: string }[];
}

export const MarketPosition: React.FC<{
  sections: MarketPositionSection[];
  /** Reserved for the rebuilt market contract. Intentionally not rendered yet. */
  market?: unknown;
  renderSection: (s: MarketPositionSection) => React.ReactNode;
}> = ({ sections, renderSection }) => {
  if (!sections.length) return null;
  return <div className="space-y-8">{sections.map((s) => <React.Fragment key={s.key}>{renderSection(s)}</React.Fragment>)}</div>;
};

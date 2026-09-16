/**
 * The sub-navigation for Sales, in one place so the screens under it cannot
 * drift apart. `hidden` is resolved by the caller from the caller's own
 * capabilities — a finance controller has no Viewings tab, a sales agent has
 * no Payments tab, and neither is shown a control that would refuse them.
 *
 * Nine tabs is a lot, and every one of them is a different job somebody does
 * on a different day: qualifying, showing, quoting, holding, signing,
 * collecting, paying out, handing over, reporting. Merging any two would mean
 * a screen that is about two things. The cap of eight in the brief is on
 * TOP-LEVEL destinations, which is still eight; this is the inside of one of
 * them, and the strip scrolls on a phone.
 */
export interface SalesTab {
  path: string;
  labelKey: string;
  hidden?: boolean;
}

export function salesTabs(
  can: (capability: 'crm' | 'finance' | 'sale' | 'crm_all' | 'legal') => boolean,
): SalesTab[] {
  return [
    { path: '/developers/sales', labelKey: 'dev_sales_tab_pipeline' },
    { path: '/developers/sales/viewings', labelKey: 'dev_sales_tab_viewings', hidden: !can('crm') },
    { path: '/developers/sales/offers', labelKey: 'dev_sales_tab_offers', hidden: !can('crm') },
    { path: '/developers/sales/reservations', labelKey: 'dev_sales_tab_reservations' },
    { path: '/developers/sales/contracts', labelKey: 'dev_sales_tab_contracts' },
    { path: '/developers/sales/payments', labelKey: 'dev_sales_tab_payments', hidden: !(can('finance') || can('sale')) },
    { path: '/developers/sales/commissions', labelKey: 'dev_sales_tab_commissions', hidden: !(can('finance') || can('crm_all')) },
    { path: '/developers/sales/handover', labelKey: 'dev_sales_tab_handover' },
    { path: '/developers/sales/ledger', labelKey: 'dev_sales_tab_ledger' },
  ];
}

/**
 * The sub-navigation for Sales, in one place so the five screens under it
 * cannot drift apart. `hidden` is resolved by the caller from the caller's
 * own capabilities — a finance controller has no Viewings tab, a sales agent
 * has no Payments tab, and neither is shown a control that would refuse them.
 */
export interface SalesTab {
  path: string;
  labelKey: string;
  hidden?: boolean;
}

export function salesTabs(can: (capability: 'crm' | 'finance' | 'sale') => boolean): SalesTab[] {
  return [
    { path: '/developers/sales', labelKey: 'dev_sales_tab_pipeline' },
    { path: '/developers/sales/viewings', labelKey: 'dev_sales_tab_viewings', hidden: !can('crm') },
    { path: '/developers/sales/reservations', labelKey: 'dev_sales_tab_reservations' },
    { path: '/developers/sales/deals', labelKey: 'dev_sales_tab_deals' },
    { path: '/developers/sales/payments', labelKey: 'dev_sales_tab_payments', hidden: !(can('finance') || can('sale')) },
    { path: '/developers/sales/ledger', labelKey: 'dev_sales_tab_ledger' },
  ];
}

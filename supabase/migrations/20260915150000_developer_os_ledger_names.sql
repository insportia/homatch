-- ============================================================================
-- HOMATCH FOR DEVELOPERS — the ledger learns who the sales manager is.
--
-- FOUND BY RUNNING IT, AGAIN
--
-- dev_sales_ledger joined public.users twice, for the sales manager and the
-- broker. The view is security_invoker, which is correct and is the whole
-- reason each caller sees only their own workspace's deals — but it means
-- those two joins are also evaluated as the caller, and public.users lets
-- nobody read anybody else's row.
--
-- So every deal in the exported sales file came out with an empty Sales
-- Manager column, except for the deals you happened to own yourself. Not an
-- error, not a warning: a blank cell in the report a developer hands to their
-- bank. The end-to-end run caught it because the fixture deliberately had the
-- owner export a deal that an agent had worked.
--
-- dev_team is the view that already solves this for the team screen: owner
-- rights, restricted by dev_is_member(). A workspace member may see the name
-- of a colleague on the same workspace, and nothing else changes.
-- ============================================================================

create or replace view public.dev_sales_ledger
with (security_invoker = true) as
select
  d.id                          as deal_id,
  d.workspace_id,
  p.name                        as project,
  b.name                        as building,
  u.unit_number,
  u.floor_level,
  u.area_total,
  u.unit_type,
  u.bedrooms,
  lc.full_name                  as buyer,
  lc.phone                      as buyer_phone,
  lc.email                      as buyer_email,
  mgr.full_name                 as sales_manager,
  l.source                      as lead_source,
  brk.full_name                 as broker,
  r.reserved_at,
  d.contract_number,
  d.contract_date,
  d.sale_date,
  d.list_price,
  d.discount_amount,
  d.sale_price,
  d.currency,
  case when u.area_total > 0 then round(d.sale_price / u.area_total, 2) end as sale_price_per_sqm,
  coalesce(pay.confirmed_total, 0)                as paid,
  d.sale_price - coalesce(pay.confirmed_total, 0) as outstanding,
  nxt.due_date                  as next_payment_due,
  nxt.amount                    as next_payment_amount,
  case
    when coalesce(pay.confirmed_total, 0) >= d.sale_price then 'PAID'
    when ovd.overdue_count > 0 then 'OVERDUE'
    when coalesce(pay.confirmed_total, 0) > 0 then 'PARTIAL'
    else 'PENDING'
  end                           as payment_status,
  d.status                      as deal_status,
  u.status                      as unit_status,
  d.notes,
  d.created_at,
  d.unit_id,
  d.lead_id,
  d.project_id
from public.dev_deals d
join public.dev_units u          on u.id = d.unit_id
join public.dev_projects p       on p.id = u.project_id
left join public.dev_buildings b on b.id = u.building_id
join public.dev_leads l          on l.id = d.lead_id
left join public.dev_lead_contacts lc on lc.lead_id = l.id
-- dev_team, not users: a colleague's name is readable to the workspace, and
-- public.users is readable only to its owner. See the header.
left join public.dev_team mgr    on mgr.user_id = d.assigned_to
                                and mgr.workspace_id = d.workspace_id
left join public.dev_team brk    on brk.user_id = d.broker_id
                                and brk.workspace_id = d.workspace_id
left join public.dev_reservations r on r.id = d.reservation_id
left join lateral (
  select sum(amount) as confirmed_total
    from public.dev_payments dp
   where dp.deal_id = d.id and dp.status = 'CONFIRMED'
) pay on true
left join lateral (
  select s.due_date, s.amount
    from public.dev_payment_schedule s
   where s.deal_id = d.id and s.status <> 'PAID'
   order by s.due_date nulls last, s.seq
   limit 1
) nxt on true
left join lateral (
  select count(*) as overdue_count
    from public.dev_payment_schedule s
   where s.deal_id = d.id and s.status = 'OVERDUE'
) ovd on true;

grant select on public.dev_sales_ledger to authenticated;

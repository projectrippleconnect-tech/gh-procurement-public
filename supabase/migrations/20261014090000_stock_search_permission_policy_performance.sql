-- Speed up stock item searches and cycle-count lookups without relaxing RLS.
-- These stable, request-scoped permission checks take no row input.
-- Wrapping them in SELECT turns them into initplans evaluated once per query
-- rather than repeatedly for every item/balance returned.
-- Preserve BOTH existing read policies and their existing permission arrays.
alter policy proc_permission_read on public.proc_items
  using ((select private.proc_has_any_permission(
    array['items.view','stock.count.view','procurement.requirements.view','reports.view']::text[]
  )));
alter policy proc_read on public.proc_items
  using ((select private.proc_has_any_permission(
    array['items.view','stock.count.view','procurement.requirements.view','reports.view']::text[]
  )));
alter policy proc_permission_read on public.proc_stock_balances
  using ((select private.proc_has_any_permission(
    array['stock.count.view','items.view','reports.view']::text[]
  )));
alter policy proc_read on public.proc_stock_balances
  using ((select private.proc_has_any_permission(
    array['stock.count.view','items.view','reports.view']::text[]
  )));

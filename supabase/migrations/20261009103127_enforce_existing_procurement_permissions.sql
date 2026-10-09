-- Honor existing granular read permissions; permissive RLS policies combine with OR.
do $migration$
declare p record;
begin
 for p in select legacy.tablename, scoped.qual
  from pg_policies legacy join pg_policies scoped
   on scoped.schemaname=legacy.schemaname and scoped.tablename=legacy.tablename
  where legacy.schemaname='public' and legacy.policyname='proc_read'
    and scoped.policyname='proc_permission_read' and scoped.cmd='SELECT'
 loop
  execute format('alter policy proc_read on public.%I using (%s)',p.tablename,p.qual);
 end loop;
end
$migration$;
create or replace function public.proc_approve_po_v2(p_po_id uuid)
returns text language plpgsql set search_path='' as $function$
begin
 if not private.proc_has_permission('procurement.orders.approve') then
  raise exception 'Permission denied: procurement.orders.approve' using errcode='42501';
 end if;
 update public.proc_purchase_orders set status='approved'
 where id=p_po_id and status='pending_approval';
 if not found then raise exception 'Purchase order is not pending approval'; end if;
 return 'approved';
end
$function$;

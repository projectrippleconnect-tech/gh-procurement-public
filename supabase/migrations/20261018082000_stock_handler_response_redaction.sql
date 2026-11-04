-- Applied to GH NEXUS production on 2026-10-18 as migration stock_handler_internal_purchase_result_redaction.
-- Redact purchasing calculations in stock-only API responses while preserving
-- stock entry, count history, buyer permissions, existing routes and approval controls.
-- Generated from verified production function definitions after successful migration.

CREATE OR REPLACE FUNCTION public.proc_stock_submission_detail_v1(p_count_id uuid)
 RETURNS TABLE(line_id uuid, item_id uuid, item_code text, description text, size text, uom text, current_stock numeric, suggested_qty numeric, required_qty numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 may_view_purchase boolean;
begin
 perform private.proc_assert_access();
 may_view_purchase:=coalesce(private.proc_has_permission('procurement.requirements.view'),false)
                   or coalesce(private.proc_has_permission('procurement.orders.view'),false);
 return query
 select
  cl.id,i.id,i.item_code,i.description,i.size,i.uom,cl.current_stock,
  case when may_view_purchase then cl.suggested_qty else null::numeric end,
  case when may_view_purchase then cl.required_qty else null::numeric end
 from public.proc_stock_count_lines cl
 join public.proc_stock_counts c on c.id=cl.count_id
 join public.proc_items i on i.id=cl.item_id
 where cl.count_id=p_count_id and c.status='submitted' and (
   c.counted_by=auth.uid()
   or private.proc_has_permission('procurement.requirements.view')
   or private.proc_has_permission('items.edit')
 )
 order by i.description,i.size;
end
$function$;

CREATE OR REPLACE FUNCTION public.proc_stock_submission_history_v1(p_limit integer DEFAULT 25)
 RETURNS TABLE(count_id uuid, count_no text, category text, submitted_at timestamp with time zone, counted_by uuid, counted_by_name text, item_count bigint, shortage_count bigint, zero_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 may_view_purchase boolean;
begin
 perform private.proc_assert_access();
 may_view_purchase:=coalesce(private.proc_has_permission('procurement.requirements.view'),false)
                   or coalesce(private.proc_has_permission('procurement.orders.view'),false);
 return query
 select
  c.id,c.count_no,c.category,c.submitted_at,c.counted_by,
  coalesce(nullif(trim(p.display_name),''),'Staff') as counted_by_name,
  count(cl.id) as item_count,
  case when may_view_purchase
    then count(cl.id) filter (where coalesce(cl.required_qty,0)>0)
    else null::bigint end as shortage_count,
  count(cl.id) filter (where cl.current_stock=0) as zero_count
 from public.proc_stock_counts c
 left join public.proc_stock_count_lines cl on cl.count_id=c.id
 left join public.proc_profiles p on p.id=c.counted_by
 where c.status='submitted' and (
   c.counted_by=auth.uid()
   or private.proc_has_permission('procurement.requirements.view')
   or private.proc_has_permission('items.edit')
 )
 group by c.id,c.count_no,c.category,c.submitted_at,c.counted_by,p.display_name
 order by c.submitted_at desc nulls last
 limit least(greatest(coalesce(p_limit,25),1),100);
end
$function$;

CREATE OR REPLACE FUNCTION public.proc_submit_stock_and_continue_v3(p_category text, p_lines jsonb, p_notes text DEFAULT NULL::text, p_attachment_path text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 caller uuid:=auth.uid();
 trusted_started timestamptz;
 base jsonb;
 cid uuid;
 item_total integer:=0;
 shortage_total integer:=0;
 may_view_purchase boolean;
begin
 perform private.proc_assert_access();
 if caller is null then raise exception 'Not authenticated'; end if;
 if not private.proc_has_permission('stock.count.enter') then
  raise exception 'Permission denied: stock.count.enter' using errcode='42501';
 end if;
 select count_started_at into trusted_started
 from public.proc_stock_count_drafts
 where owner_id=caller;
 if trusted_started is null then
  trusted_started:=public.proc_begin_stock_count_session_v1();
 end if;
 base:=public.proc_submit_stock_check_v4(
  p_category,p_lines,p_notes,p_attachment_path,trusted_started
 );
 cid:=(base->>'count_id')::uuid;
 select count(*),
        count(*) filter (where coalesce(required_qty,0)>0)
 into item_total,shortage_total
 from public.proc_stock_count_lines
 where count_id=cid;
 delete from public.proc_stock_count_drafts where owner_id=caller;
 may_view_purchase:=coalesce(private.proc_has_permission('procurement.requirements.view'),false)
                   or coalesce(private.proc_has_permission('procurement.orders.view'),false);
 if may_view_purchase then
  return base || jsonb_build_object(
   'automation',jsonb_build_object(
    'status',case when shortage_total>0 then 'review_required' else 'no_requirements' end,
    'submitted_items',item_total,'requirements',shortage_total
   )
  );
 end if;
 return (base - 'requirements_created') || jsonb_build_object(
  'automation',jsonb_build_object('status','submitted','submitted_items',item_total)
 );
end
$function$;

revoke all on function public.proc_stock_submission_history_v1(integer) from public,anon;
revoke all on function public.proc_stock_submission_detail_v1(uuid) from public,anon;
revoke all on function public.proc_submit_stock_and_continue_v3(text,jsonb,text,text) from public,anon;
grant execute on function public.proc_stock_submission_history_v1(integer) to authenticated;
grant execute on function public.proc_stock_submission_detail_v1(uuid) to authenticated;
grant execute on function public.proc_submit_stock_and_continue_v3(text,jsonb,text,text) to authenticated;

-- Allow explicitly opted-in single-supplier company/category POs to be auto-approved
-- from the submitted stock count even if legacy company-wide auto approval is disabled.
-- Manual routes, RFQ routes, non-opted-in routes and historic global behavior are unchanged.
CREATE OR REPLACE FUNCTION private.proc_company_direct_orders(p_company_id uuid, p_requirement_ids uuid[], p_auto boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.proc_companies;r record;po_v jsonb;po_id_v uuid;po_no_v text;qty_v numeric;claims_v text;sub_v text;actor uuid;result jsonb:='[]';route_v jsonb;supplier_v uuid;send_v boolean;
begin
 perform private.proc_assert_access();
 select * into c from public.proc_companies where id=p_company_id and active for update;
 if c.id is null then return result;end if;
 if p_auto then
  if not private.proc_has_permission('stock.count.enter') or (not (c.auto_approve or c.group_auto_approve) and not exists (
   select 1 from public.proc_requirements req
   cross join lateral private.proc_company_effective_route(c.id,req.item_id) rt(route)
   where req.id=any(p_requirement_ids) and req.company_id=c.id
   and rt.route->>'mode'='direct' and coalesce((rt.route->>'explicit')::boolean,false)
   and coalesce((rt.route->>'auto_send')::boolean,false)
  )) then raise exception 'Automatic company approval is not enabled';end if;
  actor:=c.automation_admin_id;
 else
  if not private.proc_is_role(array['admin']) or not private.proc_has_permission('procurement.orders.approve') then raise exception 'Administrator approval required';end if;actor:=auth.uid();
 end if;
 if not exists(select 1 from public.proc_profiles where id=actor and active and role='admin') then raise exception 'Company automation approving admin is inactive';end if;
 claims_v:=current_setting('request.jwt.claims',true);sub_v:=current_setting('request.jwt.claim.sub',true);
 begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);perform set_config('request.jwt.claim.sub',actor::text,true);
  for r in select rr.* from public.proc_requirements rr where rr.id=any(p_requirement_ids) and rr.company_id=c.id and rr.status not in ('closed','cancelled','received') and rr.adjusted_qty>rr.ordered_qty order by rr.id for update of rr loop
   route_v:=private.proc_company_effective_route(c.id,r.item_id);
   if route_v->>'mode'<>'direct' then continue;end if;
   if jsonb_array_length(route_v->'supplier_ids')<>1 then raise exception 'Direct orders require exactly one active supplier for every item';end if;
   supplier_v:=(route_v->'supplier_ids'->>0)::uuid;
   send_v:=coalesce((route_v->>'auto_send')::boolean,false);
   -- Automatic submission only includes explicit opted-in routes or pre-existing company-level approval.
   if p_auto and ((route_v->>'explicit')::boolean and not send_v or not (route_v->>'explicit')::boolean and not c.auto_approve) then continue;end if;
   qty_v:=r.adjusted_qty-r.ordered_qty;
   if supplier_v is null or not exists(select 1 from public.proc_suppliers where id=supplier_v and active and supplier_kind='company') then raise exception 'Set an active company supplier contact for every ordered brand';end if;
   select (value->>'id')::uuid into po_id_v from jsonb_array_elements(result) where value->>'supplier_id'=supplier_v::text and (value->>'auto_send')::boolean=send_v and value->>'route_id' IS NOT DISTINCT FROM route_v->>'route_id';
   if po_id_v is null then
    insert into public.proc_purchase_orders(po_no,supplier_id,status,created_by,company_id,quantity_only,notes,terms,company_document_template)
    values('COMPANY-'||gen_random_uuid(),supplier_v,'pending_approval',actor,c.id,true,'Company quantity-only order. Price not requested.','Quantity only; supplier to confirm availability and delivery.',coalesce(route_v->'template','{}')) returning id,po_no into po_id_v,po_no_v;
    result:=result||jsonb_build_array(jsonb_build_object('id',po_id_v,'po_no',po_no_v,'supplier_id',supplier_v,'auto_send',send_v,'route_id',route_v->>'route_id'));
   end if;
   insert into public.proc_po_lines(po_id,requirement_id,item_id,qty,unit_price,discount_percent,tax_percent) values(po_id_v,r.id,r.item_id,qty_v,0,0,0);
   update public.proc_requirements set ordered_qty=ordered_qty+qty_v,status='ordered',approval_status='approved',selected_for_order=true,approved_by=actor,approved_at=now() where id=r.id;
  end loop;
  for po_v in select value from jsonb_array_elements(result) loop
   po_id_v:=(po_v->>'id')::uuid;
   perform public.proc_approve_po_v2(po_id_v);
   update public.proc_purchase_orders set auto_approved=p_auto,auto_approval_reason=case when p_auto then 'Company auto-approve configured by administrator' end where id=po_id_v;
   if coalesce((po_v->>'auto_send')::boolean,false) then insert into public.proc_company_dispatch_queue(po_id,company_id) values(po_id_v,c.id) on conflict(po_id) do nothing;end if;
  end loop;
  perform set_config('request.jwt.claims',coalesce(claims_v,''),true);perform set_config('request.jwt.claim.sub',coalesce(sub_v,''),true);
 exception when others then perform set_config('request.jwt.claims',coalesce(claims_v,''),true);perform set_config('request.jwt.claim.sub',coalesce(sub_v,''),true);raise;end;
 return result;
end $function$

CREATE OR REPLACE FUNCTION public.proc_submit_company_list_check_v2(p_company_id uuid, p_lines jsonb, p_notes text DEFAULT NULL::text, p_count_started_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare caller uuid:=auth.uid();c public.proc_companies;loc uuid;count_id_v uuid;count_no_v text;x jsonb;cli public.proc_company_list_items;it public.proc_items;current_v numeric;trigger_v numeric;suggested numeric;enough boolean;req_count integer;ids uuid[];orders jsonb:='[]';
begin
 perform private.proc_assert_access();
 if not private.proc_has_permission('stock.count.enter') then raise exception 'Stock entry permission required';end if;
 if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 or jsonb_array_length(p_lines)>1000 then raise exception 'Choose 1–1000 counted items';end if;
 select * into c from public.proc_companies where id=p_company_id and active and company_list_enabled;
 if c.id is null then raise exception 'Company list not found';end if;
 if (select count(distinct value->>'company_list_item_id') from jsonb_array_elements(p_lines))<>jsonb_array_length(p_lines) then raise exception 'Duplicate company stock item';end if;
 loc:=private.proc_default_location_id();count_no_v:='COMPANY-'||gen_random_uuid();
 insert into public.proc_stock_counts(count_no,location_id,category,status,counted_by,notes,count_started_at)
 values(count_no_v,loc,'COMPANY: '||c.name,'draft',caller,p_notes,coalesce(p_count_started_at,now())) returning id,count_no into count_id_v,count_no_v;
 for x in select value from jsonb_array_elements(p_lines) loop
  select * into cli from public.proc_company_list_items where id=(x->>'company_list_item_id')::uuid and company_id=c.id and active;
  if cli.id is null then raise exception 'Invalid company-list item';end if;
  select * into it from public.proc_items where id=cli.item_id and active;
  if it.id is null then raise exception 'Inactive company item';end if;
  enough:=coalesce((x->>'sufficient_stock')::boolean,false);
  if cli.max_stock_review and not enough then raise exception 'Admin must enter maximum stock before ordering this item';end if;
  current_v:=case when enough then null else (x->>'current_stock')::numeric end;
  if not enough and (current_v is null or current_v<0 or current_v::text in ('NaN','Infinity','-Infinity')) then raise exception 'Invalid current stock';end if;
  trigger_v:=coalesce(cli.reorder_level,cli.target_stock*.5);
  suggested:=case when enough then 0 when current_v<=trigger_v then greatest(cli.target_stock-current_v,0) else 0 end;
  insert into public.proc_stock_count_lines(count_id,item_id,current_stock,max_stock_snapshot,reorder_level_snapshot,movement_snapshot,suggested_qty,required_qty,sufficient_stock,note)
  values(count_id_v,it.id,current_v,cli.target_stock,trigger_v,it.movement,suggested,suggested,enough,nullif(x->>'note',''));
 end loop;
 req_count:=private.proc_submit_stock_count_impl(count_id_v);
 ids:=private.proc_company_link_count(c.id,count_id_v);
 if coalesce(cardinality(ids),0)>0 and (c.auto_approve or c.group_auto_approve or exists (
   select 1 from public.proc_requirements req
   cross join lateral private.proc_company_effective_route(c.id,req.item_id) rt(route)
   where req.id=any(ids) and req.company_id=c.id
   and rt.route->>'mode'='direct' and coalesce((rt.route->>'explicit')::boolean,false)
   and coalesce((rt.route->>'auto_send')::boolean,false)
  )) then orders:=private.proc_company_auto_from_count(c.id,count_id_v,ids);end if;
 return jsonb_build_object('count_id',count_id_v,'count_no',count_no_v,'requirements_created',req_count,'purchase_orders',orders,'company_id',c.id);
end $function$

-- Read-only history of all company-list RFQs (automatic and manually prepared).
-- The query binds RFQs to source requirements, so even manually prepared RFQs appear.
CREATE OR REPLACE FUNCTION public.proc_company_rfq_history(p_limit integer DEFAULT 100)
RETURNS TABLE(rfq_id uuid,rfq_no text,company_id uuid,company_name text,rfq_status text,created_at timestamptz,item_count bigint,supplier_count bigint,sent_count bigint,failed_count bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM private.proc_assert_access();
 IF NOT private.proc_has_permission('procurement.rfq.manage') AND NOT private.proc_has_permission('company_lists.view')
 THEN RAISE EXCEPTION 'RFQ history permission required'; END IF;
 RETURN QUERY
 SELECT q.id,q.rfq_no,c.id,c.name,q.status::text,q.created_at,
    count(distinct ri.id),
    (SELECT count(*) FROM public.proc_rfq_suppliers rs WHERE rs.rfq_id=q.id),
    (SELECT count(*) FROM public.proc_company_rfq_queue dq WHERE dq.rfq_id=q.id AND dq.company_id=c.id AND dq.status='accepted'),
    (SELECT count(*) FROM public.proc_company_rfq_queue dq WHERE dq.rfq_id=q.id AND dq.company_id=c.id AND dq.status IN ('failed','unknown','cancelled'))
 FROM public.proc_rfqs q
 JOIN public.proc_rfq_items ri ON ri.rfq_id=q.id
 JOIN public.proc_requirements rr ON rr.id=ri.requirement_id
 JOIN public.proc_companies c ON c.id=rr.company_id AND c.active
 WHERE q.id IS NOT NULL
 GROUP BY q.id,q.rfq_no,q.status,q.created_at,c.id,c.name
 ORDER BY q.created_at DESC LIMIT greatest(1,least(coalesce(p_limit,100),200));
END $$;
REVOKE ALL ON FUNCTION public.proc_company_rfq_history(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.proc_company_rfq_history(integer) TO authenticated;

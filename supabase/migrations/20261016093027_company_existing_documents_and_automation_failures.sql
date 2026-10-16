-- Respect documents across separate requirements for the same stock item/location.
-- Preserve valid physical stock when document automation needs administrator attention.
CREATE OR REPLACE FUNCTION private.proc_company_claim_send(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare q public.proc_company_dispatch_queue;c public.proc_companies;po public.proc_purchase_orders;s public.proc_suppliers;lines jsonb;attachments jsonb;
begin
 perform private.proc_assert_access();
 if not private.proc_has_permission('company_lists.view') then raise exception 'Company list access required';end if;
 select * into q from public.proc_company_dispatch_queue where id=p_id and status in ('pending','failed') for update;
 if q.id is null then return null;end if;
 select * into c from public.proc_companies where id=q.company_id and active;
 select * into po from public.proc_purchase_orders where id=q.po_id and company_id=c.id and quantity_only and status='approved';
 if po.id is null then raise exception 'Company order is not eligible for automatic sending';end if;
 -- A queued image is an approved document, not permission to send stale quantities.
 if exists(select 1 from public.proc_po_lines l join public.proc_requirements r on r.id=l.requirement_id
   where l.po_id=po.id and (l.cancelled_qty>0 or r.required_qty<>r.ordered_qty or r.received_qty>=r.ordered_qty or exists(
    select 1 from public.proc_rfq_items ri join public.proc_rfqs rf on rf.id=ri.rfq_id
    join public.proc_requirements other on other.id=ri.requirement_id
    where other.item_id=r.item_id and other.location_id=r.location_id
    and rf.status in ('draft','prepared','sent','partially_quoted','quoted'))))
 then raise exception 'Stock need or order balance changed. Review this queued PO before sending; no image was sent';end if;
 if exists(select 1 from public.proc_po_lines l cross join lateral private.proc_company_effective_route(c.id,l.item_id) route_info(route) where l.po_id=po.id and (route_info.route->>'mode'<>'direct' or coalesce((route_info.route->>'auto_send')::boolean,false)=false or (route_info.route->'supplier_ids'->>0)::uuid is distinct from po.supplier_id)) then raise exception 'Company order route or recipient has changed; review queued order before sending';end if;
 -- Stock staff can process orders only when admin configured automatic approval.
 if not private.proc_has_permission('company_lists.manage') and not((c.auto_approve or c.group_auto_approve) and private.proc_has_permission('stock.count.enter')) then raise exception 'Admin-approved sending required';end if;
 select * into s from public.proc_suppliers where id=po.supplier_id and active and supplier_kind='company';
 if s.id is null then raise exception 'Company supplier unavailable';end if;
 select jsonb_agg(jsonb_build_object('description',i.description,'brand',i.brand,'size',i.size,'colour',i.colour,'variation',i.variation,'uom',i.uom,'qty',l.qty,'remarks',i.remarks) order by i.description,l.id) into lines from public.proc_po_lines l join public.proc_items i on i.id=l.item_id where l.po_id=po.id;
 select coalesce(jsonb_agg(jsonb_build_object('name',name,'storage_path',storage_path,'mime_type',mime_type,'remarks',remarks,'discount_percent',discount_percent,'discount_amount',discount_amount)),'[]') into attachments from public.proc_company_attachments where company_id=c.id and send_with_order and kind in ('price_list','order') and (po_id is null or po_id=po.id) and (supplier_id is null or supplier_id=s.id) and (item_id is null or exists(select 1 from public.proc_po_lines where po_id=po.id and proc_po_lines.item_id=proc_company_attachments.item_id));
 update public.proc_company_dispatch_queue set status='sending',claimed_by=auth.uid(),last_error=null,updated_at=now() where id=q.id;
 return jsonb_build_object('id',q.id,'po_id',po.id,'po_no',po.po_no,'phone',coalesce(s.whatsapp,s.phone),'supplier',s.name,'company',c.name,'template',po.company_document_template,'lines',lines,'attachments',attachments);
end $function$;


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
   -- Existing orders include other requirements and suppliers for the same item/location.
   -- Explicit manual approval can order a reviewed delta; recount automation cannot.
   if p_auto and (exists(select 1 from private.proc_company_open_orders(r.item_id,r.location_id)) or exists(
    select 1 from public.proc_rfq_items ri join public.proc_rfqs q on q.id=ri.rfq_id
    join public.proc_requirements other on other.id=ri.requirement_id
    where other.item_id=r.item_id and other.location_id=r.location_id and q.status in ('draft','prepared','sent','partially_quoted','quoted')
   )) then continue;end if;
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
end $function$;


CREATE OR REPLACE FUNCTION public.proc_submit_company_list_check_v2(p_company_id uuid, p_lines jsonb, p_notes text DEFAULT NULL::text, p_count_started_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare caller uuid:=auth.uid();c public.proc_companies;loc uuid;count_id_v uuid;count_no_v text;x jsonb;cli public.proc_company_list_items;it public.proc_items;current_v numeric;trigger_v numeric;suggested numeric;enough boolean;req_count integer;ids uuid[];orders jsonb:='[]';errors_v jsonb:='[]';
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
  )) then
  begin
   orders:=private.proc_company_auto_from_count(c.id,count_id_v,ids);
  exception when others then
   -- Document/approval failures must not discard a valid physical stock count.
   errors_v:=jsonb_build_array(jsonb_build_object('stage','direct_po','error',SQLERRM));
  end;
 end if;
 return jsonb_build_object('count_id',count_id_v,'count_no',count_no_v,'requirements_created',req_count,'purchase_orders',orders,'company_id',c.id,'automation_errors',errors_v);
end $function$;

CREATE OR REPLACE FUNCTION public.proc_submit_company_list_check_v3(p_company_id uuid,p_lines jsonb,p_submission_id uuid,p_notes text DEFAULT NULL,p_count_started_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result_v jsonb;cached record;c public.proc_companies;rr record;route_v jsonb;ids uuid[];suppliers uuid[];override_v jsonb;rfq_v jsonb;
 caller uuid:=auth.uid();claims_v text;sub_v text;requests jsonb:='[]';errors_v jsonb:='[]';
BEGIN
 PERFORM private.proc_assert_access();
 IF NOT private.proc_has_permission('stock.count.enter') OR p_submission_id IS NULL THEN RAISE EXCEPTION 'Stock submission permission and submission ID required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('company-submit:'||p_submission_id::text,0));
 -- Serialize separate submissions for this company, not just retries of one token.
 PERFORM 1 FROM public.proc_companies WHERE id=p_company_id FOR UPDATE;
 SELECT * INTO cached FROM private.proc_company_submission_receipts WHERE id=p_submission_id;
 IF FOUND THEN
  IF cached.company_id<>p_company_id OR cached.submitted_by<>caller OR cached.lines IS DISTINCT FROM p_lines THEN RAISE EXCEPTION 'Submission was already saved with different quantities; review stock history before submitting another count';END IF;
  RETURN cached.result;
 END IF;
 result_v:=public.proc_submit_company_list_check_v2(p_company_id,p_lines,p_notes,p_count_started_at);
 errors_v:=coalesce(result_v->'automation_errors','[]'::jsonb);
 SELECT * INTO c FROM public.proc_companies WHERE id=p_company_id FOR UPDATE;
 -- A worker's submitted count, rather than arbitrary older requirements, is the only automation scope.
 FOR rr IN SELECT DISTINCT (private.proc_company_effective_route(c.id,r.item_id)->>'route_id')::uuid route_id
  FROM public.proc_requirements r JOIN public.proc_stock_count_lines l ON l.id=r.source_count_line_id
  WHERE l.count_id=(result_v->>'count_id')::uuid AND r.company_id=c.id
 LOOP
  IF rr.route_id IS NULL THEN CONTINUE;END IF;
  BEGIN
   SELECT jsonb_build_object('mode',route_mode,'auto_send',auto_send,'template',document_template) INTO route_v FROM public.proc_company_section_routes WHERE id=rr.route_id;
   IF route_v->>'mode'<>'rfq' OR NOT coalesce((route_v->>'auto_send')::boolean,false) THEN CONTINUE;END IF;
   IF NOT EXISTS(SELECT 1 FROM public.proc_profiles WHERE id=c.automation_admin_id AND active AND role='admin') THEN RAISE EXCEPTION 'Automation administrator is inactive';END IF;
   SELECT array_agg(r.id ORDER BY r.id) INTO ids FROM public.proc_requirements r JOIN public.proc_stock_count_lines l ON l.id=r.source_count_line_id
    WHERE l.count_id=(result_v->>'count_id')::uuid AND r.company_id=c.id AND r.adjusted_qty>r.ordered_qty AND r.status NOT IN ('closed','cancelled','received')
    AND NOT EXISTS(SELECT 1 FROM private.proc_company_open_orders(r.item_id,r.location_id))
    AND private.proc_company_effective_route(c.id,r.item_id)->>'route_id'=rr.route_id::text
    AND NOT EXISTS(SELECT 1 FROM public.proc_rfq_items ri JOIN public.proc_rfqs q ON q.id=ri.rfq_id JOIN public.proc_requirements other ON other.id=ri.requirement_id WHERE other.item_id=r.item_id AND other.location_id=r.location_id AND q.status IN ('draft','prepared','sent','partially_quoted','quoted'));
   IF coalesce(cardinality(ids),0)=0 THEN CONTINUE;END IF;
   SELECT array_agg(s.supplier_id ORDER BY s.sort_order) INTO suppliers FROM public.proc_company_section_route_suppliers s JOIN public.proc_suppliers p ON p.id=s.supplier_id AND p.active AND p.supplier_kind='company' WHERE s.route_id=rr.route_id;
   IF coalesce(cardinality(suppliers),0)=0 THEN RAISE EXCEPTION 'No active suppliers are configured';END IF;
   claims_v:=current_setting('request.jwt.claims',true);sub_v:=current_setting('request.jwt.claim.sub',true);
   BEGIN
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',c.automation_admin_id,'role','authenticated')::text,true);PERFORM set_config('request.jwt.claim.sub',c.automation_admin_id::text,true);
    IF NOT private.proc_has_permission('procurement.rfq.manage') THEN RAISE EXCEPTION 'Automation administrator no longer has RFQ permission';END IF;
    UPDATE public.proc_requirements SET approval_status='approved',selected_for_order=true,approved_by=c.automation_admin_id,approved_at=now(),updated_at=now() WHERE id=ANY(ids);
    SELECT jsonb_object_agg(id::text,'Administrator opted in to automatic company/category RFQs') INTO override_v FROM unnest(suppliers) t(id);
    rfq_v:=public.proc_create_rfq_v4(ids,suppliers,NULL,'Automatic company stock RFQ',override_v);
    INSERT INTO public.proc_company_rfq_queue(company_id,route_id,count_id,rfq_id,supplier_id,automation_admin_id,document_template)
     SELECT c.id,rr.route_id,(result_v->>'count_id')::uuid,(rfq_v->>'rfq_id')::uuid,id,c.automation_admin_id,coalesce(route_v->'template','{}') FROM unnest(suppliers) t(id) ON CONFLICT(rfq_id,supplier_id) DO NOTHING;
    PERFORM set_config('request.jwt.claims',coalesce(claims_v,''),true);PERFORM set_config('request.jwt.claim.sub',coalesce(sub_v,''),true);
   EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claims',coalesce(claims_v,''),true);PERFORM set_config('request.jwt.claim.sub',coalesce(sub_v,''),true);RAISE;
   END;
   requests:=requests||jsonb_build_array(rfq_v);
  EXCEPTION WHEN OTHERS THEN errors_v:=errors_v||jsonb_build_array(jsonb_build_object('route_id',rr.route_id,'error',SQLERRM));END;
 END LOOP;
 result_v:=result_v||jsonb_build_object('rfqs',requests,'automation_errors',errors_v,'stock_outcomes',private.proc_company_count_outcomes((result_v->>'count_id')::uuid));
 INSERT INTO private.proc_company_submission_receipts(id,company_id,submitted_by,lines,result) VALUES(p_submission_id,c.id,caller,p_lines,result_v);
 RETURN result_v;
END $$;

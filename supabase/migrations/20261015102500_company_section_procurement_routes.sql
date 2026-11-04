-- Group-level purchase routing; additive settings with transactional admin-controlled updates.
-- Existing companies and their procurement settings are not reconfigured.
ALTER TABLE public.proc_companies ADD COLUMN IF NOT EXISTS group_auto_approve boolean NOT NULL DEFAULT false;
CREATE TABLE public.proc_company_section_routes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES public.proc_companies(id) ON DELETE CASCADE,
 section_id uuid NOT NULL REFERENCES public.proc_company_sections(id) ON DELETE CASCADE,
 route_mode text NOT NULL CHECK(route_mode IN ('rfq','direct')),
 auto_send boolean NOT NULL DEFAULT true,
 updated_by uuid REFERENCES public.proc_profiles(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,section_id),
 CHECK(route_mode='direct' OR auto_send=false)
);
CREATE TABLE public.proc_company_section_route_suppliers (
 route_id uuid NOT NULL REFERENCES public.proc_company_section_routes(id) ON DELETE CASCADE,
 supplier_id uuid NOT NULL REFERENCES public.proc_suppliers(id),
 sort_order integer NOT NULL DEFAULT 0,
 PRIMARY KEY(route_id,supplier_id)
);
CREATE INDEX proc_company_route_suppliers_supplier_idx ON public.proc_company_section_route_suppliers(supplier_id);
ALTER TABLE public.proc_company_section_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proc_company_section_route_suppliers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.proc_company_section_routes,public.proc_company_section_route_suppliers FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.proc_company_section_routes,public.proc_company_section_route_suppliers TO authenticated;
CREATE POLICY company_routes_read ON public.proc_company_section_routes FOR SELECT TO authenticated
 USING(private.proc_access_allowed() AND private.proc_has_permission('company_lists.view'));
CREATE POLICY company_route_suppliers_read ON public.proc_company_section_route_suppliers FOR SELECT TO authenticated
 USING(private.proc_access_allowed() AND private.proc_has_permission('company_lists.view'));
-- Mutations are atomic through one admin RPC, not piecemeal browser writes.
CREATE OR REPLACE FUNCTION public.proc_company_save_section_route(
 p_company_id uuid,p_section_id uuid,p_mode text,p_auto_send boolean,p_supplier_ids uuid[]
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE route_v uuid; supplier_v uuid; sorted_ids uuid[];
BEGIN
 PERFORM private.proc_assert_access();
 IF NOT private.proc_is_role(ARRAY['admin']) OR NOT private.proc_has_permission('company_lists.manage') THEN
  RAISE EXCEPTION 'Only company administrators may configure supplier routing';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.proc_company_sections WHERE id=p_section_id AND company_id=p_company_id AND active)
  THEN RAISE EXCEPTION 'Group must belong to this company'; END IF;
 IF p_mode NOT IN ('rfq','direct') OR p_mode IS NULL THEN RAISE EXCEPTION 'Choose RFQ or direct purchase order'; END IF;
 SELECT array_agg(id ORDER BY first_position) INTO sorted_ids FROM (SELECT id,min(position) first_position FROM unnest(p_supplier_ids) WITH ORDINALITY AS ids(id,position) GROUP BY id) picked;
 IF coalesce(cardinality(sorted_ids),0)=0 OR cardinality(sorted_ids)>15 THEN RAISE EXCEPTION 'Select 1–15 suppliers for this group';END IF;
 IF p_mode='direct' AND cardinality(sorted_ids)<>1 THEN RAISE EXCEPTION 'Direct PO requires exactly one supplier';END IF;
 IF EXISTS(SELECT 1 FROM unnest(sorted_ids) chosen(id) WHERE NOT EXISTS(
  SELECT 1 FROM public.proc_suppliers s WHERE s.id=chosen.id AND s.active AND s.supplier_kind='company'
 )) THEN RAISE EXCEPTION 'Select active company supplier contacts only';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('company-group-route:'||p_section_id::text,0));
 INSERT INTO public.proc_company_section_routes(company_id,section_id,route_mode,auto_send,updated_by)
 VALUES(p_company_id,p_section_id,p_mode,case when p_mode='direct' then coalesce(p_auto_send,true) else false end,auth.uid())
 ON CONFLICT(company_id,section_id) DO UPDATE SET route_mode=excluded.route_mode,auto_send=excluded.auto_send,updated_by=auth.uid(),updated_at=now()
 RETURNING id INTO route_v;
 DELETE FROM public.proc_company_section_route_suppliers WHERE route_id=route_v;
 FOR supplier_v IN SELECT unnest(sorted_ids) LOOP
  INSERT INTO public.proc_company_section_route_suppliers(route_id,supplier_id,sort_order)
  VALUES(route_v,supplier_v,array_position(sorted_ids,supplier_v));
 END LOOP;
 -- Saving an auto-send direct group is explicit admin authorization for normal
 -- stock submissions to make approved quantity-only orders. Legacy routes stay unchanged.
 IF p_mode='direct' AND coalesce(p_auto_send,true) THEN
  UPDATE public.proc_companies SET group_auto_approve=true,automation_admin_id=auth.uid(),updated_at=now() WHERE id=p_company_id;
 END IF;
 RETURN jsonb_build_object('id',route_v,'mode',p_mode,'suppliers',cardinality(sorted_ids));
END $$;
REVOKE ALL ON FUNCTION public.proc_company_save_section_route(uuid,uuid,text,boolean,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.proc_company_save_section_route(uuid,uuid,text,boolean,uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.proc_company_clear_section_route(p_company_id uuid,p_section_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM private.proc_assert_access();
 IF NOT private.proc_is_role(ARRAY['admin']) OR NOT private.proc_has_permission('company_lists.manage') THEN
  RAISE EXCEPTION 'Only company administrators may remove group routing'; END IF;
 DELETE FROM public.proc_company_section_routes WHERE company_id=p_company_id AND section_id=p_section_id;
END $$;
REVOKE ALL ON FUNCTION public.proc_company_clear_section_route(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.proc_company_clear_section_route(uuid,uuid) TO authenticated;

-- The nearest configured ancestor wins. Child groups can override parent routes.
-- Existing unconfigured groups retain their company-wide and brand-specific rules.
CREATE OR REPLACE FUNCTION private.proc_company_effective_route(p_company_id uuid,p_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.proc_companies;section_v uuid;route_id_v uuid;route_section_v uuid;
 mode_v text;send_v boolean;suppliers_v uuid[];legacy_supplier uuid;
BEGIN
 SELECT * INTO c FROM public.proc_companies WHERE id=p_company_id AND active;
 IF c.id IS NULL THEN RAISE EXCEPTION 'Company unavailable';END IF;
 SELECT section_id INTO section_v FROM public.proc_company_list_items
 WHERE company_id=p_company_id AND item_id=p_item_id AND active LIMIT 1;
 WITH RECURSIVE trail(id,parent_id,depth) AS(
  SELECT id,parent_id,0 FROM public.proc_company_sections WHERE id=section_v AND company_id=p_company_id AND active
  UNION ALL
  SELECT parent.id,parent.parent_id,trail.depth+1
   FROM public.proc_company_sections parent JOIN trail ON parent.id=trail.parent_id
   WHERE parent.company_id=p_company_id AND parent.active
 )
 SELECT cfg.id,cfg.section_id,cfg.route_mode,cfg.auto_send INTO route_id_v,route_section_v,mode_v,send_v
 FROM trail JOIN public.proc_company_section_routes cfg ON cfg.section_id=trail.id AND cfg.company_id=p_company_id
 ORDER BY trail.depth ASC LIMIT 1;
 IF route_id_v IS NOT NULL THEN
  SELECT array_agg(rs.supplier_id ORDER BY rs.sort_order,rs.supplier_id) INTO suppliers_v
  FROM public.proc_company_section_route_suppliers rs JOIN public.proc_suppliers s ON s.id=rs.supplier_id
  WHERE rs.route_id=route_id_v AND s.active AND s.supplier_kind='company';
  RETURN jsonb_build_object('mode',mode_v,'auto_send',send_v,'supplier_ids',coalesce(to_jsonb(suppliers_v),'[]'::jsonb),
   'route_section_id',route_section_v,'explicit',true);
 END IF;
 SELECT coalesce((SELECT cc.supplier_id FROM public.proc_company_contacts cc JOIN public.proc_items i ON i.id=p_item_id
  WHERE cc.company_id=p_company_id AND cc.brand=coalesce(i.brand,'') LIMIT 1),c.default_supplier_id) INTO legacy_supplier;
 IF legacy_supplier IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.proc_suppliers
  WHERE id=legacy_supplier AND active AND supplier_kind='company') THEN legacy_supplier:=NULL;END IF;
 RETURN jsonb_build_object('mode',c.order_route,'auto_send',c.auto_send,
  'supplier_ids',CASE WHEN legacy_supplier IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(legacy_supplier) END,
  'route_section_id',NULL,'explicit',false);
END $$;
REVOKE ALL ON FUNCTION private.proc_company_effective_route(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.proc_company_direct_orders(p_company_id uuid,p_requirement_ids uuid[],p_auto boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.proc_companies;r record;po_v jsonb;po_id_v uuid;po_no_v text;qty_v numeric;claims_v text;sub_v text;actor uuid;result jsonb:='[]';route_v jsonb;supplier_v uuid;send_v boolean;
begin
 perform private.proc_assert_access();
 select * into c from public.proc_companies where id=p_company_id and active for update;
 if c.id is null then return result;end if;
 if p_auto then
  if not (c.auto_approve or c.group_auto_approve) or not private.proc_has_permission('stock.count.enter') then raise exception 'Automatic company approval is not enabled';end if;
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
   select (value->>'id')::uuid into po_id_v from jsonb_array_elements(result) where value->>'supplier_id'=supplier_v::text and (value->>'auto_send')::boolean=send_v;
   if po_id_v is null then
    insert into public.proc_purchase_orders(po_no,supplier_id,status,created_by,company_id,quantity_only,notes,terms)
    values('COMPANY-'||gen_random_uuid(),supplier_v,'pending_approval',actor,c.id,true,'Company quantity-only order. Price not requested.','Quantity only; supplier to confirm availability and delivery.') returning id,po_no into po_id_v,po_no_v;
    result:=result||jsonb_build_array(jsonb_build_object('id',po_id_v,'po_no',po_no_v,'supplier_id',supplier_v,'auto_send',send_v));
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
end $$;

CREATE OR REPLACE FUNCTION public.proc_submit_company_list_check_v2(p_company_id uuid,p_lines jsonb,p_notes text default null,p_count_started_at timestamptz default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
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
 if (c.auto_approve or c.group_auto_approve) and coalesce(cardinality(ids),0)>0 then orders:=private.proc_company_auto_from_count(c.id,count_id_v,ids);end if;
 return jsonb_build_object('count_id',count_id_v,'count_no',count_no_v,'requirements_created',req_count,'purchase_orders',orders,'company_id',c.id);
end $$;

CREATE OR REPLACE FUNCTION private.proc_company_claim_send(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.proc_company_dispatch_queue;c public.proc_companies;po public.proc_purchase_orders;s public.proc_suppliers;lines jsonb;attachments jsonb;
begin
 perform private.proc_assert_access();
 if not private.proc_has_permission('company_lists.view') then raise exception 'Company list access required';end if;
 select * into q from public.proc_company_dispatch_queue where id=p_id and status in ('pending','failed') for update;
 if q.id is null then return null;end if;
 select * into c from public.proc_companies where id=q.company_id and active;
 select * into po from public.proc_purchase_orders where id=q.po_id and company_id=c.id and quantity_only and status='approved';
 if po.id is null then raise exception 'Company order is not eligible for automatic sending';end if;
 if exists(select 1 from public.proc_po_lines l cross join lateral private.proc_company_effective_route(c.id,l.item_id) route_info(route) where l.po_id=po.id and (route_info.route->>'mode'<>'direct' or coalesce((route_info.route->>'auto_send')::boolean,false)=false or (route_info.route->'supplier_ids'->>0)::uuid is distinct from po.supplier_id)) then raise exception 'Company order route or recipient has changed; review queued order before sending';end if;
 -- Stock staff can process orders only when admin configured automatic approval.
 if not private.proc_has_permission('company_lists.manage') and not((c.auto_approve or c.group_auto_approve) and private.proc_has_permission('stock.count.enter')) then raise exception 'Admin-approved sending required';end if;
 select * into s from public.proc_suppliers where id=po.supplier_id and active and supplier_kind='company';
 if s.id is null then raise exception 'Company supplier unavailable';end if;
 select jsonb_agg(jsonb_build_object('description',i.description,'brand',i.brand,'size',i.size,'colour',i.colour,'variation',i.variation,'uom',i.uom,'qty',l.qty,'remarks',i.remarks) order by i.description,l.id) into lines from public.proc_po_lines l join public.proc_items i on i.id=l.item_id where l.po_id=po.id;
 select coalesce(jsonb_agg(jsonb_build_object('name',name,'storage_path',storage_path,'mime_type',mime_type,'remarks',remarks,'discount_percent',discount_percent,'discount_amount',discount_amount)),'[]') into attachments from public.proc_company_attachments where company_id=c.id and send_with_order and kind in ('price_list','order') and (po_id is null or po_id=po.id) and (supplier_id is null or supplier_id=s.id) and (item_id is null or exists(select 1 from public.proc_po_lines where po_id=po.id and proc_po_lines.item_id=proc_company_attachments.item_id));
 update public.proc_company_dispatch_queue set status='sending',claimed_by=auth.uid(),last_error=null,updated_at=now() where id=q.id;
 return jsonb_build_object('id',q.id,'po_id',po.id,'po_no',po.po_no,'phone',coalesce(s.whatsapp,s.phone),'supplier',s.name,'company',c.name,'lines',lines,'attachments',attachments);
end $$;

-- Direct route lookup is used by both automatic stock submissions and manual approvals.
CREATE OR REPLACE FUNCTION public.proc_company_direct_candidate_ids(p_company_id uuid,p_ids uuid[])
RETURNS uuid[] LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE found_ids uuid[];
BEGIN
 PERFORM private.proc_assert_access();
 IF NOT private.proc_has_permission('procurement.requirements.view') AND NOT private.proc_has_permission('company_lists.manage')
  THEN RAISE EXCEPTION 'Procurement access required';END IF;
 SELECT array_agg(r.id) INTO found_ids
 FROM public.proc_requirements r WHERE r.company_id=p_company_id AND r.id=ANY(p_ids)
 AND private.proc_company_effective_route(p_company_id,r.item_id)->>'mode'='direct'
 AND jsonb_array_length(private.proc_company_effective_route(p_company_id,r.item_id)->'supplier_ids')=1;
 RETURN coalesce(found_ids,ARRAY[]::uuid[]);
END $$;
REVOKE ALL ON FUNCTION public.proc_company_direct_candidate_ids(uuid,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.proc_company_direct_candidate_ids(uuid,uuid[]) TO authenticated;

-- Admin can prepare a group RFQ for approved shortages; existing RFQ screen
-- handles the actual transmission and subsequent quotation/award flow.
CREATE OR REPLACE FUNCTION public.proc_company_prepare_group_rfq(p_company_id uuid,p_section_id uuid,p_due_date date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ids uuid[];suppliers uuid[];override_v jsonb;result_v jsonb;
BEGIN
 PERFORM private.proc_assert_access();
 IF NOT private.proc_is_role(ARRAY['admin']) OR NOT private.proc_has_permission('procurement.rfq.manage') THEN
  RAISE EXCEPTION 'Admin RFQ permission required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.proc_company_section_routes WHERE company_id=p_company_id AND section_id=p_section_id AND route_mode='rfq')
 THEN RAISE EXCEPTION 'This group is not configured for RFQs';END IF;
 SELECT array_agg(s.supplier_id ORDER BY s.sort_order) INTO suppliers FROM public.proc_company_section_route_suppliers s
 JOIN public.proc_company_section_routes cfg ON cfg.id=s.route_id
 JOIN public.proc_suppliers supplier ON supplier.id=s.supplier_id
 WHERE cfg.company_id=p_company_id AND cfg.section_id=p_section_id AND supplier.active;
 IF coalesce(cardinality(suppliers),0)=0 THEN RAISE EXCEPTION 'Select a supplier before preparing the RFQ';END IF;
 SELECT array_agg(x.id) INTO ids FROM (
  SELECT r.id FROM public.proc_requirements r WHERE r.company_id=p_company_id
  AND r.approval_status='approved' AND r.status NOT IN ('closed','cancelled','received')
  AND r.adjusted_qty>r.ordered_qty
  AND private.proc_company_effective_route(p_company_id,r.item_id)->>'route_section_id'=p_section_id::text
  AND NOT EXISTS(SELECT 1 FROM public.proc_rfq_items ri JOIN public.proc_rfqs q ON q.id=ri.rfq_id
   WHERE ri.requirement_id=r.id AND q.status IN ('draft','prepared','sent','partially_quoted','quoted'))
 ) x;
 IF coalesce(cardinality(ids),0)=0 THEN RAISE EXCEPTION 'No approved unquoted shortages remain for this group';END IF;
 UPDATE public.proc_requirements SET selected_for_order=true,updated_at=now() WHERE id=ANY(ids);
 SELECT jsonb_object_agg(id::text,'Supplier explicitly approved for company group') INTO override_v FROM unnest(suppliers) t(id);
 result_v:=public.proc_create_rfq_v4(ids,suppliers,p_due_date,'Company group RFQ',override_v);
 RETURN result_v;
END $$;
REVOKE ALL ON FUNCTION public.proc_company_prepare_group_rfq(uuid,uuid,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.proc_company_prepare_group_rfq(uuid,uuid,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.proc_company_prepare_group_po(p_company_id uuid,p_section_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ids uuid[];result_v jsonb;
BEGIN
 PERFORM private.proc_assert_access();
 IF NOT private.proc_is_role(ARRAY['admin']) OR NOT private.proc_has_permission('procurement.orders.approve')
 THEN RAISE EXCEPTION 'Admin purchase-order approval required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.proc_company_section_routes WHERE company_id=p_company_id AND section_id=p_section_id AND route_mode='direct')
 THEN RAISE EXCEPTION 'This group is not configured for direct POs';END IF;
 SELECT array_agg(r.id) INTO ids FROM public.proc_requirements r WHERE r.company_id=p_company_id
  AND r.approval_status='approved' AND r.adjusted_qty>r.ordered_qty AND r.status NOT IN ('closed','cancelled','received')
  AND private.proc_company_effective_route(p_company_id,r.item_id)->>'route_section_id'=p_section_id::text;
 IF coalesce(cardinality(ids),0)=0 THEN RAISE EXCEPTION 'No approved un-ordered shortages remain for this group';END IF;
 result_v:=private.proc_company_manual_orders(p_company_id,ids);
 RETURN result_v;
END $$;
REVOKE ALL ON FUNCTION public.proc_company_prepare_group_po(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.proc_company_prepare_group_po(uuid,uuid) TO authenticated;

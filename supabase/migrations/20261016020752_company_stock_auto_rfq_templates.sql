-- Explicit company/category opt-in, persisted outgoing templates, and stock-scoped RFQ jobs.
ALTER TABLE public.proc_company_section_routes ALTER COLUMN section_id DROP NOT NULL;
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.proc_company_section_routes'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%auto_send%' LOOP
  EXECUTE format('ALTER TABLE public.proc_company_section_routes DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
CREATE UNIQUE INDEX proc_company_default_route_unique ON public.proc_company_section_routes(company_id) WHERE section_id IS NULL;
ALTER TABLE public.proc_company_section_routes ADD COLUMN document_template jsonb NOT NULL DEFAULT '{}';
ALTER TABLE public.proc_purchase_orders ADD COLUMN company_document_template jsonb NOT NULL DEFAULT '{}';
CREATE TABLE public.proc_company_rfq_queue (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES public.proc_companies(id) ON DELETE CASCADE,
 route_id uuid REFERENCES public.proc_company_section_routes(id) ON DELETE SET NULL,
 count_id uuid NOT NULL REFERENCES public.proc_stock_counts(id) ON DELETE CASCADE, rfq_id uuid NOT NULL REFERENCES public.proc_rfqs(id) ON DELETE CASCADE,
 supplier_id uuid NOT NULL REFERENCES public.proc_suppliers(id), automation_admin_id uuid NOT NULL REFERENCES public.proc_profiles(id),
 document_template jsonb NOT NULL DEFAULT '{}',
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','accepted','failed','unknown','cancelled')),
 claimed_by uuid REFERENCES public.proc_profiles(id), dispatch_id uuid, message_id text,last_error text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(rfq_id,supplier_id)
);
CREATE INDEX proc_company_rfq_queue_company_status ON public.proc_company_rfq_queue(company_id,status,created_at);
CREATE INDEX proc_company_rfq_queue_route ON public.proc_company_rfq_queue(route_id);
CREATE INDEX proc_company_rfq_queue_count ON public.proc_company_rfq_queue(count_id);
CREATE INDEX proc_company_rfq_queue_supplier ON public.proc_company_rfq_queue(supplier_id);
CREATE INDEX proc_company_rfq_queue_admin ON public.proc_company_rfq_queue(automation_admin_id);
CREATE INDEX proc_company_rfq_queue_caller ON public.proc_company_rfq_queue(claimed_by);
ALTER TABLE public.proc_company_rfq_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.proc_company_rfq_queue FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.proc_company_rfq_queue TO authenticated;
CREATE POLICY company_rfq_queue_read ON public.proc_company_rfq_queue FOR SELECT TO authenticated
 USING(private.proc_access_allowed() AND private.proc_has_permission('company_lists.view'));
CREATE TABLE private.proc_company_submission_receipts (
 id uuid PRIMARY KEY,company_id uuid NOT NULL, submitted_by uuid NOT NULL,lines jsonb NOT NULL,result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON private.proc_company_submission_receipts FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.proc_company_save_route_v2(p_company_id uuid,p_section_id uuid,p_mode text,p_auto_send boolean,p_supplier_ids uuid[],p_template jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE route_v uuid;ids uuid[];supplier_v uuid;
BEGIN
 PERFORM private.proc_assert_access();
 IF NOT private.proc_is_role(ARRAY['admin']) OR NOT private.proc_has_permission('company_lists.manage') THEN RAISE EXCEPTION 'Company administrator required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.proc_companies WHERE id=p_company_id AND active) THEN RAISE EXCEPTION 'Company unavailable';END IF;
 IF p_section_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.proc_company_sections WHERE id=p_section_id AND company_id=p_company_id AND active) THEN RAISE EXCEPTION 'Category must belong to this company';END IF;
 IF p_mode IS NULL OR p_mode NOT IN ('direct','rfq') THEN RAISE EXCEPTION 'Choose RFQ or PO';END IF;
 IF coalesce(p_auto_send,false) AND NOT private.proc_has_permission(CASE WHEN p_mode='rfq' THEN 'procurement.rfq.manage' ELSE 'procurement.orders.approve' END) THEN RAISE EXCEPTION 'Document approval permission required for automation';END IF;
 SELECT array_agg(id ORDER BY position) INTO ids FROM (SELECT id,min(n) position FROM unnest(p_supplier_ids) WITH ORDINALITY AS t(id,n) GROUP BY id) x;
 IF coalesce(cardinality(ids),0) NOT BETWEEN 1 AND 15 OR (p_mode='direct' AND cardinality(ids)<>1) THEN RAISE EXCEPTION 'Choose one supplier for PO or 1–15 for RFQ';END IF;
 IF EXISTS(SELECT 1 FROM unnest(ids) x(id) WHERE NOT EXISTS(SELECT 1 FROM public.proc_suppliers WHERE proc_suppliers.id=x.id AND active AND supplier_kind='company' AND (NOT coalesce(p_auto_send,false) OR coalesce(nullif(whatsapp,''),phone) ~ '^\+94[0-9]{9}$'))) THEN RAISE EXCEPTION 'Select active company suppliers with valid +94 WhatsApp numbers for automatic sending';END IF;
 IF p_template IS NULL OR jsonb_typeof(p_template)<>'object' OR octet_length(p_template::text)>6000 OR length(coalesce(p_template->>'name',''))>80 OR length(coalesce(p_template->>'title',''))>60 OR length(coalesce(p_template->>'note',''))>300 OR length(coalesce(p_template->>'caption',''))>2000 THEN RAISE EXCEPTION 'Invalid document template';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('company-group-route:'||p_company_id::text||coalesce(p_section_id::text,''),0));
 SELECT id INTO route_v FROM public.proc_company_section_routes WHERE company_id=p_company_id AND section_id IS NOT DISTINCT FROM p_section_id FOR UPDATE;
 IF route_v IS NULL THEN
  INSERT INTO public.proc_company_section_routes(company_id,section_id,route_mode,auto_send,document_template,updated_by) VALUES(p_company_id,p_section_id,p_mode,coalesce(p_auto_send,false),p_template,auth.uid()) RETURNING id INTO route_v;
 ELSE UPDATE public.proc_company_section_routes SET route_mode=p_mode,auto_send=coalesce(p_auto_send,false),document_template=p_template,updated_by=auth.uid(),updated_at=now() WHERE id=route_v;END IF;
 DELETE FROM public.proc_company_section_route_suppliers WHERE route_id=route_v;
 FOREACH supplier_v IN ARRAY ids LOOP INSERT INTO public.proc_company_section_route_suppliers(route_id,supplier_id,sort_order) VALUES(route_v,supplier_v,array_position(ids,supplier_v));END LOOP;
 IF coalesce(p_auto_send,false) THEN UPDATE public.proc_companies SET group_auto_approve=true,automation_admin_id=auth.uid(),updated_at=now() WHERE id=p_company_id;END IF;
 RETURN jsonb_build_object('id',route_v);
END $$;
REVOKE ALL ON FUNCTION public.proc_company_save_route_v2(uuid,uuid,text,boolean,uuid[],jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.proc_company_save_route_v2(uuid,uuid,text,boolean,uuid[],jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION private.proc_company_effective_route(p_company_id uuid,p_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.proc_companies;section_v uuid;route_id_v uuid;route_section_v uuid;
 mode_v text;send_v boolean;suppliers_v uuid[];legacy_supplier uuid;template_v jsonb;
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
 IF route_id_v IS NULL THEN SELECT id,section_id,route_mode,auto_send INTO route_id_v,route_section_v,mode_v,send_v FROM public.proc_company_section_routes WHERE company_id=p_company_id AND section_id IS NULL;END IF;
 IF route_id_v IS NOT NULL THEN
  SELECT document_template INTO template_v FROM public.proc_company_section_routes WHERE id=route_id_v;
  SELECT array_agg(rs.supplier_id ORDER BY rs.sort_order,rs.supplier_id) INTO suppliers_v
  FROM public.proc_company_section_route_suppliers rs JOIN public.proc_suppliers s ON s.id=rs.supplier_id
  WHERE rs.route_id=route_id_v AND s.active AND s.supplier_kind='company';
  RETURN jsonb_build_object('mode',mode_v,'auto_send',send_v,'supplier_ids',coalesce(to_jsonb(suppliers_v),'[]'::jsonb),
   'route_id',route_id_v,'template',template_v,'route_section_id',route_section_v,'explicit',true);
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
 return jsonb_build_object('id',q.id,'po_id',po.id,'po_no',po.po_no,'phone',coalesce(s.whatsapp,s.phone),'supplier',s.name,'company',c.name,'template',po.company_document_template,'lines',lines,'attachments',attachments);
end $$;

-- Direct route lookup is used by both automatic stock submissions and manual approvals.
CREATE OR REPLACE FUNCTION public.proc_company_clear_section_route(p_company_id uuid,p_section_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM private.proc_assert_access();
 IF NOT private.proc_is_role(ARRAY['admin']) OR NOT private.proc_has_permission('company_lists.manage') THEN
  RAISE EXCEPTION 'Only company administrators may remove group routing'; END IF;
 DELETE FROM public.proc_company_section_routes WHERE company_id=p_company_id AND section_id IS NOT DISTINCT FROM p_section_id;
END $$;
REVOKE ALL ON FUNCTION public.proc_company_clear_section_route(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.proc_company_clear_section_route(uuid,uuid) TO authenticated;

CREATE FUNCTION public.proc_submit_company_list_check_v3(p_company_id uuid,p_lines jsonb,p_submission_id uuid,p_notes text DEFAULT NULL,p_count_started_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result_v jsonb;cached record;c public.proc_companies;rr record;route_v jsonb;ids uuid[];suppliers uuid[];override_v jsonb;rfq_v jsonb;
 caller uuid:=auth.uid();claims_v text;sub_v text;requests jsonb:='[]';errors_v jsonb:='[]';
BEGIN
 PERFORM private.proc_assert_access();
 IF NOT private.proc_has_permission('stock.count.enter') OR p_submission_id IS NULL THEN RAISE EXCEPTION 'Stock submission permission and submission ID required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('company-submit:'||p_submission_id::text,0));
 SELECT * INTO cached FROM private.proc_company_submission_receipts WHERE id=p_submission_id;
 IF FOUND THEN
  IF cached.company_id<>p_company_id OR cached.submitted_by<>caller OR cached.lines IS DISTINCT FROM p_lines THEN RAISE EXCEPTION 'Submission was already saved with different quantities; review stock history before submitting another count';END IF;
  RETURN cached.result;
 END IF;
 result_v:=public.proc_submit_company_list_check_v2(p_company_id,p_lines,p_notes,p_count_started_at);
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
    AND private.proc_company_effective_route(c.id,r.item_id)->>'route_id'=rr.route_id::text
    AND NOT EXISTS(SELECT 1 FROM public.proc_rfq_items ri JOIN public.proc_rfqs q ON q.id=ri.rfq_id WHERE ri.requirement_id=r.id AND q.status IN ('draft','prepared','sent','partially_quoted','quoted'));
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
 result_v:=result_v||jsonb_build_object('rfqs',requests,'automation_errors',errors_v);
 INSERT INTO private.proc_company_submission_receipts(id,company_id,submitted_by,lines,result) VALUES(p_submission_id,c.id,caller,p_lines,result_v);
 RETURN result_v;
END $$;
REVOKE ALL ON FUNCTION public.proc_submit_company_list_check_v3(uuid,jsonb,uuid,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.proc_submit_company_list_check_v3(uuid,jsonb,uuid,text,timestamptz) TO authenticated;

CREATE FUNCTION public.proc_company_claim_rfq_send(p_id uuid,p_session text,p_image_sha256 text,p_caption text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q public.proc_company_rfq_queue;s public.proc_suppliers;f public.proc_rfqs;lines_v jsonb;actor uuid:=auth.uid();claims_v text;sub_v text;dispatch_v uuid;
BEGIN
 PERFORM private.proc_assert_access();
 IF NOT private.proc_has_permission('company_lists.view') OR NOT(private.proc_has_permission('stock.count.enter') OR private.proc_has_permission('company_lists.manage')) THEN RAISE EXCEPTION 'Company dispatch permission required';END IF;
 SELECT * INTO q FROM public.proc_company_rfq_queue WHERE id=p_id AND status IN ('pending','failed') FOR UPDATE;
 IF q.id IS NULL THEN RETURN NULL;END IF;
 IF EXISTS(SELECT 1 FROM public.proc_whatsapp_rfq_dispatches WHERE rfq_id=q.rfq_id AND supplier_id=q.supplier_id) THEN
  UPDATE public.proc_company_rfq_queue SET status='cancelled',last_error='An existing RFQ dispatch attempt must be reviewed. No duplicate sent.',updated_at=now() WHERE id=q.id;RETURN NULL;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.proc_profiles WHERE id=q.automation_admin_id AND active AND role='admin') THEN RAISE EXCEPTION 'Automation administrator inactive';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.proc_company_section_routes cfg JOIN public.proc_company_section_route_suppliers rs ON rs.route_id=cfg.id WHERE cfg.id=q.route_id AND cfg.auto_send AND cfg.route_mode='rfq' AND rs.supplier_id=q.supplier_id) THEN RAISE EXCEPTION 'Route or supplier changed; review unsent RFQ';END IF;
 IF EXISTS(SELECT 1 FROM public.proc_rfq_items ri JOIN public.proc_requirements r ON r.id=ri.requirement_id WHERE ri.rfq_id=q.rfq_id AND (r.status IN ('closed','cancelled','received') OR ri.requested_qty IS DISTINCT FROM greatest(r.adjusted_qty-r.ordered_qty,0))) THEN RAISE EXCEPTION 'Stock requirements have changed; review RFQ quantities before sending';END IF;
 -- Re-resolve each item to block a newly added child override from using an old queued route.
 IF EXISTS(SELECT 1 FROM public.proc_rfq_items ri JOIN public.proc_requirements r ON r.id=ri.requirement_id WHERE ri.rfq_id=q.rfq_id AND private.proc_company_effective_route(q.company_id,r.item_id)->>'route_id' IS DISTINCT FROM q.route_id::text) THEN RAISE EXCEPTION 'RFQ category scope has changed';END IF;
 SELECT * INTO s FROM public.proc_suppliers WHERE id=q.supplier_id AND active AND supplier_kind='company';
 SELECT * INTO f FROM public.proc_rfqs WHERE id=q.rfq_id AND status NOT IN ('closed','cancelled','awarded');
 IF s.id IS NULL OR f.id IS NULL THEN RAISE EXCEPTION 'Supplier or RFQ no longer available';END IF;
 claims_v:=current_setting('request.jwt.claims',true);sub_v:=current_setting('request.jwt.claim.sub',true);
 BEGIN
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',q.automation_admin_id,'role','authenticated')::text,true);PERFORM set_config('request.jwt.claim.sub',q.automation_admin_id::text,true);
  dispatch_v:=public.proc_whatsapp_claim_dispatch(q.rfq_id,q.supplier_id,p_session,p_image_sha256,p_caption);
  PERFORM set_config('request.jwt.claims',coalesce(claims_v,''),true);PERFORM set_config('request.jwt.claim.sub',coalesce(sub_v,''),true);
 EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claims',coalesce(claims_v,''),true);PERFORM set_config('request.jwt.claim.sub',coalesce(sub_v,''),true);RAISE;
 END;
 UPDATE public.proc_company_rfq_queue SET status='sending',claimed_by=actor,dispatch_id=dispatch_v,last_error=NULL,updated_at=now() WHERE id=q.id;
 RETURN jsonb_build_object('id',q.id,'phone',coalesce(nullif(s.whatsapp,''),s.phone));
END $$;
REVOKE ALL ON FUNCTION public.proc_company_claim_rfq_send(uuid,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.proc_company_claim_rfq_send(uuid,text,text,text) TO authenticated;

-- Read only jobs visible to the current company operator, before claiming/network I/O.
CREATE FUNCTION public.proc_company_rfq_job(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q public.proc_company_rfq_queue;result_v jsonb;
BEGIN
 PERFORM private.proc_assert_access();
 IF NOT private.proc_has_permission('company_lists.view') OR NOT(private.proc_has_permission('stock.count.enter') OR private.proc_has_permission('company_lists.manage')) THEN RAISE EXCEPTION 'Company dispatch permission required';END IF;
 SELECT * INTO q FROM public.proc_company_rfq_queue WHERE id=p_id AND status IN ('pending','failed');IF q.id IS NULL THEN RETURN NULL;END IF;
 SELECT jsonb_build_object('id',q.id,'kind','rfq','rfq_no',f.rfq_no,'po_no',f.rfq_no,'company',c.name,'supplier',s.name,'template',q.document_template,'lines',jsonb_agg(jsonb_build_object('description',i.description,'brand',i.brand,'size',i.size,'colour',i.colour,'variation',i.variation,'uom',i.uom,'qty',ri.requested_qty,'remarks',i.remarks) ORDER BY ri.id)) INTO result_v
 FROM public.proc_rfqs f JOIN public.proc_companies c ON c.id=q.company_id JOIN public.proc_suppliers s ON s.id=q.supplier_id
 JOIN public.proc_rfq_items ri ON ri.rfq_id=f.id JOIN public.proc_requirements r ON r.id=ri.requirement_id JOIN public.proc_items i ON i.id=r.item_id
 WHERE f.id=q.rfq_id GROUP BY f.rfq_no,c.name,s.name;
 RETURN result_v;
END $$;
REVOKE ALL ON FUNCTION public.proc_company_rfq_job(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.proc_company_rfq_job(uuid) TO authenticated;
CREATE FUNCTION public.proc_company_finish_rfq_send(p_id uuid,p_status text,p_message_id text,p_error text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q public.proc_company_rfq_queue;claims_v text;sub_v text;
BEGIN
 PERFORM private.proc_assert_access();
 IF p_status NOT IN ('accepted','failed','unknown') THEN RAISE EXCEPTION 'Invalid dispatch status';END IF;
 SELECT * INTO q FROM public.proc_company_rfq_queue WHERE id=p_id AND status='sending' AND claimed_by=auth.uid() FOR UPDATE;
 IF q.id IS NULL THEN RAISE EXCEPTION 'Dispatch is not owned by this operator';END IF;
 UPDATE public.proc_company_rfq_queue SET status=p_status,message_id=left(p_message_id,500),last_error=left(p_error,1000),updated_at=now() WHERE id=q.id;
 UPDATE public.proc_whatsapp_rfq_dispatches SET status=p_status,message_id=left(p_message_id,500),last_error=left(p_error,1000),updated_at=now() WHERE id=q.dispatch_id;
 IF p_status='accepted' THEN
  IF NOT EXISTS(SELECT 1 FROM public.proc_profiles WHERE id=q.automation_admin_id AND active AND role='admin') THEN RAISE EXCEPTION 'Automation administrator inactive; inspect accepted send before updating RFQ';END IF;
  claims_v:=current_setting('request.jwt.claims',true);sub_v:=current_setting('request.jwt.claim.sub',true);
  BEGIN
   PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',q.automation_admin_id,'role','authenticated')::text,true);PERFORM set_config('request.jwt.claim.sub',q.automation_admin_id::text,true);
   IF NOT private.proc_has_permission('procurement.rfq.manage') THEN RAISE EXCEPTION 'Automation RFQ permission has been removed';END IF;
  UPDATE public.proc_rfq_suppliers SET status='sent',sent_at=now(),sent_by=q.automation_admin_id WHERE rfq_id=q.rfq_id AND supplier_id=q.supplier_id AND status IN ('pending','prepared');
  UPDATE public.proc_rfqs SET status='sent',updated_at=now() WHERE id=q.rfq_id AND status IN ('draft','prepared') AND NOT EXISTS(SELECT 1 FROM public.proc_rfq_suppliers WHERE rfq_id=q.rfq_id AND status IN ('pending','prepared'));
   PERFORM set_config('request.jwt.claims',coalesce(claims_v,''),true);PERFORM set_config('request.jwt.claim.sub',coalesce(sub_v,''),true);
  EXCEPTION WHEN OTHERS THEN
   PERFORM set_config('request.jwt.claims',coalesce(claims_v,''),true);PERFORM set_config('request.jwt.claim.sub',coalesce(sub_v,''),true);RAISE;
  END;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.proc_company_finish_rfq_send(uuid,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.proc_company_finish_rfq_send(uuid,text,text,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.proc_company_prepare_route_rfq(p_company_id uuid,p_section_id uuid,p_due_date date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ids uuid[];suppliers uuid[];override_v jsonb;result_v jsonb;
BEGIN
 PERFORM private.proc_assert_access();
 IF NOT private.proc_is_role(ARRAY['admin']) OR NOT private.proc_has_permission('procurement.rfq.manage') THEN
  RAISE EXCEPTION 'Admin RFQ permission required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.proc_company_section_routes WHERE company_id=p_company_id AND section_id IS NOT DISTINCT FROM p_section_id AND route_mode='rfq')
 THEN RAISE EXCEPTION 'This group is not configured for RFQs';END IF;
 SELECT array_agg(s.supplier_id ORDER BY s.sort_order) INTO suppliers FROM public.proc_company_section_route_suppliers s
 JOIN public.proc_company_section_routes cfg ON cfg.id=s.route_id
 JOIN public.proc_suppliers supplier ON supplier.id=s.supplier_id
 WHERE cfg.company_id=p_company_id AND cfg.section_id IS NOT DISTINCT FROM p_section_id AND supplier.active;
 IF coalesce(cardinality(suppliers),0)=0 THEN RAISE EXCEPTION 'Select a supplier before preparing the RFQ';END IF;
 SELECT array_agg(x.id) INTO ids FROM (
  SELECT r.id FROM public.proc_requirements r WHERE r.company_id=p_company_id
  AND r.approval_status='approved' AND r.status NOT IN ('closed','cancelled','received')
  AND r.adjusted_qty>r.ordered_qty
  AND private.proc_company_effective_route(p_company_id,r.item_id)->>'route_section_id' IS NOT DISTINCT FROM p_section_id::text
  AND NOT EXISTS(SELECT 1 FROM public.proc_rfq_items ri JOIN public.proc_rfqs q ON q.id=ri.rfq_id
   WHERE ri.requirement_id=r.id AND q.status IN ('draft','prepared','sent','partially_quoted','quoted'))
 ) x;
 IF coalesce(cardinality(ids),0)=0 THEN RAISE EXCEPTION 'No approved unquoted shortages remain for this group';END IF;
 UPDATE public.proc_requirements SET selected_for_order=true,updated_at=now() WHERE id=ANY(ids);
 SELECT jsonb_object_agg(id::text,'Supplier explicitly approved for company group') INTO override_v FROM unnest(suppliers) t(id);
 result_v:=public.proc_create_rfq_v4(ids,suppliers,p_due_date,'Company group RFQ',override_v);
 RETURN result_v||jsonb_build_object('document_template',(SELECT document_template FROM public.proc_company_section_routes WHERE company_id=p_company_id AND section_id IS NOT DISTINCT FROM p_section_id));
END $$;
REVOKE ALL ON FUNCTION public.proc_company_prepare_route_rfq(uuid,uuid,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.proc_company_prepare_route_rfq(uuid,uuid,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.proc_company_prepare_route_po(p_company_id uuid,p_section_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ids uuid[];result_v jsonb;
BEGIN
 PERFORM private.proc_assert_access();
 IF NOT private.proc_is_role(ARRAY['admin']) OR NOT private.proc_has_permission('procurement.orders.approve')
 THEN RAISE EXCEPTION 'Admin purchase-order approval required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.proc_company_section_routes WHERE company_id=p_company_id AND section_id IS NOT DISTINCT FROM p_section_id AND route_mode='direct')
 THEN RAISE EXCEPTION 'This group is not configured for direct POs';END IF;
 SELECT array_agg(r.id) INTO ids FROM public.proc_requirements r WHERE r.company_id=p_company_id
  AND r.approval_status='approved' AND r.adjusted_qty>r.ordered_qty AND r.status NOT IN ('closed','cancelled','received')
  AND private.proc_company_effective_route(p_company_id,r.item_id)->>'route_section_id' IS NOT DISTINCT FROM p_section_id::text;
 IF coalesce(cardinality(ids),0)=0 THEN RAISE EXCEPTION 'No approved un-ordered shortages remain for this group';END IF;
 result_v:=private.proc_company_manual_orders(p_company_id,ids);
 RETURN result_v;
END $$;
REVOKE ALL ON FUNCTION public.proc_company_prepare_route_po(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.proc_company_prepare_route_po(uuid,uuid) TO authenticated;

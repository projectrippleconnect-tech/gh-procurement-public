-- Disposable only: use actual route/automation functions with small stock/RFQ fixtures.
\ir company-group-routing-isolated.sql
ALTER TABLE public.proc_requirements ADD COLUMN source_count_line_id uuid;
ALTER TABLE public.proc_rfqs ADD COLUMN rfq_no text, ADD COLUMN updated_at timestamptz DEFAULT now();
ALTER TABLE public.proc_rfq_items ADD COLUMN id uuid DEFAULT gen_random_uuid(), ADD COLUMN requested_qty numeric;
CREATE TABLE public.proc_rfq_suppliers(rfq_id uuid,supplier_id uuid,status text,sent_at timestamptz,sent_by uuid);
CREATE TABLE public.proc_whatsapp_rfq_dispatches(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),rfq_id uuid,supplier_id uuid,status text,sent_by uuid,message_id text,last_error text,updated_at timestamptz,UNIQUE(rfq_id,supplier_id));
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),'00000000-0000-4000-8000-000000000001')::uuid $$;
INSERT INTO public.proc_profiles(id,role) VALUES('00000000-0000-4000-8000-000000000002','stock_handler');
CREATE OR REPLACE FUNCTION private.proc_is_role(text[]) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM public.proc_profiles WHERE id=auth.uid() AND active AND role=ANY($1)) $$;
CREATE OR REPLACE FUNCTION private.proc_has_permission(text) RETURNS boolean LANGUAGE sql AS $$ SELECT private.proc_is_role(ARRAY['admin']) OR (private.proc_is_role(ARRAY['stock_handler']) AND $1 IN ('stock.count.enter','company_lists.view')) $$;
CREATE FUNCTION private.fixture_rfq_permission_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT private.proc_has_permission('procurement.rfq.manage') THEN RAISE EXCEPTION 'RFQ write permission required by production trigger';END IF;RETURN NEW;
END $$;
CREATE TRIGGER fixture_rfq_guard BEFORE INSERT OR UPDATE ON public.proc_rfqs FOR EACH ROW EXECUTE FUNCTION private.fixture_rfq_permission_guard();
CREATE TRIGGER fixture_invitation_guard BEFORE INSERT OR UPDATE ON public.proc_rfq_suppliers FOR EACH ROW EXECUTE FUNCTION private.fixture_rfq_permission_guard();
CREATE OR REPLACE FUNCTION public.proc_create_rfq_v4(uuid[],uuid[],date,text,jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE fid uuid:=gen_random_uuid();rid uuid;sid uuid;
BEGIN
 IF NOT private.proc_has_permission('procurement.rfq.manage') THEN RAISE EXCEPTION 'RFQ permission missing';END IF;
 INSERT INTO public.proc_rfqs(id,rfq_no,status) VALUES(fid,'RFQ-AUTO-'||fid,'prepared');
 FOREACH rid IN ARRAY $1 LOOP
  IF NOT EXISTS(SELECT 1 FROM public.proc_requirements WHERE id=rid AND approval_status='approved' AND selected_for_order) THEN RAISE EXCEPTION 'Unapproved RFQ requirement';END IF;
  INSERT INTO public.proc_rfq_items(rfq_id,requirement_id,requested_qty) SELECT fid,id,adjusted_qty-ordered_qty FROM public.proc_requirements WHERE id=rid;
  UPDATE public.proc_requirements SET status='quoting' WHERE id=rid;
 END LOOP;
 FOREACH sid IN ARRAY $2 LOOP INSERT INTO public.proc_rfq_suppliers(rfq_id,supplier_id,status) VALUES(fid,sid,'pending');END LOOP;
 RETURN jsonb_build_object('rfq_id',fid,'rfq_no','RFQ-AUTO-'||fid);
END $$;
CREATE FUNCTION public.proc_whatsapp_claim_dispatch(uuid,uuid,text,text,text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE d uuid;
BEGIN
 IF NOT private.proc_has_permission('procurement.rfq.manage') THEN RAISE EXCEPTION 'RFQ send permission missing';END IF;
 INSERT INTO public.proc_whatsapp_rfq_dispatches(rfq_id,supplier_id,sent_by,status) VALUES($1,$2,auth.uid(),'sending') RETURNING id INTO d;
 RETURN d;
END $$;
CREATE OR REPLACE FUNCTION public.proc_submit_company_list_check_v2(p_company_id uuid,p_lines jsonb,p_notes text DEFAULT NULL,p_count_started_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE cid uuid:=gen_random_uuid();lid uuid;rid uuid;line jsonb;item uuid;ids uuid[]:='{}';orders jsonb:='[]';
BEGIN
 INSERT INTO public.proc_stock_counts(id,count_no,status,counted_by) VALUES(cid,'COUNT-'||cid,'submitted',auth.uid());
 FOR line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  SELECT item_id INTO item FROM public.proc_company_list_items WHERE id=(line->>'company_list_item_id')::uuid AND company_id=p_company_id;
  INSERT INTO public.proc_stock_count_lines(count_id,item_id,current_stock) VALUES(cid,item,(line->>'current_stock')::numeric) RETURNING id INTO lid;
  INSERT INTO public.proc_requirements(id,company_id,item_id,adjusted_qty,approval_status,source_count_line_id) VALUES(gen_random_uuid(),p_company_id,item,10-(line->>'current_stock')::numeric,'pending_review',lid) RETURNING id INTO rid;
  ids:=array_append(ids,rid);
 END LOOP;
 IF (SELECT group_auto_approve FROM public.proc_companies WHERE id=p_company_id) THEN orders:=private.proc_company_direct_orders(p_company_id,ids,true);END IF;
 RETURN jsonb_build_object('count_id',cid,'count_no','COUNT-'||cid,'purchase_orders',orders,'requirements_created',cardinality(ids));
END $$;
\ir ../../supabase/migrations/20261016020752_company_stock_auto_rfq_templates.sql

DO $$
DECLARE co uuid:='00000000-0000-4000-8000-000000000101';root uuid:='00000000-0000-4000-8000-000000000201';child uuid:='00000000-0000-4000-8000-000000000202';
 one uuid:='00000000-0000-4000-8000-000000000011';two uuid:='00000000-0000-4000-8000-000000000012';
 admin uuid:='00000000-0000-4000-8000-000000000001';worker uuid:='00000000-0000-4000-8000-000000000002';
 body jsonb:='[{"company_list_item_id":"00000000-0000-4000-8000-000000000401","current_stock":2},{"company_list_item_id":"00000000-0000-4000-8000-000000000402","current_stock":4}]';
 token uuid:=gen_random_uuid();r jsonb;r2 jsonb;job jsonb;claim jsonb;q public.proc_company_rfq_queue;denied boolean;count_v integer;
BEGIN
 DELETE FROM public.proc_company_section_routes WHERE company_id=co;
 PERFORM public.proc_company_save_route_v2(co,NULL,'rfq',true,ARRAY[one,two],'{"name":"General Ceramics","fields":{"rate":false},"note":"Deliver to No.77"}');
 PERFORM public.proc_company_save_route_v2(co,child,'direct',true,ARRAY[one],'{"name":"General Hardware","note":"Deliver to stores"}');
 ASSERT private.proc_company_effective_route(co,'00000000-0000-4000-8000-000000000301')->>'mode'='rfq','Company default must apply to unconfigured categories';
 PERFORM set_config('request.jwt.claim.sub',worker::text,true);
 denied:=false;BEGIN PERFORM public.proc_company_save_route_v2(co,root,'direct',true,ARRAY[one],'{}');EXCEPTION WHEN OTHERS THEN denied:=true;END;
 ASSERT denied,'Stock handlers must not configure automation';
 r:=public.proc_submit_company_list_check_v3(co,body,token,NULL,NULL);
 ASSERT jsonb_array_length(r->'rfqs')=1,'RFQ should be made for company default';
 ASSERT jsonb_array_length(r->'purchase_orders')=1,'Child direct route should create a PO instead of an RFQ';
 ASSERT jsonb_array_length(r->'automation_errors')=0,'Automatic RFQ failed';
 ASSERT auth.uid()=worker,'Admin impersonation must be restored';
 ASSERT (SELECT count(*)=2 FROM public.proc_company_rfq_queue),'Both company RFQ suppliers must be queued';
 ASSERT (SELECT count(*)=1 FROM public.proc_rfq_items WHERE rfq_id=(r->'rfqs'->0->>'rfq_id')::uuid),'Child direct PO item leaked into RFQ';
 ASSERT (SELECT company_document_template->>'note'='Deliver to stores' FROM public.proc_purchase_orders WHERE id=(r->'purchase_orders'->0->>'id')::uuid),'PO must snapshot route template';
 SELECT count(*) INTO count_v FROM public.proc_stock_counts;
 r2:=public.proc_submit_company_list_check_v3(co,body,token,NULL,NULL);
 ASSERT r2=r AND (SELECT count(*)=count_v FROM public.proc_stock_counts),'Retry must return the original result without another count or messages';
 denied:=false;BEGIN PERFORM public.proc_submit_company_list_check_v3(co,'[]',token,NULL,NULL);EXCEPTION WHEN OTHERS THEN denied:=true;END;
 ASSERT denied,'Idempotency must reject changed count contents';
 SELECT * INTO q FROM public.proc_company_rfq_queue ORDER BY supplier_id LIMIT 1;
 job:=public.proc_company_rfq_job(q.id);
 ASSERT job->'template'->>'name'='General Ceramics','RFQ template must be shared across operators';
 ASSERT jsonb_array_length(job->'lines')=1,'RFQ job scope incorrect';
 claim:=public.proc_company_claim_rfq_send(q.id,'default',repeat('a',64),'Caption');
 ASSERT claim->>'phone' IS NOT NULL AND auth.uid()=worker,'Stock operator must claim an admin-authorized send without gaining RFQ administration';
 ASSERT public.proc_company_claim_rfq_send(q.id,'default',repeat('a',64),'Caption') IS NULL,'A concurrent or repeat claim must not send twice';
 PERFORM public.proc_company_finish_rfq_send(q.id,'accepted','message-one',NULL);
 ASSERT auth.uid()=worker,'Acceptance updates must restore the stock operator after RFQ permission guards';
 ASSERT (SELECT status='accepted' FROM public.proc_company_rfq_queue WHERE id=q.id),'Acceptance not recorded';
 ASSERT (SELECT status='sent' FROM public.proc_rfq_suppliers WHERE rfq_id=q.rfq_id AND supplier_id=q.supplier_id),'Automatic send must update supplier status';
 SELECT * INTO q FROM public.proc_company_rfq_queue WHERE status='pending' LIMIT 1;
 PERFORM set_config('request.jwt.claim.sub',admin::text,true);
 PERFORM public.proc_company_save_route_v2(co,NULL,'rfq',false,ARRAY[one,two],'{}');
 PERFORM set_config('request.jwt.claim.sub',worker::text,true);
 denied:=false;BEGIN PERFORM public.proc_company_claim_rfq_send(q.id,'default',repeat('b',64),'Caption');EXCEPTION WHEN OTHERS THEN denied:=true;END;
 ASSERT denied,'Turning automation off must block unsent queued messages';
END $$;

DO $$
DECLARE co uuid:='00000000-0000-4000-8000-000000000101';child uuid:='00000000-0000-4000-8000-000000000202';
 one uuid:='00000000-0000-4000-8000-000000000011';admin uuid:='00000000-0000-4000-8000-000000000001';worker uuid:='00000000-0000-4000-8000-000000000002';
 body jsonb:='[{"company_list_item_id":"00000000-0000-4000-8000-000000000401","current_stock":1}]';
 r jsonb;q public.proc_company_rfq_queue;denied boolean;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',admin::text,true);
 PERFORM public.proc_company_save_route_v2(co,NULL,'rfq',true,ARRAY[one],'{"name":"Single Supplier RFQ"}');
 PERFORM set_config('request.jwt.claim.sub',worker::text,true);
 r:=public.proc_submit_company_list_check_v3(co,body,gen_random_uuid(),NULL,NULL);
 ASSERT jsonb_array_length(r->'rfqs')=1,'One supplier must support automatic RFQ too';
 SELECT * INTO q FROM public.proc_company_rfq_queue WHERE rfq_id=(r->'rfqs'->0->>'rfq_id')::uuid;
 ASSERT (SELECT count(*)=1 FROM public.proc_company_rfq_queue WHERE rfq_id=q.rfq_id),'Single supplier RFQ recipients incorrect';
 PERFORM public.proc_company_claim_rfq_send(q.id,'default',repeat('c',64),'Caption');
 PERFORM public.proc_company_finish_rfq_send(q.id,'unknown',NULL,'Interrupted');
 ASSERT public.proc_company_claim_rfq_send(q.id,'default',repeat('c',64),'Caption') IS NULL,'Unknown sends must never retry automatically';
 ASSERT (SELECT ordered_qty=0 FROM public.proc_requirements WHERE id IN (SELECT requirement_id FROM public.proc_rfq_items WHERE rfq_id=q.rfq_id)),'RFQ automation must not place an order';
 PERFORM set_config('request.jwt.claim.sub',admin::text,true);
 PERFORM public.proc_company_save_route_v2(co,NULL,'rfq',false,ARRAY[one],'{}');
 PERFORM set_config('request.jwt.claim.sub',worker::text,true);
 r:=public.proc_submit_company_list_check_v3(co,body,gen_random_uuid(),NULL,NULL);
 ASSERT jsonb_array_length(r->'rfqs')=0 AND jsonb_array_length(r->'purchase_orders')=0,'Disabled automatic RFQ must only save stock';
 PERFORM set_config('request.jwt.claim.sub',admin::text,true);
 PERFORM public.proc_company_save_route_v2(co,NULL,'direct',true,ARRAY[one],'{"name":"Root PO"}');
 PERFORM public.proc_company_save_route_v2(co,child,'direct',true,ARRAY[one],'{"name":"Child PO"}');
 PERFORM set_config('request.jwt.claim.sub',worker::text,true);
 r:=public.proc_submit_company_list_check_v3(co,body||'[{"company_list_item_id":"00000000-0000-4000-8000-000000000402","current_stock":1}]'::jsonb,gen_random_uuid(),NULL,NULL);
 ASSERT jsonb_array_length(r->'purchase_orders')=2,'Same supplier with different category templates must receive separate correctly headed orders';
 ASSERT (SELECT count(DISTINCT company_document_template->>'name')=2 FROM public.proc_purchase_orders WHERE id IN(SELECT (x->>'id')::uuid FROM jsonb_array_elements(r->'purchase_orders') x)),'PO templates mixed between routes';
 ASSERT NOT has_function_privilege('anon','public.proc_submit_company_list_check_v3(uuid,jsonb,uuid,text,timestamptz)','EXECUTE'),'Anonymous stock automation execute grant';
 ASSERT NOT has_table_privilege('authenticated','public.proc_company_rfq_queue','INSERT'),'Clients must not fabricate queue jobs';
 ASSERT NOT has_table_privilege('authenticated','private.proc_company_submission_receipts','SELECT'),'Submission receipts must remain private';
END $$;

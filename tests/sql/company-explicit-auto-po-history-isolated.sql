-- Disposable PostgreSQL only: test the actual explicit single-supplier stock automation
-- migration without touching live company records or real WhatsApp contacts.
\ir company-stock-auto-rfq-isolated.sql
ALTER TABLE public.proc_rfqs ADD COLUMN created_at timestamptz DEFAULT now();
\ir ../../supabase/migrations/20261016090000_explicit_company_direct_auto_and_rfq_history.sql

DO $$
DECLARE co uuid:='00000000-0000-4000-8000-000000000101';
 root uuid:='00000000-0000-4000-8000-000000000201';
 child uuid:='00000000-0000-4000-8000-000000000202';
 one uuid:='00000000-0000-4000-8000-000000000011';
 two uuid:='00000000-0000-4000-8000-000000000012';
 admin uuid:='00000000-0000-4000-8000-000000000001';
 worker uuid:='00000000-0000-4000-8000-000000000002';
 req uuid:='00000000-0000-4000-8000-000000000591';
 req_manual uuid:='00000000-0000-4000-8000-000000000592';
 rfq_manual uuid:='00000000-0000-4000-8000-000000000593';
 result_v jsonb;blocked boolean;history_count integer;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',admin::text,true);
 UPDATE public.proc_companies SET auto_approve=false,group_auto_approve=false WHERE id=co;
 PERFORM public.proc_company_save_route_v2(co,root,'direct',true,ARRAY[one],'{}');
 PERFORM public.proc_company_save_route_v2(co,child,'rfq',false,ARRAY[one,two],'{}');
 INSERT INTO public.proc_requirements(id,company_id,item_id,adjusted_qty,ordered_qty,approval_status)
 VALUES(req,co,'00000000-0000-4000-8000-000000000301',6,0,'pending_review');
 PERFORM set_config('request.jwt.claim.sub',worker::text,true);
 result_v:=private.proc_company_direct_orders(co,ARRAY[req],true);
 ASSERT jsonb_array_length(result_v)=1,'Explicit direct group did not create a PO without legacy company approval';
 ASSERT (SELECT status='approved' AND auto_approved FROM public.proc_purchase_orders WHERE id=(result_v->0->>'id')::uuid),'Direct PO not automatically approved';
 ASSERT (SELECT count(*)=1 FROM public.proc_company_dispatch_queue WHERE po_id=(result_v->0->>'id')::uuid),'Direct PO dispatch must be queued';
 ASSERT (SELECT ordered_qty=6 AND approval_status='approved' FROM public.proc_requirements WHERE id=req),'Stock requirement not marked approved and ordered';
 -- Disabling the route must forbid another automatic direct PO.
 PERFORM set_config('request.jwt.claim.sub',admin::text,true);
 PERFORM public.proc_company_save_route_v2(co,root,'direct',false,ARRAY[one],'{}');
 INSERT INTO public.proc_requirements(id,company_id,item_id,adjusted_qty,ordered_qty) VALUES(req_manual,co,'00000000-0000-4000-8000-000000000301',5,0);
 PERFORM set_config('request.jwt.claim.sub',worker::text,true);
 blocked:=false;
 BEGIN result_v:=private.proc_company_direct_orders(co,ARRAY[req_manual],true);blocked:=jsonb_array_length(result_v)=0;
 EXCEPTION WHEN OTHERS THEN blocked:=true;END;
 ASSERT blocked,'Disabled route must not create an automatic direct PO';
 ASSERT (SELECT ordered_qty=0 FROM public.proc_requirements WHERE id=req_manual),'Disabled route changed requirement quantities';
 -- History includes a company-linked RFQ even without an automatic dispatch entry.
 PERFORM set_config('request.jwt.claim.sub',admin::text,true);
 INSERT INTO public.proc_rfqs(id,rfq_no,status) VALUES(rfq_manual,'RFQ-MANUAL-COMPANY','prepared');
 INSERT INTO public.proc_rfq_items(rfq_id,requirement_id,requested_qty) VALUES(rfq_manual,req_manual,5);
 SELECT count(*) INTO history_count FROM public.proc_company_rfq_history(100) WHERE rfq_id=rfq_manual AND company_id=co;
 ASSERT history_count=1,'Manually created company RFQ missing from separate history';
 ASSERT NOT has_function_privilege('anon','public.proc_company_rfq_history(integer)','EXECUTE'),'Anonymous history exposure';
END $$;

-- Exercise the real v2/v3 submission chain against the fixture stock engine.
CREATE FUNCTION private.proc_company_auto_from_count(p_company_id uuid,p_count_id uuid,p_ids uuid[]) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
 IF NOT private.proc_has_permission('stock.count.enter') OR NOT EXISTS(SELECT 1 FROM public.proc_stock_counts WHERE id=p_count_id AND counted_by=auth.uid() AND status='submitted')
 OR EXISTS(SELECT 1 FROM unnest(p_ids) x WHERE NOT EXISTS(SELECT 1 FROM public.proc_requirements r JOIN public.proc_stock_count_lines l ON l.id=r.source_count_line_id WHERE r.id=x AND r.company_id=p_company_id AND l.count_id=p_count_id)) THEN RAISE EXCEPTION 'Invalid company auto-approval scope';END IF;
 RETURN private.proc_company_direct_orders(p_company_id,p_ids,true);
END $$;

CREATE FUNCTION private.proc_default_location_id() RETURNS uuid LANGUAGE sql AS $$ SELECT '00000000-0000-4000-8000-000000000099'::uuid $$;
CREATE FUNCTION private.proc_submit_stock_count_impl(uuid) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
 UPDATE public.proc_stock_counts SET status='submitted' WHERE id=$1;
 INSERT INTO public.proc_requirements(id,item_id,adjusted_qty,source_count_line_id,approval_status)
 SELECT gen_random_uuid(),item_id,suggested_qty,id,'pending_review' FROM public.proc_stock_count_lines WHERE count_id=$1 AND suggested_qty>0;
 GET DIAGNOSTICS n=ROW_COUNT;RETURN n;
END $$;
CREATE FUNCTION private.proc_company_link_count(uuid,uuid) RETURNS uuid[] LANGUAGE plpgsql AS $$
DECLARE ids uuid[];
BEGIN
 UPDATE public.proc_requirements r SET company_id=$1 FROM public.proc_stock_count_lines l WHERE l.id=r.source_count_line_id AND l.count_id=$2;
 SELECT array_agg(r.id) INTO ids FROM public.proc_requirements r JOIN public.proc_stock_count_lines l ON l.id=r.source_count_line_id WHERE l.count_id=$2;
 RETURN ids;
END $$;
DO $$
DECLARE co uuid:='00000000-0000-4000-8000-000000000101';
 root uuid:='00000000-0000-4000-8000-000000000201';
 child uuid:='00000000-0000-4000-8000-000000000202';
 one uuid:='00000000-0000-4000-8000-000000000011';
 two uuid:='00000000-0000-4000-8000-000000000012';
 admin uuid:='00000000-0000-4000-8000-000000000001';
 worker uuid:='00000000-0000-4000-8000-000000000002';
 token uuid:=gen_random_uuid();result_v jsonb;repeat_v jsonb;body jsonb;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',admin::text,true);
 PERFORM public.proc_company_save_route_v2(co,root,'direct',true,ARRAY[one],'{}');
 PERFORM public.proc_company_save_route_v2(co,child,'rfq',true,ARRAY[one,two],'{}');
 UPDATE public.proc_companies SET auto_approve=false,group_auto_approve=false WHERE id=co;
 body:='[{"company_list_item_id":"00000000-0000-4000-8000-000000000401","current_stock":2},{"company_list_item_id":"00000000-0000-4000-8000-000000000402","current_stock":4}]';
 PERFORM set_config('request.jwt.claim.sub',worker::text,true);
 result_v:=public.proc_submit_company_list_check_v3(co,body,token,NULL,now());
 ASSERT jsonb_array_length(result_v->'purchase_orders')=1,'Stock submission did not automatically create the single supplier PO';
 ASSERT jsonb_array_length(result_v->'rfqs')=1,'Stock submission did not create the other category RFQ';
 ASSERT (SELECT count(*)=2 FROM public.proc_company_rfq_queue WHERE rfq_id=(result_v->'rfqs'->0->>'rfq_id')::uuid),'RFQ must queue an image for both suppliers';
 ASSERT (SELECT qty=8 FROM public.proc_po_lines WHERE po_id=(result_v->'purchase_orders'->0->>'id')::uuid),'PO must order shortage only';
 repeat_v:=public.proc_submit_company_list_check_v3(co,body,token,NULL,now());
 ASSERT repeat_v->>'count_id'=result_v->>'count_id','Retry created another stock count';
 ASSERT (SELECT count(*)=1 FROM public.proc_company_dispatch_queue WHERE po_id=(result_v->'purchase_orders'->0->>'id')::uuid),'Retry duplicated the PO queue';
 ASSERT auth.uid()=worker,'Automation failed to restore the stock handler identity';
END $$;

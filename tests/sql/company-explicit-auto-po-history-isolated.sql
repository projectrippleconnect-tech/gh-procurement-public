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
 BEGIN PERFORM private.proc_company_direct_orders(co,ARRAY[req_manual],true);
 EXCEPTION WHEN OTHERS THEN blocked:=true;END;
 ASSERT blocked,'Disabled route must not create an automatic direct PO';
 ASSERT (SELECT ordered_qty=0 FROM public.proc_requirements WHERE id=req_manual),'Disabled route changed requirement quantities';
 -- History includes a company-linked RFQ even without an automatic dispatch entry.
 INSERT INTO public.proc_rfqs(id,rfq_no,status) VALUES(rfq_manual,'RFQ-MANUAL-COMPANY','prepared');
 INSERT INTO public.proc_rfq_items(rfq_id,requirement_id,requested_qty) VALUES(rfq_manual,req_manual,5);
 SELECT count(*) INTO history_count FROM public.proc_company_rfq_history(100) WHERE rfq_id=rfq_manual AND company_id=co;
 ASSERT history_count=1,'Manually created company RFQ missing from separate history';
 ASSERT NOT has_function_privilege('anon','public.proc_company_rfq_history(integer)','EXECUTE'),'Anonymous history exposure';
END $$;

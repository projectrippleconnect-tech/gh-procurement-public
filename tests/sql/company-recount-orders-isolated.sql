-- Real production recount engine, with disposable tables and no network sends.
\ir company-explicit-auto-po-history-isolated.sql
ALTER TABLE public.proc_items ADD COLUMN item_code text DEFAULT 'TEST';
ALTER TABLE public.proc_requirements ADD COLUMN location_id uuid,ADD COLUMN required_qty numeric DEFAULT 0,
 ADD COLUMN received_qty numeric DEFAULT 0,ADD COLUMN source_type text DEFAULT 'stock_count',
 ADD COLUMN requirement_no text,ADD COLUMN created_by uuid,ADD COLUMN created_at timestamptz DEFAULT now();
ALTER TABLE public.proc_requirements ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.proc_stock_counts ADD COLUMN created_at timestamptz DEFAULT now(),ADD COLUMN submitted_at timestamptz,ADD COLUMN updated_at timestamptz;
ALTER TABLE public.proc_po_lines ADD COLUMN cancelled_qty numeric NOT NULL DEFAULT 0;
ALTER TABLE public.proc_rfq_items ADD COLUMN selected_for_po boolean DEFAULT true;
CREATE TABLE public.proc_grns(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),status text);
CREATE TABLE public.proc_grn_lines(grn_id uuid,po_line_id uuid,accepted_qty numeric);
CREATE TABLE public.proc_stock_balances(item_id uuid,location_id uuid,qty numeric,last_counted_at timestamptz,updated_at timestamptz,PRIMARY KEY(item_id,location_id));
CREATE TABLE public.proc_stock_ledger(item_id uuid,location_id uuid,txn_type text,qty_delta numeric,balance_after numeric,source_type text,source_id uuid,note text,created_by uuid,created_at timestamptz DEFAULT now());
\ir stock-submit-production-fixture.sql
\ir ../../supabase/migrations/20261016091837_company_recount_order_guards.sql
CREATE FUNCTION public.proc_company_claim_send(uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT private.proc_company_claim_send($1)$$;

DO $$
DECLARE co uuid:='00000000-0000-4000-8000-000000000101';
 root uuid:='00000000-0000-4000-8000-000000000201';
 supplier uuid:='00000000-0000-4000-8000-000000000011';
 item uuid:='00000000-0000-4000-8000-000000000301';
 location uuid:='00000000-0000-4000-8000-000000000099';
 token uuid:=gen_random_uuid();body jsonb;first_v jsonb;result_v jsonb;req uuid;po uuid;queue uuid;
 qty_before numeric;count_before integer;blocked boolean;ledger_before integer;gid uuid;
BEGIN
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
 UPDATE public.proc_requirements SET status='closed';
 UPDATE public.proc_purchase_orders SET status='closed';
 PERFORM public.proc_company_save_route_v2(co,root,'direct',true,ARRAY[supplier],'{}');
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
 -- First count creates the 9-unit order exactly once.
 body:='[{"company_list_item_id":"00000000-0000-4000-8000-000000000401","current_stock":1}]';
 first_v:=public.proc_submit_company_list_check_v3(co,body,token,NULL,clock_timestamp());
 ASSERT jsonb_array_length(first_v->'purchase_orders')=1,'Initial opt-in must still create a PO';
 po:=(first_v->'purchase_orders'->0->>'id')::uuid;
 SELECT requirement_id INTO req FROM public.proc_po_lines WHERE po_id=po;
 ASSERT (SELECT qty=9 FROM public.proc_po_lines WHERE po_id=po),'Initial quantity wrong';
 SELECT id INTO queue FROM public.proc_company_dispatch_queue WHERE po_id=po;
 result_v:=public.proc_submit_company_list_check_v3(co,body,token,NULL,clock_timestamp());
 ASSERT result_v=first_v,'Same-token retry changed the result';
 -- Separate, identical recount must neither duplicate nor resend.
 result_v:=public.proc_submit_company_list_check_v3(co,body,gen_random_uuid(),NULL,clock_timestamp());
 ASSERT jsonb_array_length(result_v->'purchase_orders')=0,'Identical recount created another PO';
 ASSERT result_v->'stock_outcomes'->0->>'committed_qty'='9','Existing PO missing from count result';
 -- The exact live incident: 1 -> 0 changes need from 9 to 10.
 body:='[{"company_list_item_id":"00000000-0000-4000-8000-000000000401","current_stock":0}]';
 result_v:=public.proc_submit_company_list_check_v3(co,body,gen_random_uuid(),NULL,clock_timestamp());
 ASSERT jsonb_array_length(result_v->'purchase_orders')=0,'Recount silently created a 1-unit top-up';
 ASSERT (SELECT ordered_qty=9 AND adjusted_qty=10 FROM public.proc_requirements WHERE id=req),'Latest shortage was lost';
 ASSERT result_v->'stock_outcomes'->0->>'uncovered_qty'='1','Uncovered delta must be visible';
 ASSERT (result_v->'stock_outcomes'->0->>'needs_review')::boolean,'Delta must need manual review';
 blocked:=false;BEGIN PERFORM public.proc_company_claim_send(queue);EXCEPTION WHEN OTHERS THEN blocked:=SQLERRM LIKE '%Stock need or order balance changed%';END;
 ASSERT blocked,'Stale queued order was allowed to send';
 ASSERT (SELECT status='pending' FROM public.proc_company_dispatch_queue WHERE id=queue),'Blocked send claimed the queue';
 -- Reduced need / sufficient stock must not cancel or amend a supplier order silently.
 body:='[{"company_list_item_id":"00000000-0000-4000-8000-000000000401","current_stock":8}]';
 result_v:=public.proc_submit_company_list_check_v3(co,body,gen_random_uuid(),NULL,clock_timestamp());
 ASSERT (result_v->'stock_outcomes'->0->>'needs_review')::boolean,'Over-commitment needs review';
 SELECT count(*) INTO ledger_before FROM public.proc_stock_ledger;
 body:='[{"company_list_item_id":"00000000-0000-4000-8000-000000000401","sufficient_stock":true}]';
 result_v:=public.proc_submit_company_list_check_v3(co,body,gen_random_uuid(),NULL,clock_timestamp());
 ASSERT (SELECT count(*)=ledger_before FROM public.proc_stock_ledger),'Visual sufficient check wrote a stock ledger quantity';
 ASSERT (SELECT qty=9 FROM public.proc_po_lines WHERE po_id=po),'Recount rewrote an approved order';
 -- Explicit manual approval remains available for a reviewed additional quantity.
 body:='[{"company_list_item_id":"00000000-0000-4000-8000-000000000401","current_stock":0}]';
 result_v:=public.proc_submit_company_list_check_v3(co,body,gen_random_uuid(),NULL,clock_timestamp());
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
 result_v:=private.proc_company_direct_orders(co,ARRAY[req],false);
 ASSERT jsonb_array_length(result_v)=1,'Explicit manual supplemental approval unavailable';
 ASSERT (SELECT qty=1 FROM public.proc_po_lines WHERE po_id=(result_v->0->>'id')::uuid),'Manual supplement must contain delta only';
 -- Partial receipt is subtracted from order commitments, not counted twice.
 INSERT INTO public.proc_grns(status) VALUES('posted') RETURNING id INTO gid;
 INSERT INTO public.proc_grn_lines SELECT gid,id,4 FROM public.proc_po_lines WHERE po_id=po;
 UPDATE public.proc_requirements SET received_qty=4 WHERE id=req;
 UPDATE public.proc_purchase_orders SET status='partially_received' WHERE id=po;
 ASSERT (SELECT sum(remaining_qty)=6 FROM private.proc_company_open_orders(item,location)),'Partial receipt not deducted from pending orders';
 -- Changing supplier must not escape the same-item pending-order check.
 PERFORM public.proc_company_save_route_v2(co,root,'direct',true,ARRAY['00000000-0000-4000-8000-000000000012'::uuid],'{}');
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
 result_v:=public.proc_submit_company_list_check_v3(co,body,gen_random_uuid(),NULL,clock_timestamp());
 ASSERT jsonb_array_length(result_v->'purchase_orders')=0,'Supplier change duplicated an outstanding order';
 -- After cancelling outstanding orders, uncovered need can be ordered again.
 UPDATE public.proc_purchase_orders SET status='cancelled' WHERE id IN(SELECT po_id FROM public.proc_po_lines WHERE requirement_id=req);
 UPDATE public.proc_requirements SET ordered_qty=received_qty WHERE id=req;
 result_v:=public.proc_submit_company_list_check_v3(co,body,gen_random_uuid(),NULL,clock_timestamp());
 ASSERT jsonb_array_length(result_v->'purchase_orders')=1,'Cancelled orders incorrectly blocked replacement procurement';
 ASSERT (SELECT qty=10 FROM public.proc_po_lines WHERE po_id=(result_v->'purchase_orders'->0->>'id')::uuid),'Replacement need wrong after receipt and cancellation';
 -- A manual queued cancellation cannot send the old full image.
 SELECT id INTO queue FROM public.proc_company_dispatch_queue WHERE po_id=(result_v->'purchase_orders'->0->>'id')::uuid;
 UPDATE public.proc_po_lines SET cancelled_qty=1 WHERE po_id=(result_v->'purchase_orders'->0->>'id')::uuid;
 blocked:=false;BEGIN PERFORM public.proc_company_claim_send(queue);EXCEPTION WHEN OTHERS THEN blocked:=true;END;
 ASSERT blocked,'Partially cancelled PO was sent with its original image';
 UPDATE public.proc_po_lines SET cancelled_qty=0 WHERE po_id=(result_v->'purchase_orders'->0->>'id')::uuid;
 -- Completing all orders starts a new replenishment cycle; old receipts do not block it.
 UPDATE public.proc_purchase_orders SET status='received' WHERE id IN(SELECT po_id FROM public.proc_po_lines WHERE requirement_id=req) AND status<>'cancelled';
 UPDATE public.proc_requirements SET status='received',received_qty=ordered_qty WHERE id=req;
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
 PERFORM public.proc_company_save_route_v2(co,root,'rfq',true,ARRAY[supplier],'{}');
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
 result_v:=public.proc_submit_company_list_check_v3(co,body,gen_random_uuid(),NULL,clock_timestamp());
 ASSERT jsonb_array_length(result_v->'rfqs')=1,'Completed cycle must allow fresh procurement';
 SELECT r.id INTO req FROM public.proc_requirements r JOIN public.proc_stock_count_lines l ON l.id=r.source_count_line_id WHERE l.count_id=(result_v->>'count_id')::uuid;
 -- Route changes cannot send a direct PO while its previous RFQ is active.
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
 PERFORM public.proc_company_save_route_v2(co,root,'direct',true,ARRAY[supplier],'{}');
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
 result_v:=public.proc_submit_company_list_check_v3(co,body,gen_random_uuid(),NULL,clock_timestamp());
 ASSERT jsonb_array_length(result_v->'purchase_orders')=0,'Direct route bypassed an already active RFQ';
 body:='[{"company_list_item_id":"00000000-0000-4000-8000-000000000401","current_stock":1}]';
 result_v:=public.proc_submit_company_list_check_v3(co,body,gen_random_uuid(),NULL,clock_timestamp());
 ASSERT (result_v->'stock_outcomes'->0->>'needs_review')::boolean,'Changed active RFQ quantity was not flagged: '||result_v::text;
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
 UPDATE public.proc_rfqs SET status='cancelled' WHERE id IN(SELECT rfq_id FROM public.proc_rfq_items WHERE requirement_id=req);
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
 result_v:=public.proc_submit_company_list_check_v3(co,body,gen_random_uuid(),NULL,clock_timestamp());
 ASSERT jsonb_array_length(result_v->'purchase_orders')=1,'Cancelling RFQ must allow configured direct route';
 SELECT id INTO queue FROM public.proc_company_dispatch_queue WHERE po_id=(result_v->'purchase_orders'->0->>'id')::uuid;
 ASSERT public.proc_company_claim_send(queue) IS NOT NULL,'Unchanged approved PO should be claimable';
 ASSERT public.proc_company_claim_send(queue) IS NULL,'Concurrent/repeat claim must not resend';
 UPDATE public.proc_company_dispatch_queue SET status='unknown' WHERE id=queue;
 ASSERT public.proc_company_claim_send(queue) IS NULL,'Unknown send must be held instead of retried';
 UPDATE public.proc_company_dispatch_queue SET status='accepted' WHERE id=queue;
 ASSERT public.proc_company_claim_send(queue) IS NULL,'Accepted send must not be sent again';
 -- Invalid quantities and stale counts fail without creating orders or counts.
 SELECT count(*) INTO count_before FROM public.proc_stock_counts;
 blocked:=false;BEGIN PERFORM public.proc_submit_company_list_check_v3(co,'[{"company_list_item_id":"00000000-0000-4000-8000-000000000401","current_stock":-1}]',gen_random_uuid(),NULL,clock_timestamp());EXCEPTION WHEN OTHERS THEN blocked:=true;END;
 ASSERT blocked AND (SELECT count(*)=count_before FROM public.proc_stock_counts),'Invalid count was partly saved';
 blocked:=false;BEGIN PERFORM public.proc_submit_company_list_check_v3(co,body,gen_random_uuid(),NULL,now()-interval '1 day');EXCEPTION WHEN OTHERS THEN blocked:=true;END;
 ASSERT blocked AND (SELECT count(*)=count_before FROM public.proc_stock_counts),'Stale count was partly saved';
 ASSERT NOT has_function_privilege('authenticated','private.proc_company_open_orders(uuid,uuid)','EXECUTE'),'Internal commitment helper exposed';
END $$;

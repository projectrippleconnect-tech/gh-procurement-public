-- Disposable PostgreSQL only: compile release migration and exercise real routing functions.
CREATE SCHEMA private;
CREATE SCHEMA auth;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated;END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon;END IF;
END $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT '00000000-0000-4000-8000-000000000001'::uuid $$;
CREATE FUNCTION private.proc_assert_access() RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN;END $$;
CREATE FUNCTION private.proc_access_allowed() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION private.proc_has_permission(text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION private.proc_is_role(text[]) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE TABLE public.proc_profiles(id uuid PRIMARY KEY,active boolean DEFAULT true,role text);
CREATE TABLE public.proc_suppliers(id uuid PRIMARY KEY,name text,phone text,whatsapp text,active boolean DEFAULT true,supplier_kind text DEFAULT 'company');
CREATE TABLE public.proc_companies(id uuid PRIMARY KEY,name text,active boolean DEFAULT true,company_list_enabled boolean DEFAULT true,default_supplier_id uuid REFERENCES public.proc_suppliers(id),order_route text DEFAULT 'quotation',auto_send boolean DEFAULT false,auto_approve boolean DEFAULT false,automation_admin_id uuid REFERENCES public.proc_profiles(id),updated_at timestamptz DEFAULT now());
CREATE TABLE public.proc_items(id uuid PRIMARY KEY,description text,brand text,size text,colour text,variation text,uom text,remarks text,movement text,active boolean DEFAULT true);
CREATE TABLE public.proc_company_sections(id uuid PRIMARY KEY,company_id uuid REFERENCES public.proc_companies(id),parent_id uuid REFERENCES public.proc_company_sections(id),name text,active boolean DEFAULT true);
CREATE TABLE public.proc_company_list_items(id uuid PRIMARY KEY,company_id uuid REFERENCES public.proc_companies(id),item_id uuid REFERENCES public.proc_items(id),section_id uuid REFERENCES public.proc_company_sections(id),active boolean DEFAULT true,max_stock_review boolean DEFAULT false,target_stock numeric DEFAULT 10,reorder_level numeric DEFAULT 5);
CREATE TABLE public.proc_company_contacts(company_id uuid,brand text,supplier_id uuid);
CREATE TABLE public.proc_requirements(id uuid PRIMARY KEY,company_id uuid REFERENCES public.proc_companies(id),item_id uuid REFERENCES public.proc_items(id),adjusted_qty numeric DEFAULT 5,ordered_qty numeric DEFAULT 0,status text DEFAULT 'open',approval_status text DEFAULT 'approved',selected_for_order boolean DEFAULT false,approved_by uuid,approved_at timestamptz,updated_at timestamptz DEFAULT now());
CREATE TABLE public.proc_purchase_orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),po_no text,company_id uuid,supplier_id uuid,status text,created_by uuid,quantity_only boolean,notes text,terms text,auto_approved boolean,auto_approval_reason text);
CREATE TABLE public.proc_po_lines(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),po_id uuid REFERENCES public.proc_purchase_orders(id),requirement_id uuid,item_id uuid,qty numeric,unit_price numeric,discount_percent numeric,tax_percent numeric);
CREATE TABLE public.proc_company_dispatch_queue(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),po_id uuid UNIQUE,company_id uuid,status text DEFAULT 'pending',claimed_by uuid,last_error text,updated_at timestamptz DEFAULT now());
CREATE TABLE public.proc_company_attachments(company_id uuid,send_with_order boolean,kind text,po_id uuid,supplier_id uuid,item_id uuid,name text,storage_path text,mime_type text,remarks text,discount_percent numeric,discount_amount numeric);
CREATE TABLE public.proc_stock_counts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),count_no text,location_id uuid,category text,status text,counted_by uuid,notes text,count_started_at timestamptz);
CREATE TABLE public.proc_stock_count_lines(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),count_id uuid,item_id uuid,current_stock numeric,max_stock_snapshot numeric,reorder_level_snapshot numeric,movement_snapshot text,suggested_qty numeric,required_qty numeric,sufficient_stock boolean,note text);
CREATE TABLE public.proc_rfqs(id uuid PRIMARY KEY,status text);
CREATE TABLE public.proc_rfq_items(rfq_id uuid,requirement_id uuid);
CREATE FUNCTION public.proc_approve_po_v2(uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN UPDATE public.proc_purchase_orders SET status='approved' WHERE id=$1;END $$;
CREATE FUNCTION public.proc_create_rfq_v4(uuid[],uuid[],date,text,jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('rfq_id','00000000-0000-4000-8000-00000000f001','rfq_no','RFQ-TEST') $$;
CREATE FUNCTION private.proc_company_manual_orders(uuid,uuid[]) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN RETURN private.proc_company_direct_orders($1,$2,false);END $$;

INSERT INTO public.proc_profiles(id,role) VALUES('00000000-0000-4000-8000-000000000001','admin');
INSERT INTO public.proc_suppliers(id,name,phone,whatsapp) VALUES
 ('00000000-0000-4000-8000-000000000011','Supplier One','+94771234567','+94771234567'),
 ('00000000-0000-4000-8000-000000000012','Supplier Two','+94771234568','+94771234568'),
 ('00000000-0000-4000-8000-000000000013','Supplier Three','+94771234569','+94771234569');
INSERT INTO public.proc_companies(id,name) VALUES('00000000-0000-4000-8000-000000000101','Alkathene Company');
INSERT INTO public.proc_company_sections(id,company_id,parent_id,name) VALUES
 ('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000101',NULL,'Pipes'),
 ('00000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000201','Alkathene');
INSERT INTO public.proc_items(id,description,brand) VALUES
 ('00000000-0000-4000-8000-000000000301','GI pipe','Brand A'),
 ('00000000-0000-4000-8000-000000000302','Alkathene pipe','Brand B');
INSERT INTO public.proc_company_list_items(id,company_id,item_id,section_id) VALUES
 ('00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000201'),
 ('00000000-0000-4000-8000-000000000402','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000302','00000000-0000-4000-8000-000000000202');
INSERT INTO public.proc_requirements(id,company_id,item_id) VALUES
 ('00000000-0000-4000-8000-000000000501','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000301'),
 ('00000000-0000-4000-8000-000000000502','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000302');

-- Execute actual release migration, not an abbreviated approximation.
\ir ../../supabase/migrations/20261015102500_company_section_procurement_routes.sql

DO $$
DECLARE co uuid:='00000000-0000-4000-8000-000000000101';
 root uuid:='00000000-0000-4000-8000-000000000201';
 child uuid:='00000000-0000-4000-8000-000000000202';
 one uuid:='00000000-0000-4000-8000-000000000011';
 two uuid:='00000000-0000-4000-8000-000000000012';
 three uuid:='00000000-0000-4000-8000-000000000013';
 item_root uuid:='00000000-0000-4000-8000-000000000301';
 item_child uuid:='00000000-0000-4000-8000-000000000302';
 r jsonb; denied boolean;
BEGIN
 SELECT public.proc_company_save_section_route(co,root,'direct',true,ARRAY[one]) INTO r;
 ASSERT (SELECT group_auto_approve AND NOT auto_approve FROM public.proc_companies WHERE id=co),'Group auto-send must not silently enable company-wide automatic approval';
 ASSERT private.proc_company_effective_route(co,item_child)->>'mode'='direct','Child failed to inherit direct PO';
 ASSERT private.proc_company_effective_route(co,item_child)->>'route_section_id'=root::text,'Inherited route did not identify parent';

 denied:=false;
 BEGIN PERFORM public.proc_company_save_section_route(co,child,'direct',true,ARRAY[one,two]);
 EXCEPTION WHEN OTHERS THEN denied:=true;END;
 ASSERT denied,'Two suppliers were incorrectly allowed for a direct PO';
 PERFORM public.proc_company_save_section_route(co,child,'rfq',false,ARRAY[one,two,three]);
 ASSERT private.proc_company_effective_route(co,item_child)->>'mode'='rfq','Child RFQ override failed';
 ASSERT jsonb_array_length(private.proc_company_effective_route(co,item_child)->'supplier_ids')=3,'RFQ did not retain three suppliers';
 ASSERT (public.proc_company_direct_candidate_ids(co,ARRAY['00000000-0000-4000-8000-000000000501'::uuid,'00000000-0000-4000-8000-000000000502'::uuid]))=ARRAY['00000000-0000-4000-8000-000000000501'::uuid],'Wrong direct PO candidate set';
 SELECT private.proc_company_direct_orders(co,ARRAY['00000000-0000-4000-8000-000000000501'::uuid,'00000000-0000-4000-8000-000000000502'::uuid],true) INTO r;
 ASSERT jsonb_array_length(r)=1,'Only one direct PO should be made';
 ASSERT (SELECT count(*)=1 FROM public.proc_company_dispatch_queue),'Only direct PO should be queued for WhatsApp';
 ASSERT (SELECT ordered_qty=0 FROM public.proc_requirements WHERE item_id=item_child),'RFQ item was ordered without supplier price';
 ASSERT (public.proc_company_prepare_group_rfq(co,child,null)->>'rfq_no')='RFQ-TEST','RFQ group preparation failed';
 PERFORM public.proc_company_clear_section_route(co,child);
 ASSERT private.proc_company_effective_route(co,item_child)->>'mode'='direct','Removing override failed to restore parent routing';
END $$;

-- Isolated schema only. No production records, messages or orders are retained.
BEGIN;
CREATE TEMPORARY TABLE supplier_setup_results(check_name text,passed boolean);
CREATE FUNCTION pg_temp.reject_setup_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF current_setting('qa.reject_route_link',true)='on' THEN RAISE EXCEPTION 'Injected link failure';END IF;RETURN NEW;END $$;
CREATE TRIGGER qa_reject_setup_link BEFORE INSERT ON public.proc_company_section_route_suppliers FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_setup_link();
DO $$
DECLARE admin uuid;co uuid;section_v uuid;item_v uuid;one uuid:=gen_random_uuid();two uuid:=gen_random_uuid();other uuid:=gen_random_uuid();
 saved jsonb;current_route jsonb;result_v jsonb;failure text;before_pos bigint;before_rfqs bigint;staff uuid:=gen_random_uuid();
BEGIN
 SELECT id INTO STRICT admin FROM public.proc_profiles WHERE role_key='admin' AND active LIMIT 1;
 PERFORM set_config('request.jwt.claim.sub',admin::text,true);
 result_v:=public.proc_company_import_sheet('QA atomic suppliers',987654323,jsonb_build_array(jsonb_build_object('source_key','qa:routing:one','description','Routing fixture','category','GENERAL','uom','PCS','max_stock',10)));
 co:=(result_v->>'company_id')::uuid;
 SELECT item_id INTO STRICT item_v FROM public.proc_company_list_items WHERE company_id=co;
 INSERT INTO public.proc_company_sections(company_id,name) VALUES(co,'QA section') RETURNING id INTO section_v;
 UPDATE public.proc_company_list_items SET section_id=section_v WHERE company_id=co;
 INSERT INTO public.proc_suppliers(id,supplier_code,name,phone,whatsapp,supplier_kind) VALUES
 (one,'QA-'||one,'First supplier','+94771234567','+94771234567','company'),
 (two,'QA-'||two,'Second supplier','+94777654321','+94777654321','company'),
 (other,'QA-'||other,'Outside supplier','+94771111111','+94771111111','company');
 SELECT count(*) INTO before_pos FROM public.proc_purchase_orders;
 SELECT count(*) INTO before_rfqs FROM public.proc_rfqs;
 -- Distinguish the full supplier directory from the selected outgoing recipients.
 saved:=public.proc_company_save_supplier_setup(co,NULL,'rfq',ARRAY[one,two],ARRAY[one],'{}');
 ASSERT (SELECT assigned_supplier_ids=ARRAY[one,two] FROM public.proc_company_section_routes WHERE id=(saved->>'id')::uuid),'Full company supplier list was lost';
 ASSERT (SELECT count(*)=1 FROM public.proc_company_section_route_suppliers WHERE route_id=(saved->>'id')::uuid),'Unselected supplier became a recipient';
 ASSERT (SELECT default_supplier_id IS NULL FROM public.proc_companies WHERE id=co),'Multiple suppliers kept an ambiguous independent default';
 ASSERT private.proc_company_effective_route(co,item_v)->'supplier_ids'=to_jsonb(ARRAY[one]),'Effective routing used an unselected contact';
 INSERT INTO supplier_setup_results VALUES('Full assignment list and selected recipients persist independently in one save',true);
 failure:=NULL;BEGIN PERFORM public.proc_company_save_supplier_setup(co,NULL,'direct',ARRAY[one,two],ARRAY[one],'{}',(saved->>'id')::uuid,(saved->>'updated_at')::timestamptz);EXCEPTION WHEN OTHERS THEN failure:=SQLERRM;END;
 ASSERT failure LIKE '%one assigned supplier%', 'Direct PO accepted a multi-supplier assignment';
 failure:=NULL;BEGIN PERFORM public.proc_company_save_supplier_setup(co,NULL,'rfq',ARRAY[one],ARRAY[other],'{}',(saved->>'id')::uuid,(saved->>'updated_at')::timestamptz);EXCEPTION WHEN OTHERS THEN failure:=SQLERRM;END;
 ASSERT failure LIKE '%assigned supplier list%', 'Unassigned recipient was accepted';
 current_route:=public.proc_company_save_supplier_setup(co,NULL,'direct',ARRAY[two],ARRAY[two],'{}',(saved->>'id')::uuid,(saved->>'updated_at')::timestamptz);
 ASSERT (SELECT default_supplier_id=two FROM public.proc_companies WHERE id=co),'Sole supplier and legacy contact differ';
 ASSERT private.proc_company_effective_route(co,item_v)->'supplier_ids'=to_jsonb(ARRAY[two]),'PO routing did not follow the selected supplier';
 failure:=NULL;BEGIN PERFORM public.proc_company_save_supplier_setup(co,NULL,'manual',ARRAY[one],ARRAY[one],'{}',(saved->>'id')::uuid,(saved->>'updated_at')::timestamptz);EXCEPTION WHEN OTHERS THEN failure:=SQLERRM;END;
 ASSERT failure LIKE '%changed elsewhere%', 'A stale editor overwrote the route';
 INSERT INTO supplier_setup_results VALUES('Direct PO validation, canonical contact and stale editor protection',true);
 current_route:=public.proc_company_save_supplier_setup(co,NULL,'direct_manual',ARRAY[one,two],ARRAY[one],'{}',(current_route->>'id')::uuid,(current_route->>'updated_at')::timestamptz);
 ASSERT (SELECT route_mode='direct' AND NOT auto_send FROM public.proc_company_section_routes WHERE id=(current_route->>'id')::uuid),'Manual direct route was converted or enabled automatically';
 current_route:=public.proc_company_save_supplier_setup(co,NULL,'direct',ARRAY[two],ARRAY[two],'{}',(current_route->>'id')::uuid,(current_route->>'updated_at')::timestamptz);

 saved:=public.proc_company_save_supplier_setup(co,section_v,'rfq',ARRAY[one,two],ARRAY[one],'{}');
 PERFORM set_config('qa.reject_route_link','on',true);
 failure:=NULL;BEGIN PERFORM public.proc_company_save_supplier_setup(co,section_v,'rfq',ARRAY[two],ARRAY[two],'{}',(saved->>'id')::uuid,(saved->>'updated_at')::timestamptz);EXCEPTION WHEN OTHERS THEN failure:=SQLERRM;END;
 PERFORM set_config('qa.reject_route_link','off',true);
 ASSERT failure='Injected link failure','The rollback injection did not run';
 ASSERT (SELECT count(*)=2 FROM public.proc_company_group_contacts WHERE section_id=section_v),'Failed save partly changed supplier assignments';
 ASSERT (SELECT supplier_id=one FROM public.proc_company_section_route_suppliers WHERE route_id=(saved->>'id')::uuid),'Failed save partly changed recipients';
 INSERT INTO supplier_setup_results VALUES('Failure after writing assignments rolls back assignments and recipients together',true);
 -- Explicit manual zero-contact category overrides inherited company automation.
 saved:=public.proc_company_save_supplier_setup(co,section_v,'manual','{}','{}','{}',(saved->>'id')::uuid,(saved->>'updated_at')::timestamptz);
 ASSERT private.proc_company_effective_route(co,item_v)->>'auto_send'='false','Empty manual route fell back to automatic parent';
 ASSERT (SELECT default_supplier_id=two FROM public.proc_companies WHERE id=co),'Category override changed the company default';
 ASSERT (SELECT count(*)=before_pos FROM public.proc_purchase_orders) AND (SELECT count(*)=before_rfqs FROM public.proc_rfqs),'Saving setup created or sent purchasing documents';
 INSERT INTO supplier_setup_results VALUES('Manual no-contact override is safe and settings saves create no documents',true);
 INSERT INTO auth.users(id,email) VALUES(staff,'qa-routing-'||staff||'@example.invalid');
 INSERT INTO public.proc_profiles(id,display_name,role,role_key) VALUES(staff,'QA stock handler','stock_handler','stock_handler');
 PERFORM set_config('request.jwt.claim.sub',staff::text,true);
 failure:=NULL;BEGIN PERFORM public.proc_company_save_supplier_setup(co,NULL,'manual','{}','{}');EXCEPTION WHEN OTHERS THEN failure:=SQLERRM;END;
 ASSERT failure LIKE '%administrator%', 'A stock handler changed supplier routing';
 ASSERT NOT has_function_privilege('anon','public.proc_company_save_supplier_setup(uuid,uuid,text,uuid[],uuid[],jsonb,uuid,timestamptz)','EXECUTE'),'Anonymous caller can edit routing';
 ASSERT NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.proc_company_save_supplier_setup(uuid,uuid,text,uuid[],uuid[],jsonb,uuid,timestamptz)'::regprocedure),'Public wrapper must remain an invoker';
 INSERT INTO supplier_setup_results VALUES('Role boundaries and private privileged implementation remain intact',true);
END $$;
SELECT * FROM supplier_setup_results;
ROLLBACK;

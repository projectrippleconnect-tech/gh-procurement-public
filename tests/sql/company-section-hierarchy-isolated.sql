-- Disposable PostgreSQL only. Exercises exact release migration, with synthetic company data.
CREATE SCHEMA IF NOT EXISTS private;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
END $$;
CREATE FUNCTION private.proc_assert_access() RETURNS void LANGUAGE plpgsql AS $$BEGIN IF current_setting('fixture.access',true)='no' THEN RAISE EXCEPTION 'Access denied';END IF;END $$;
CREATE FUNCTION private.proc_access_allowed() RETURNS boolean LANGUAGE sql AS $$SELECT current_setting('fixture.access',true) IS DISTINCT FROM 'no'$$;
CREATE FUNCTION private.proc_has_permission(p text) RETURNS boolean LANGUAGE sql AS $$SELECT current_setting('fixture.permission',true) IS DISTINCT FROM 'no'$$;
CREATE TABLE public.proc_companies(id uuid PRIMARY KEY, name text NOT NULL);
CREATE TABLE public.proc_items(id uuid PRIMARY KEY, description text, category text, main_group text, subgroup text, updated_at timestamptz DEFAULT now());
CREATE TABLE public.proc_company_list_items(
 id uuid PRIMARY KEY,company_id uuid REFERENCES public.proc_companies(id),
 item_id uuid REFERENCES public.proc_items(id),target_stock numeric,reorder_level numeric,active boolean DEFAULT true,
 sort_order int,source_key text
);
INSERT INTO public.proc_companies VALUES
 ('00000000-0000-4000-8000-000000000001','Orange'),
 ('00000000-0000-4000-8000-000000000002','Another company');
INSERT INTO public.proc_items(id,description,category,main_group,subgroup) VALUES
 ('00000000-0000-4000-8000-000000000101','One-way switch','Electrical','Electrical','Switches'),
 ('00000000-0000-4000-8000-000000000102','GI Channel','Hardware','Ceiling Fittings','GI Channel'),
 ('00000000-0000-4000-8000-000000000103','Two-way switch','Electrical','Electrical','Switches');
INSERT INTO public.proc_company_list_items(id,company_id,item_id,target_stock,reorder_level,source_key) VALUES
 ('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000101',20,10,'sheet:switch'),
 ('00000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000102',50,25,'sheet:gi'),
 ('00000000-0000-4000-8000-000000000203','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000103',15,7.5,'sheet:other');

-- Run the *real* migration script, including its backfill and security policies.
\ir ../../supabase/migrations/20261014110000_company_section_hierarchy.sql

DO $$
DECLARE company_a uuid:='00000000-0000-4000-8000-000000000001';
 company_b uuid:='00000000-0000-4000-8000-000000000002';
 hardware uuid;gi uuid;switch_a uuid;switch_b uuid;other uuid;
 denied boolean; moved integer; saved_max numeric;
BEGIN
 ASSERT (SELECT count(*)=3 FROM public.proc_company_list_items WHERE section_id IS NOT NULL),'Backfill did not place all company rows';
 ASSERT (SELECT count(*)=2 FROM public.proc_company_sections WHERE name='Electrical'),'Separate companies must not share headings';
 ASSERT (SELECT count(*)=2 FROM public.proc_company_sections WHERE name='Switches'),'Separate companies must not share subsections';
 ASSERT (SELECT count(*)=0 FROM public.proc_company_sections WHERE name='Electrical' AND parent_id IS NOT NULL),'Repeated category/main group was not deduplicated';
 ASSERT (SELECT count(*)=3 FROM public.proc_items),'Item master was modified';
 ASSERT (SELECT target_stock=50 AND reorder_level=25 FROM public.proc_company_list_items WHERE id='00000000-0000-4000-8000-000000000202'),'Max and reorder values changed';

 SELECT id INTO hardware FROM public.proc_company_sections WHERE name='Hardware' AND company_id=company_a;
 SELECT id INTO gi FROM public.proc_company_sections WHERE name='GI Channel' AND company_id=company_a;
 SELECT id INTO switch_a FROM public.proc_company_sections WHERE name='Switches' AND company_id=company_a;
 SELECT id INTO switch_b FROM public.proc_company_sections WHERE name='Switches' AND company_id=company_b;
 ASSERT hardware IS NOT NULL AND gi IS NOT NULL AND switch_a IS NOT NULL AND switch_b IS NOT NULL;
 ASSERT (SELECT parent_id IS NOT NULL FROM public.proc_company_sections WHERE id=gi),'Nested section absent';

 denied:=false;
 BEGIN UPDATE public.proc_company_sections SET parent_id=gi WHERE id=hardware;
 EXCEPTION WHEN OTHERS THEN denied:=true; END;
 ASSERT denied,'Cycle in nested sections was allowed';
 denied:=false;
 BEGIN UPDATE public.proc_company_sections SET parent_id=switch_b WHERE id=hardware;
 EXCEPTION WHEN OTHERS THEN denied:=true; END;
 ASSERT denied,'Cross-company parent was allowed';

 denied:=false;
 BEGIN PERFORM public.proc_company_move_list_items(company_a,switch_b,ARRAY['00000000-0000-4000-8000-000000000201'::uuid]);
 EXCEPTION WHEN OTHERS THEN denied:=true; END;
 ASSERT denied,'Cross-company destination was allowed';
 denied:=false;
 BEGIN PERFORM public.proc_company_move_list_items(company_a,switch_a,ARRAY['00000000-0000-4000-8000-000000000201'::uuid,'00000000-0000-4000-8000-000000000203'::uuid]);
 EXCEPTION WHEN OTHERS THEN denied:=true; END;
 ASSERT denied,'Cross-company input was allowed';
 ASSERT (SELECT section_id=gi FROM public.proc_company_list_items WHERE id='00000000-0000-4000-8000-000000000202'),'Unauthorized movement was partially applied';

 moved:=public.proc_company_move_list_items(company_a,switch_a,ARRAY['00000000-0000-4000-8000-000000000202'::uuid]);
 ASSERT moved=1;
 ASSERT (SELECT section_id=switch_a FROM public.proc_company_list_items WHERE id='00000000-0000-4000-8000-000000000202'),'Requested move did not persist';
 ASSERT (SELECT target_stock=50 AND reorder_level=25 FROM public.proc_company_list_items WHERE id='00000000-0000-4000-8000-000000000202'),'Move modified stock thresholds';

 UPDATE public.proc_company_list_items SET section_id=NULL WHERE id='00000000-0000-4000-8000-000000000202';
 moved:=public.proc_company_import_section_paths(company_a,'[{"source_key":"sheet:gi","section_path":"Hardware / Ceiling Fittings / GI Channel"}]');
 ASSERT moved=1;
 ASSERT (SELECT section_id=gi FROM public.proc_company_list_items WHERE id='00000000-0000-4000-8000-000000000202'),'Section Path import did not restore assignment';
 moved:=public.proc_company_import_section_paths(company_a,'[{"source_key":"sheet:gi","section_path":"Electrical / Switches"}]');
 ASSERT moved=0;
 ASSERT (SELECT section_id=gi FROM public.proc_company_list_items WHERE id='00000000-0000-4000-8000-000000000202'),'Sheets refresh overwrote an admin section move';

 PERFORM set_config('fixture.permission','no',true);
 denied:=false;
 BEGIN PERFORM public.proc_company_move_list_items(company_a,switch_a,ARRAY['00000000-0000-4000-8000-000000000201'::uuid]);
 EXCEPTION WHEN OTHERS THEN denied:=true; END;
 ASSERT denied,'Bulk move allowed without company_lists.manage permission';
END $$;

SELECT 'PASS additive Company Lists hierarchy migration, nested paths, cycle and company isolation, atomic moves, protected stock values and permissions' AS result;

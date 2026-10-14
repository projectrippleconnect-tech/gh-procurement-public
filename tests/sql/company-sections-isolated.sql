-- Disposable PostgreSQL 17 fixture: execute the actual Company Lists migration.
-- No production credentials or operational records are used.
BEGIN;
CREATE SCHEMA private;
DO $
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
END $;
CREATE OR REPLACE FUNCTION private.proc_assert_access() RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN; END$$;
CREATE OR REPLACE FUNCTION private.proc_access_allowed() RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
CREATE OR REPLACE FUNCTION private.proc_has_permission(text) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;

CREATE TABLE public.proc_companies(id uuid PRIMARY KEY,name text);
CREATE TABLE public.proc_items(
 id uuid PRIMARY KEY,
 category text,
 main_group text,
 subgroup text
);
CREATE TABLE public.proc_company_list_items(
 id uuid PRIMARY KEY,
 company_id uuid REFERENCES public.proc_companies(id),
 item_id uuid REFERENCES public.proc_items(id),
 source_key text,
 sort_order integer DEFAULT 0,
 active boolean DEFAULT true
);
INSERT INTO public.proc_companies VALUES
 ('10000000-0000-4000-8000-000000000001','Orange'),
 ('10000000-0000-4000-8000-000000000002','Another Supplier');
INSERT INTO public.proc_items VALUES
 ('20000000-0000-4000-8000-000000000001','Electrical','Electrical','Switches'),
 ('20000000-0000-4000-8000-000000000002','Panels','Ceiling Fittings','GI Channel'),
 ('20000000-0000-4000-8000-000000000003','Electrical','Electrical','Switches'),
 ('20000000-0000-4000-8000-000000000004','Electrical','Electrical','Switches');
INSERT INTO public.proc_company_list_items(id,company_id,item_id,source_key) VALUES
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','source:1'),
 ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','source:2'),
 ('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003','source:3'),
 ('30000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000004','source:4');
\ir ../../supabase/migrations/20261014110000_company_section_hierarchy.sql

DO $$
DECLARE n integer; root uuid; child uuid; cousin uuid; company_one uuid:='10000000-0000-4000-8000-000000000001';
BEGIN
 SELECT count(*) INTO n FROM public.proc_company_list_items WHERE section_id IS NOT NULL;
 IF n<>4 THEN RAISE EXCEPTION 'Migration did not preserve four existing company rows: %',n; END IF;
 SELECT id INTO root FROM public.proc_company_sections WHERE company_id=company_one AND name='Electrical';
 SELECT id INTO child FROM public.proc_company_sections WHERE company_id=company_one AND name='Switches';
 IF NOT EXISTS(SELECT 1 FROM public.proc_company_sections WHERE id=child AND parent_id=root)
 THEN RAISE EXCEPTION 'Original Electrical/Electrical/Switches path was not normalized';END IF;
 SELECT id INTO cousin FROM public.proc_company_sections WHERE company_id='10000000-0000-4000-8000-000000000002' AND name='Switches';
 IF cousin=child THEN RAISE EXCEPTION 'Sections were incorrectly shared across companies';END IF;
 IF (SELECT count(*) FROM public.proc_items)<>4 THEN RAISE EXCEPTION 'Shared items altered by section migration';END IF;
END $$;

-- A section cannot change parent across companies.
DO $$
DECLARE foreign_parent uuid;
BEGIN
 SELECT id INTO foreign_parent FROM public.proc_company_sections
 WHERE company_id='10000000-0000-4000-8000-000000000002' AND name='Switches';
 BEGIN
  INSERT INTO public.proc_company_sections(company_id,parent_id,name)
  VALUES('10000000-0000-4000-8000-000000000001',foreign_parent,'Invalid Cross-company Child');
  RAISE EXCEPTION 'Cross-company section assignment was allowed';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%Parent section must belong to the same company%' THEN RAISE; END IF;
 END;
END $$;

-- Reparenting an ancestor into its own child must fail.
DO $$
DECLARE parent_id uuid; child_id uuid;
BEGIN
 SELECT id INTO parent_id FROM public.proc_company_sections
 WHERE company_id='10000000-0000-4000-8000-000000000001' AND name='Electrical';
 SELECT id INTO child_id FROM public.proc_company_sections WHERE parent_id=parent_id AND name='Switches';
 BEGIN
  UPDATE public.proc_company_sections SET parent_id=child_id WHERE id=parent_id;
  RAISE EXCEPTION 'Circular section movement was allowed';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%descendants%' THEN RAISE; END IF;
 END;
END $$;

-- Atomic company-only movement, with no partial update when foreign IDs are supplied.
DO $$
DECLARE destination uuid; before_sec uuid; moved integer;
BEGIN
 SELECT id INTO destination FROM public.proc_company_sections
 WHERE company_id='10000000-0000-4000-8000-000000000001' AND name='GI Channel';
 SELECT section_id INTO before_sec FROM public.proc_company_list_items WHERE id='30000000-0000-4000-8000-000000000001';
 BEGIN
  PERFORM public.proc_company_move_list_items(
   '10000000-0000-4000-8000-000000000001',destination,
   ARRAY['30000000-0000-4000-8000-000000000001'::uuid,'30000000-0000-4000-8000-000000000003'::uuid]);
  RAISE EXCEPTION 'Accepted a row from another company';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%not available in this company%' THEN RAISE; END IF;
 END;
 IF (SELECT section_id FROM public.proc_company_list_items WHERE id='30000000-0000-4000-8000-000000000001') IS DISTINCT FROM before_sec
 THEN RAISE EXCEPTION 'Failed bulk move changed a stock-row section';END IF;
 SELECT public.proc_company_move_list_items(
  '10000000-0000-4000-8000-000000000001',destination,
  ARRAY['30000000-0000-4000-8000-000000000001'::uuid]) INTO moved;
 IF moved<>1 THEN RAISE EXCEPTION 'Valid item movement did not affect exactly one row';END IF;
END $$;

-- Manually assigned paths are preserved when a Google Sheet import repeats old paths.
DO $$
DECLARE pinned uuid; mapped integer;
BEGIN
 SELECT id INTO pinned FROM public.proc_company_sections WHERE name='GI Channel' AND company_id='10000000-0000-4000-8000-000000000001';
 SELECT public.proc_company_import_section_paths(
 '10000000-0000-4000-8000-000000000001',
 '[{"source_key":"source:1","section_path":"An Unwanted / Old Path"}]'::jsonb) INTO mapped;
 IF mapped<>0 THEN RAISE EXCEPTION 'Sheet import overrode a manually assigned section';END IF;
 IF (SELECT section_id FROM public.proc_company_list_items WHERE id='30000000-0000-4000-8000-000000000001')<>pinned
 THEN RAISE EXCEPTION 'Manual stock section lost after Sheet refresh';END IF;
 IF EXISTS(SELECT 1 FROM public.proc_company_sections WHERE name='An Unwanted')
 THEN RAISE EXCEPTION 'Import created a section from a row that was already assigned';END IF;
END $$;

-- Verify that section IDs exist for all four sample rows and item-master values remain unchanged.
DO $$
BEGIN
 IF (SELECT count(*) FROM public.proc_company_list_items WHERE section_id IS NOT NULL)<>4
 THEN RAISE EXCEPTION 'Missing company row after reorganization';END IF;
 IF (SELECT subgroup FROM public.proc_items WHERE id='20000000-0000-4000-8000-000000000001')<>'Switches'
 THEN RAISE EXCEPTION 'Group movement altered shared item master';END IF;
END $$;
ROLLBACK;

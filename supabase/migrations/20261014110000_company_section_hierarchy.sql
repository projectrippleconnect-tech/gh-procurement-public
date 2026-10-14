-- Additive migration: a company-owned section tree, independent of the shared item master.
-- Apply BEFORE deploying the matching app release; does not modify stock quantities, purchase orders or item IDs.
CREATE TABLE IF NOT EXISTS public.proc_company_sections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES public.proc_companies(id) ON DELETE CASCADE,
 parent_id uuid REFERENCES public.proc_company_sections(id) ON DELETE RESTRICT,
 name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
 sort_order integer NOT NULL DEFAULT 0,
 color text CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$'),
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT proc_company_section_parent_different CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE UNIQUE INDEX IF NOT EXISTS proc_company_sections_unique_sibling ON public.proc_company_sections
 (company_id,COALESCE(parent_id,'00000000-0000-0000-0000-000000000000'::uuid),lower(name)) WHERE active;
CREATE INDEX IF NOT EXISTS proc_company_sections_parent_idx ON public.proc_company_sections(company_id,parent_id,sort_order) WHERE active;
ALTER TABLE public.proc_company_list_items ADD COLUMN IF NOT EXISTS section_id uuid REFERENCES public.proc_company_sections(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS proc_company_list_items_section_idx ON public.proc_company_list_items(company_id,section_id) WHERE active;

CREATE OR REPLACE FUNCTION private.proc_company_validate_section()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE parent_company uuid;
BEGIN
 IF NEW.parent_id IS NOT NULL THEN
  SELECT company_id INTO parent_company FROM public.proc_company_sections WHERE id=NEW.parent_id AND active;
  IF parent_company IS DISTINCT FROM NEW.company_id THEN RAISE EXCEPTION 'Parent section must belong to the same company'; END IF;
  IF NEW.id IS NOT NULL AND EXISTS (
   WITH RECURSIVE ancestors AS (
    SELECT id,parent_id FROM public.proc_company_sections WHERE id=NEW.parent_id
    UNION ALL SELECT p.id,p.parent_id FROM public.proc_company_sections p JOIN ancestors a ON p.id=a.parent_id
   ) SELECT 1 FROM ancestors WHERE id=NEW.id
  ) THEN RAISE EXCEPTION 'A section cannot be moved into one of its descendants'; END IF;
 END IF;
 NEW.name=btrim(NEW.name);
 NEW.updated_at=now();
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS proc_company_section_validate ON public.proc_company_sections;
CREATE TRIGGER proc_company_section_validate BEFORE INSERT OR UPDATE ON public.proc_company_sections
 FOR EACH ROW EXECUTE FUNCTION private.proc_company_validate_section();

CREATE OR REPLACE FUNCTION private.proc_company_validate_item_section()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.section_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM public.proc_company_sections WHERE id=NEW.section_id AND company_id=NEW.company_id AND active
 ) THEN RAISE EXCEPTION 'Section must be active and belong to the selected company'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS proc_company_item_section_validate ON public.proc_company_list_items;
CREATE TRIGGER proc_company_item_section_validate BEFORE INSERT OR UPDATE OF section_id,company_id ON public.proc_company_list_items
 FOR EACH ROW EXECUTE FUNCTION private.proc_company_validate_item_section();

-- Creates or finds a section path without touching the shared proc_items group names.
CREATE OR REPLACE FUNCTION private.proc_company_ensure_section_path(p_company uuid,p_path text[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE parent uuid; part text; new_id uuid;
BEGIN
 FOREACH part IN ARRAY p_path LOOP
  part=nullif(btrim(part),''); IF part IS NULL THEN CONTINUE; END IF;
  SELECT id INTO new_id FROM public.proc_company_sections
   WHERE company_id=p_company AND parent_id IS NOT DISTINCT FROM parent AND lower(name)=lower(part) AND active
   ORDER BY id LIMIT 1;
  IF new_id IS NULL THEN
   INSERT INTO public.proc_company_sections(company_id,parent_id,name,sort_order)
    VALUES(p_company,parent,part,0) ON CONFLICT DO NOTHING RETURNING id INTO new_id;
   IF new_id IS NULL THEN
    SELECT id INTO new_id FROM public.proc_company_sections
     WHERE company_id=p_company AND parent_id IS NOT DISTINCT FROM parent AND lower(name)=lower(part) AND active LIMIT 1;
   END IF;
  END IF;
  parent=new_id;new_id=NULL;
 END LOOP;
 RETURN parent;
END $$;
REVOKE ALL ON FUNCTION private.proc_company_ensure_section_path(uuid,text[]) FROM PUBLIC,anon,authenticated;

-- Called after importing Google Sheets; does not overwrite manually selected sections.
CREATE OR REPLACE FUNCTION public.proc_company_seed_sections(p_company_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record; dest uuid; n integer:=0;
BEGIN
 PERFORM private.proc_assert_access();
 IF NOT private.proc_has_permission('company_lists.manage') THEN RAISE EXCEPTION 'Company management permission required'; END IF;
 FOR r IN SELECT cli.id, i.category,i.main_group,i.subgroup FROM public.proc_company_list_items cli
 JOIN public.proc_items i ON i.id=cli.item_id
 WHERE cli.company_id=p_company_id AND cli.active AND cli.section_id IS NULL LOOP
  dest:=private.proc_company_ensure_section_path(p_company_id,ARRAY[r.category,r.main_group,r.subgroup]);
  UPDATE public.proc_company_list_items SET section_id=dest WHERE id=r.id AND section_id IS NULL;
  n:=n+1;
 END LOOP;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.proc_company_seed_sections(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.proc_company_seed_sections(uuid) TO authenticated;

-- Existing section labels are migrated without changing proc_items, balances or source identities.
DO $$
DECLARE r record; dest uuid;
BEGIN
 FOR r IN SELECT cli.id,cli.company_id,i.category,i.main_group,i.subgroup
          FROM public.proc_company_list_items cli
          JOIN public.proc_items i ON i.id=cli.item_id
          WHERE cli.active AND cli.section_id IS NULL LOOP
  dest:=private.proc_company_ensure_section_path(r.company_id,ARRAY[r.category,r.main_group,r.subgroup]);
  UPDATE public.proc_company_list_items SET section_id=dest WHERE id=r.id;
 END LOOP;
END $$;

ALTER TABLE public.proc_company_sections ENABLE ROW LEVEL SECURITY;
CREATE POLICY proc_company_sections_read ON public.proc_company_sections FOR SELECT TO authenticated
 USING ((SELECT private.proc_access_allowed()) AND private.proc_has_permission('company_lists.view'));
CREATE POLICY proc_company_sections_insert ON public.proc_company_sections FOR INSERT TO authenticated
 WITH CHECK ((SELECT private.proc_access_allowed()) AND private.proc_has_permission('company_lists.manage'));
CREATE POLICY proc_company_sections_update ON public.proc_company_sections FOR UPDATE TO authenticated
 USING ((SELECT private.proc_access_allowed()) AND private.proc_has_permission('company_lists.manage'))
 WITH CHECK ((SELECT private.proc_access_allowed()) AND private.proc_has_permission('company_lists.manage'));
GRANT SELECT,INSERT,UPDATE ON public.proc_company_sections TO authenticated;
-- This table is not deletable by staff; sections are archived or merged after reassigning their items.

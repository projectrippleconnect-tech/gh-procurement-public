-- GH Procurement: ALCATINE is a single company/category with no ALCATHINE HOSE child.
-- Preserve list IDs, item IDs, stock quantities, source keys, supplier routes and histories.
-- The unused child is archived (not deleted) for historical references.
-- Safe to rerun after completion. Preconditions prevent touching unrelated company data.
DO $migration$
DECLARE
 v_company_id uuid;
 v_root_id uuid;
 v_child_id uuid;
 v_n integer;
 v_moved integer;
 v_changed integer;
BEGIN
 SELECT count(*),min(id::text)::uuid INTO v_n,v_company_id
 FROM public.proc_companies WHERE upper(btrim(name))='ALCATINE';
 IF v_n<>1 THEN RAISE EXCEPTION 'Expected exactly one ALCATINE company; found %',v_n; END IF;

 SELECT count(*),min(id::text)::uuid INTO v_n,v_root_id
 FROM public.proc_company_sections
 WHERE company_id=v_company_id AND active AND parent_id IS NULL AND upper(btrim(name))='ALCATHINE';
 IF v_n<>1 THEN RAISE EXCEPTION 'Expected exactly one main ALCATHINE section; found %',v_n; END IF;

 SELECT count(*),min(id::text)::uuid INTO v_n,v_child_id
 FROM public.proc_company_sections
 WHERE company_id=v_company_id AND active AND parent_id=v_root_id AND upper(btrim(name))='ALCATHINE HOSE';
 IF v_n>1 THEN RAISE EXCEPTION 'Duplicate redundant Alkathine hose sections; review required'; END IF;

 IF v_child_id IS NOT NULL THEN
  IF EXISTS (SELECT 1 FROM public.proc_company_sections WHERE parent_id=v_child_id AND active)
     OR EXISTS (SELECT 1 FROM public.proc_company_section_routes WHERE section_id=v_child_id)
  THEN RAISE EXCEPTION 'Alkathine child contains active subgroups or supplier overrides; manual review required'; END IF;

  SELECT count(*) INTO v_n
  FROM public.proc_company_list_items l JOIN public.proc_items i ON i.id=l.item_id
  WHERE l.company_id=v_company_id AND l.section_id=v_child_id AND l.active
    AND upper(i.category)='ALCATHINE' AND upper(i.main_group)='ALCATHINE';
  IF v_n<>10 OR EXISTS (
    SELECT 1 FROM public.proc_company_list_items l
    WHERE l.company_id=v_company_id AND l.section_id=v_child_id AND l.active
      AND NOT EXISTS (SELECT 1 FROM public.proc_items i WHERE i.id=l.item_id
        AND upper(i.category)='ALCATHINE' AND upper(i.main_group)='ALCATHINE')
  ) THEN RAISE EXCEPTION 'Unexpected Alkathine child inventory; no changes made'; END IF;

  UPDATE public.proc_company_list_items SET section_id=v_root_id
  WHERE company_id=v_company_id AND section_id=v_child_id AND active;
  GET DIAGNOSTICS v_moved=ROW_COUNT;
  IF v_moved<>10 THEN RAISE EXCEPTION 'Alkathine item move mismatch: %',v_moved; END IF;

  UPDATE public.proc_company_sections SET active=false,updated_at=now()
  WHERE id=v_child_id AND company_id=v_company_id;
 END IF;

 UPDATE public.proc_items i SET subgroup=NULL
 WHERE i.subgroup='ALCATHINE HOSE' AND upper(i.category)='ALCATHINE'
   AND upper(i.main_group)='ALCATHINE' AND EXISTS(
     SELECT 1 FROM public.proc_company_list_items l
     WHERE l.company_id=v_company_id AND l.item_id=i.id AND l.active AND l.section_id=v_root_id
   );
 GET DIAGNOSTICS v_changed=ROW_COUNT;

 IF (SELECT count(*) FROM public.proc_company_list_items l JOIN public.proc_items i ON i.id=l.item_id
     WHERE l.company_id=v_company_id AND l.active AND upper(i.category)='ALCATHINE')<>10
 OR EXISTS (SELECT 1 FROM public.proc_company_list_items l JOIN public.proc_items i ON i.id=l.item_id
     WHERE l.company_id=v_company_id AND l.active AND upper(i.category)='ALCATHINE'
       AND (l.section_id IS DISTINCT FROM v_root_id OR nullif(btrim(i.subgroup),'') IS NOT NULL))
 THEN RAISE EXCEPTION 'Alkathine post-update invariant failed; rolling back'; END IF;
END
$migration$;

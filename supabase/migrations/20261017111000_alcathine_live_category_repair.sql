-- GH Procurement: repair existing Alkathine category assignments after a legacy reset/import.
-- This migration is intentionally scoped to the one existing ALCATINE company.
-- No product/stock values, source identities, supplier routes, orders or history are changed.
-- It archives an EMPTY, unrouted ALCATHINE HOSE subcategory, never deletes it.
--
-- Failure is atomic; only the existing company-list permission guard is temporarily
-- disabled for the 10 verified admin data assignments. All other triggers stay on.
ALTER TABLE public.proc_company_list_items DISABLE TRIGGER a_proc_permission_guard;

DO $repair$
DECLARE
  v_company uuid;
  v_root uuid;
  v_child uuid;
  v_count integer;
  v_changed integer;
  v_invalid integer;
  v_before jsonb;
  v_after jsonb;
BEGIN
  SELECT count(*), min(id::text)::uuid
    INTO v_count, v_company
  FROM public.proc_companies
  WHERE upper(btrim(name))='ALCATINE';
  -- Disposable schema-only CI has no companies; do not invent fixtures.
  IF v_count=0 THEN RETURN; END IF;
  IF v_count<>1 THEN
    RAISE EXCEPTION 'Alkathine repair requires one existing ALCATINE company; found %',v_count;
  END IF;

  SELECT count(*), min(id::text)::uuid
    INTO v_count, v_root
  FROM public.proc_company_sections
  WHERE company_id=v_company AND active AND parent_id IS NULL AND upper(btrim(name))='ALCATHINE';
  IF v_count<>1 THEN
    RAISE EXCEPTION 'Alkathine repair requires one active root section; found %',v_count;
  END IF;

  SELECT count(*), min(id::text)::uuid
    INTO v_count, v_child
  FROM public.proc_company_sections
  WHERE company_id=v_company AND parent_id=v_root AND upper(btrim(name))='ALCATHINE HOSE';
  IF v_count>1 THEN RAISE EXCEPTION 'Multiple redundant Alkathine child sections: review before repair'; END IF;
  IF v_child IS NOT NULL AND (
    EXISTS(SELECT 1 FROM public.proc_company_sections WHERE parent_id=v_child AND active)
    OR EXISTS(SELECT 1 FROM public.proc_company_section_routes WHERE section_id=v_child)
  ) THEN
    RAISE EXCEPTION 'Alkathine child has active nested groups or supplier routes; no changes made';
  END IF;

  -- Block concurrent company-row changes during this short reconciliation.
  PERFORM 1 FROM public.proc_company_list_items
  WHERE company_id=v_company FOR UPDATE;

  SELECT count(*) INTO v_count
  FROM public.proc_company_list_items
  WHERE company_id=v_company AND active;
  IF v_count<>10 THEN
    RAISE EXCEPTION 'Expected exactly ten active Alkathine variants, got %',v_count;
  END IF;

  SELECT count(*) INTO v_invalid
  FROM public.proc_company_list_items li
  LEFT JOIN public.proc_items i ON i.id=li.item_id
  WHERE li.company_id=v_company AND li.active
    AND (i.id IS NULL OR upper(btrim(coalesce(i.category,'')))<>'ALCATHINE'
      OR upper(btrim(coalesce(i.main_group,'')))<>'ALCATHINE'
      OR nullif(btrim(coalesce(i.subgroup,'')),'') IS NOT NULL
      OR (li.section_id IS NOT NULL AND li.section_id<>v_root
          AND (v_child IS NULL OR li.section_id<>v_child)));
  IF v_invalid>0 THEN
    RAISE EXCEPTION '% Alkathine rows have unexpected category, subgroup or assignment; no changes made',v_invalid;
  END IF;

  -- Snapshot every protected field (including item ID, target/max/reorder,
  -- source ID and sort order) before updating section_id only.
  SELECT jsonb_agg(to_jsonb(li)-'section_id'-'updated_at' ORDER BY li.id)
  INTO v_before
  FROM public.proc_company_list_items li WHERE li.company_id=v_company AND li.active;

  UPDATE public.proc_company_list_items
  SET section_id=v_root
  WHERE company_id=v_company AND active AND section_id IS DISTINCT FROM v_root;
  GET DIAGNOSTICS v_changed=ROW_COUNT;
  IF v_changed>10 THEN RAISE EXCEPTION 'Unexpected Alkathine update count %',v_changed; END IF;

  IF v_child IS NOT NULL THEN
    UPDATE public.proc_company_sections
    SET active=false,updated_at=now()
    WHERE id=v_child AND company_id=v_company AND active;
  END IF;

  SELECT jsonb_agg(to_jsonb(li)-'section_id'-'updated_at' ORDER BY li.id)
  INTO v_after
  FROM public.proc_company_list_items li WHERE li.company_id=v_company AND li.active;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'A protected Alkathine field changed; transaction rolled back';
  END IF;

  IF (SELECT count(*) FROM public.proc_company_list_items
      WHERE company_id=v_company AND active AND section_id=v_root)<>10
    OR EXISTS(SELECT 1 FROM public.proc_company_sections WHERE id=v_child AND active)
  THEN RAISE EXCEPTION 'Alkathine final category invariant failed; transaction rolled back'; END IF;
END
$repair$;

ALTER TABLE public.proc_company_list_items ENABLE TRIGGER a_proc_permission_guard;

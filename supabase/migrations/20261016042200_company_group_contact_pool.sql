-- Company section supplier directories are independent of default RFQ/PO routing.
-- Existing automatic dispatch remains unchanged until an administrator explicitly edits a route.
CREATE TABLE public.proc_company_group_contacts (
 company_id uuid NOT NULL REFERENCES public.proc_companies(id) ON DELETE CASCADE,
 section_id uuid NOT NULL REFERENCES public.proc_company_sections(id) ON DELETE CASCADE,
 supplier_id uuid NOT NULL REFERENCES public.proc_suppliers(id),
 sort_order integer NOT NULL DEFAULT 1 CHECK(sort_order > 0),
 PRIMARY KEY(section_id,supplier_id)
);
CREATE INDEX proc_company_group_contacts_company_idx ON public.proc_company_group_contacts(company_id,section_id,sort_order);
ALTER TABLE public.proc_company_group_contacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.proc_company_group_contacts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.proc_company_group_contacts TO authenticated;
CREATE POLICY proc_company_group_contacts_read ON public.proc_company_group_contacts FOR SELECT TO authenticated
 USING (private.proc_access_allowed() AND private.proc_has_permission('company_lists.view'));
-- Import existing real-section route contacts without creating a universal company contact rule.
INSERT INTO public.proc_company_group_contacts(company_id,section_id,supplier_id,sort_order)
 SELECT r.company_id,r.section_id,l.supplier_id,l.sort_order
 FROM public.proc_company_section_routes r
 JOIN public.proc_company_section_route_suppliers l ON l.route_id=r.id
 JOIN public.proc_company_sections s ON s.id=r.section_id AND s.company_id=r.company_id
 WHERE r.section_id IS NOT NULL
 ON CONFLICT(section_id,supplier_id) DO NOTHING;

CREATE FUNCTION public.proc_company_save_group_contacts(p_company_id uuid,p_section_id uuid,p_supplier_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ids uuid[]; sid uuid;
BEGIN
 PERFORM private.proc_assert_access();
 IF NOT private.proc_is_role(ARRAY['admin']) OR NOT private.proc_has_permission('company_lists.manage') THEN
  RAISE EXCEPTION 'Company administrator required';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.proc_companies WHERE id=p_company_id AND active) OR
    NOT EXISTS (SELECT 1 FROM public.proc_company_sections WHERE id=p_section_id AND company_id=p_company_id AND active) THEN
  RAISE EXCEPTION 'Select an active group belonging to this company';
 END IF;
 SELECT array_agg(id ORDER BY first_pos) INTO ids FROM
  (SELECT id,min(ord) AS first_pos FROM unnest(p_supplier_ids) WITH ORDINALITY AS t(id,ord) GROUP BY id) selected;
 IF coalesce(cardinality(ids),0) NOT BETWEEN 1 AND 15 THEN RAISE EXCEPTION 'Assign 1–15 supplier contacts'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ids) t(id) WHERE NOT EXISTS(
   SELECT 1 FROM public.proc_suppliers s WHERE s.id=t.id AND s.active AND s.supplier_kind='company'
 )) THEN RAISE EXCEPTION 'Only active company supplier contacts can be assigned'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('company-contact-group:'||p_section_id::text,0));
 DELETE FROM public.proc_company_group_contacts WHERE section_id=p_section_id AND company_id=p_company_id;
 FOREACH sid IN ARRAY ids LOOP
  INSERT INTO public.proc_company_group_contacts(company_id,section_id,supplier_id,sort_order)
  VALUES(p_company_id,p_section_id,sid,array_position(ids,sid));
 END LOOP;
 RETURN jsonb_build_object('company_id',p_company_id,'section_id',p_section_id,'supplier_count',cardinality(ids));
END $$;
REVOKE ALL ON FUNCTION public.proc_company_save_group_contacts(uuid,uuid,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.proc_company_save_group_contacts(uuid,uuid,uuid[]) TO authenticated;

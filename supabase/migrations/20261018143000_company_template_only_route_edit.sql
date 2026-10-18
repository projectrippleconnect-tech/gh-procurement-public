-- Template-only write. This does not touch recipient links, assigned contacts,
-- auto-send flags, workflow modes, company defaults, or historical documents.
CREATE OR REPLACE FUNCTION public.proc_company_update_route_template(
 p_route_id uuid,
 p_template jsonb,
 p_expected_updated_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE route_v public.proc_company_section_routes%ROWTYPE;
BEGIN
 PERFORM private.proc_assert_access();
 IF auth.uid() IS NULL
   OR NOT private.proc_is_role(ARRAY['admin'])
   OR NOT private.proc_has_permission('company_lists.manage') THEN
   RAISE EXCEPTION 'Company administrator required' USING errcode='42501';
 END IF;
 IF p_route_id IS NULL OR p_expected_updated_at IS NULL THEN
   RAISE EXCEPTION 'Select an existing saved company routing rule and refresh it before editing its template';
 END IF;
 IF p_template IS NULL
   OR jsonb_typeof(p_template)<>'object'
   OR octet_length(p_template::text)>6000
   OR length(coalesce(p_template->>'name',''))>80
   OR length(coalesce(p_template->>'title',''))>60
   OR length(coalesce(p_template->>'note',''))>300
   OR length(coalesce(p_template->>'caption',''))>2000 THEN
   RAISE EXCEPTION 'Invalid document template';
 END IF;
 SELECT r.* INTO route_v FROM public.proc_company_section_routes r
 JOIN public.proc_companies c ON c.id=r.company_id
 WHERE r.id=p_route_id AND c.active AND c.company_list_enabled
 FOR UPDATE OF r;
 IF route_v.id IS NULL THEN
   RAISE EXCEPTION 'Saved company route unavailable. Configure it in RFQ & PO Workflow Settings.';
 END IF;
 IF route_v.updated_at IS DISTINCT FROM p_expected_updated_at THEN
   RAISE EXCEPTION 'Routing settings changed elsewhere. Reload this template before saving.';
 END IF;
 UPDATE public.proc_company_section_routes
 SET document_template=p_template,updated_by=auth.uid(),updated_at=clock_timestamp()
 WHERE id=route_v.id
 RETURNING * INTO route_v;
 RETURN jsonb_build_object('id',route_v.id,'updated_at',route_v.updated_at,
   'document_template',route_v.document_template);
END $$;
REVOKE ALL ON FUNCTION public.proc_company_update_route_template(uuid,jsonb,timestamptz)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.proc_company_update_route_template(uuid,jsonb,timestamptz)
 TO authenticated;

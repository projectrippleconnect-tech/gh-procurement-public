-- Delete exactly the routing override the administrator reviewed, never a
-- newer replacement saved from another screen. No migration of existing data.
CREATE OR REPLACE FUNCTION public.proc_company_clear_section_route_checked(
 p_company_id uuid,
 p_section_id uuid,
 p_expected_route_id uuid,
 p_expected_updated_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE current_v public.proc_company_section_routes%ROWTYPE;
BEGIN
 PERFORM private.proc_assert_access();
 IF auth.uid() IS NULL
    OR NOT private.proc_is_role(ARRAY['admin'])
    OR NOT private.proc_has_permission('company_lists.manage') THEN
  RAISE EXCEPTION 'Company administrator required' USING errcode='42501';
 END IF;
 IF p_company_id IS NULL OR p_expected_route_id IS NULL OR p_expected_updated_at IS NULL THEN
  RAISE EXCEPTION 'Select and refresh the saved routing override before removing it';
 END IF;
 SELECT r.* INTO current_v
 FROM public.proc_company_section_routes r
 JOIN public.proc_companies c ON c.id=r.company_id
 WHERE r.id=p_expected_route_id
   AND r.company_id=p_company_id
   AND r.section_id IS NOT DISTINCT FROM p_section_id
   AND c.active AND c.company_list_enabled
 FOR UPDATE OF r;
 IF current_v.id IS NULL THEN
  RAISE EXCEPTION 'The selected routing override was removed or replaced. Refresh before retrying.';
 END IF;
 IF current_v.updated_at IS DISTINCT FROM p_expected_updated_at THEN
  RAISE EXCEPTION 'This supplier route changed since it was loaded. Refresh and review before removing it.';
 END IF;
 DELETE FROM public.proc_company_section_routes WHERE id=current_v.id;
 RETURN jsonb_build_object('id',current_v.id,'removed',true);
END $$;
REVOKE ALL ON FUNCTION public.proc_company_clear_section_route_checked(uuid,uuid,uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.proc_company_clear_section_route_checked(uuid,uuid,uuid,timestamptz) TO authenticated;

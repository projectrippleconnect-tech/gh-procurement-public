-- Non-destructive validation fix: allow multiple assigned supplier contacts with
-- exactly one Direct PO delivery recipient. Keep every permission, lock, version
-- guard and historic document reference from the existing RPC.
-- Idempotent: CREATE OR REPLACE changes logic only, with no data migration.
CREATE OR REPLACE FUNCTION private.proc_company_save_supplier_setup(
 p_company_id uuid,p_section_id uuid,p_action text,p_assigned_ids uuid[],p_recipient_ids uuid[],p_template jsonb,
 p_expected_route_id uuid,p_expected_updated_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ids uuid[];recipients uuid[];sid uuid;route_v public.proc_company_section_routes;send_v boolean;mode_v text;
BEGIN
 PERFORM private.proc_assert_access();
 IF auth.uid() IS NULL OR NOT private.proc_is_role(ARRAY['admin']) OR NOT private.proc_has_permission('company_lists.manage') THEN
  RAISE EXCEPTION 'Company administrator required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.proc_companies WHERE id=p_company_id AND active) THEN RAISE EXCEPTION 'Company unavailable';END IF;
 IF p_section_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.proc_company_sections WHERE id=p_section_id AND company_id=p_company_id AND active) THEN
  RAISE EXCEPTION 'Category must belong to this company';END IF;
 IF p_action IS NULL OR p_action NOT IN ('manual','rfq','direct','rfq_manual','direct_manual') THEN RAISE EXCEPTION 'Choose manual review, RFQ or direct PO';END IF;
 SELECT coalesce(array_agg(id ORDER BY position),'{}'::uuid[]) INTO ids FROM
  (SELECT id,min(n) position FROM unnest(p_assigned_ids) WITH ORDINALITY t(id,n) GROUP BY id) x;
 SELECT coalesce(array_agg(id ORDER BY position),'{}'::uuid[]) INTO recipients FROM
  (SELECT id,min(n) position FROM unnest(p_recipient_ids) WITH ORDINALITY t(id,n) GROUP BY id) x;
 IF cardinality(ids)>15 THEN RAISE EXCEPTION 'Assign at most 15 suppliers';END IF;
 IF EXISTS(SELECT 1 FROM unnest(ids) x(id) WHERE NOT EXISTS(SELECT 1 FROM public.proc_suppliers s WHERE s.id=x.id AND s.active AND s.supplier_kind='company')) THEN
  RAISE EXCEPTION 'Choose active company suppliers only';END IF;
 IF NOT recipients <@ ids THEN RAISE EXCEPTION 'Recipients must belong to the assigned supplier list';END IF;
 send_v:=p_action IN ('rfq','direct');mode_v:=CASE WHEN p_action IN ('direct','direct_manual') THEN 'direct' ELSE 'rfq' END;
 IF p_action='manual' THEN recipients:=ids;END IF;
 IF send_v AND cardinality(recipients)=0 THEN RAISE EXCEPTION 'Choose at least one recipient';END IF;
 IF mode_v='direct' AND cardinality(recipients)<>1 THEN RAISE EXCEPTION 'Direct PO requires exactly one recipient';END IF;
 -- Keep multiple designated suppliers in the group directory but select exactly
 -- one actual Direct PO recipient. The recipient must already belong to ids.
 -- The existing direct recipient cardinality and membership guards apply above.
 IF send_v AND NOT private.proc_has_permission(CASE WHEN p_action='rfq' THEN 'procurement.rfq.manage' ELSE 'procurement.orders.approve' END) THEN
  RAISE EXCEPTION 'Document approval permission required for automation';END IF;
 IF send_v AND EXISTS(SELECT 1 FROM public.proc_suppliers WHERE id=ANY(recipients)
  AND coalesce(nullif(whatsapp,''),phone,'') !~ '^\+94[0-9]{9}$') THEN RAISE EXCEPTION 'Automatic recipients need valid +94 WhatsApp numbers';END IF;
 IF p_template IS NULL OR jsonb_typeof(p_template)<>'object' OR octet_length(p_template::text)>6000 OR length(coalesce(p_template->>'name',''))>80 OR length(coalesce(p_template->>'title',''))>60 OR length(coalesce(p_template->>'note',''))>300 OR length(coalesce(p_template->>'caption',''))>2000 THEN RAISE EXCEPTION 'Invalid document template';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('company-group-route:'||p_company_id::text||coalesce(p_section_id::text,''),0));
 SELECT * INTO route_v FROM public.proc_company_section_routes WHERE company_id=p_company_id AND section_id IS NOT DISTINCT FROM p_section_id FOR UPDATE;
 IF route_v.id IS DISTINCT FROM p_expected_route_id OR route_v.updated_at IS DISTINCT FROM p_expected_updated_at THEN
  RAISE EXCEPTION 'Supplier settings changed elsewhere. Reload settings before saving.';END IF;
 IF p_section_id IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('company-contact-group:'||p_section_id::text,0));
  DELETE FROM public.proc_company_group_contacts WHERE company_id=p_company_id AND section_id=p_section_id;
  FOREACH sid IN ARRAY ids LOOP INSERT INTO public.proc_company_group_contacts(company_id,section_id,supplier_id,sort_order)
   VALUES(p_company_id,p_section_id,sid,array_position(ids,sid));END LOOP;
 END IF;
 IF route_v.id IS NULL THEN
  INSERT INTO public.proc_company_section_routes(company_id,section_id,route_mode,auto_send,document_template,updated_by,assigned_supplier_ids)
   VALUES(p_company_id,p_section_id,mode_v,send_v,p_template,auth.uid(),ids) RETURNING * INTO route_v;
 ELSE
  UPDATE public.proc_company_section_routes SET route_mode=mode_v,auto_send=send_v,document_template=p_template,
   updated_by=auth.uid(),updated_at=clock_timestamp(),assigned_supplier_ids=ids WHERE id=route_v.id RETURNING * INTO route_v;
 END IF;
 DELETE FROM public.proc_company_section_route_suppliers WHERE route_id=route_v.id;
 FOREACH sid IN ARRAY recipients LOOP INSERT INTO public.proc_company_section_route_suppliers(route_id,supplier_id,sort_order)
  VALUES(route_v.id,sid,array_position(recipients,sid));END LOOP;
 -- Only an explicitly saved company-wide list updates the legacy default. Category overrides stay independent.
 IF p_section_id IS NULL THEN
  UPDATE public.proc_companies SET default_supplier_id=CASE WHEN cardinality(ids)=1 THEN ids[1] ELSE NULL END,updated_at=clock_timestamp() WHERE id=p_company_id;
 END IF;
 IF send_v THEN UPDATE public.proc_companies SET group_auto_approve=true,automation_admin_id=auth.uid(),updated_at=clock_timestamp() WHERE id=p_company_id;END IF;
 UPDATE public.proc_companies SET updated_at=clock_timestamp() WHERE id=p_company_id;
 RETURN jsonb_build_object('id',route_v.id,'updated_at',route_v.updated_at,'assigned_supplier_ids',ids,'recipient_ids',recipients,'action',p_action);
END $$;

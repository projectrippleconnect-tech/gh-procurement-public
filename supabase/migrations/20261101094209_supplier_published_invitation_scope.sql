-- Reusable accounts may discover only published supplier invitations.
-- Explicit RFQ bearer links remain separately staff-issued and phone verified.

CREATE OR REPLACE FUNCTION private.proc_supplier_quote_link(p_ident jsonb,p_invitation uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE lid uuid; actor uuid;
BEGIN
 IF p_ident->>'kind'='quote' THEN RETURN (p_ident->>'link_id')::uuid; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.proc_rfq_suppliers rs JOIN public.proc_rfqs r ON r.id=rs.rfq_id WHERE rs.id=p_invitation AND rs.supplier_id=(p_ident->>'supplier_id')::uuid AND rs.status IN ('sent','quoted') AND r.status IN ('sent','partially_quoted','quoted')) THEN RAISE EXCEPTION 'Supplier invitation unavailable' USING ERRCODE='42501'; END IF;
 SELECT l.id INTO lid FROM public.proc_rfq_suppliers rs LEFT JOIN public.proc_supplier_portal_links l ON l.rfq_supplier_id=rs.id
 WHERE rs.id=p_invitation AND rs.supplier_id=(p_ident->>'supplier_id')::uuid;
 IF NOT FOUND THEN RAISE EXCEPTION 'Supplier invitation unavailable' USING ERRCODE='42501'; END IF;
 IF lid IS NULL THEN
  SELECT created_by INTO actor FROM private.proc_supplier_accounts WHERE id=(p_ident->>'account_id')::uuid;
  -- RFQ precedes portal-link locks throughout intake and award processing.
  PERFORM 1 FROM public.proc_rfqs r JOIN public.proc_rfq_suppliers rs ON rs.rfq_id=r.id WHERE rs.id=p_invitation AND r.status IN ('draft','prepared','sent','partially_quoted','quoted') FOR UPDATE OF r;
  IF NOT FOUND THEN RAISE EXCEPTION 'RFQ closed'; END IF;
  INSERT INTO public.proc_supplier_portal_links(rfq_supplier_id,token_hash,closes_at,created_by,verification_required)
  VALUES(p_invitation,encode(extensions.digest(extensions.gen_random_bytes(32),'sha256'),'hex'),clock_timestamp()+interval '6 hours',actor,true)
  ON CONFLICT(rfq_supplier_id) DO NOTHING;
  SELECT id INTO lid FROM public.proc_supplier_portal_links WHERE rfq_supplier_id=p_invitation;
 END IF;
 RETURN lid;
END $$;

CREATE OR REPLACE FUNCTION public.proc_supplier_account_read_v1(p_token text,p_session text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ident jsonb; sid uuid;
BEGIN
 ident:=private.proc_supplier_session(p_token,p_session);IF ident->>'kind'<>'account' THEN RAISE EXCEPTION 'Reusable supplier account required'; END IF;sid:=(ident->>'supplier_id')::uuid;
 RETURN jsonb_build_object('supplier',(SELECT name FROM public.proc_suppliers WHERE id=sid),
 'requests',(SELECT coalesce(jsonb_agg(jsonb_build_object('invitation',rs.id,'number',r.rfq_no,'status',r.status,'closes_at',l.closes_at,'revoked',l.revoked_at IS NOT NULL) ORDER BY r.created_at DESC),'[]') FROM public.proc_rfq_suppliers rs JOIN public.proc_rfqs r ON r.id=rs.rfq_id LEFT JOIN public.proc_supplier_portal_links l ON l.rfq_supplier_id=rs.id WHERE rs.supplier_id=sid AND rs.status IN ('sent','quoted') AND r.status IN ('sent','partially_quoted','quoted')),
 'items',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'description',i.description,'size',i.size,'uom',i.uom) ORDER BY i.description),'[]') FROM public.proc_items i WHERE i.active AND EXISTS(SELECT 1 FROM public.proc_requirements q JOIN public.proc_rfq_items ri ON ri.requirement_id=q.id JOIN public.proc_rfq_suppliers rs ON rs.rfq_id=ri.rfq_id WHERE q.item_id=i.id AND rs.supplier_id=sid AND rs.status IN ('sent','quoted') AND EXISTS(SELECT 1 FROM public.proc_rfqs published WHERE published.id=rs.rfq_id AND published.status NOT IN ('draft','prepared')) AND (rs.requested_item_ids IS NULL OR ri.id=ANY(rs.requested_item_ids)))),
 'standing',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC),'[]') FROM (SELECT * FROM private.proc_supplier_standing_prices WHERE supplier_id=sid ORDER BY created_at DESC LIMIT 20) p));
END $$;

CREATE OR REPLACE FUNCTION public.proc_supplier_standing_save_v1(p_token text,p_session text,p_id uuid,p_expected_revision integer,p_lines jsonb,p_valid_until timestamptz,p_confirm boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ident jsonb; sid uuid; saved private.proc_supplier_standing_prices; line jsonb; item public.proc_items; ids uuid[]:='{}'; snaps jsonb:='[]'; amount numeric; available numeric;
BEGIN
 ident:=private.proc_supplier_session(p_token,p_session);IF ident->>'kind'<>'account' THEN RAISE EXCEPTION 'Reusable supplier account required'; END IF;sid:=(ident->>'supplier_id')::uuid;
 IF p_lines IS NULL OR jsonb_typeof(p_lines)<>'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 100 OR octet_length(p_lines::text)>100000 THEN RAISE EXCEPTION 'Choose 1–100 standing-price items'; END IF;
 IF p_valid_until IS NULL OR p_valid_until<=clock_timestamp() OR p_valid_until>clock_timestamp()+interval '90 days' THEN RAISE EXCEPTION 'Validity must end within the next 90 days'; END IF;
 FOR line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
  SELECT * INTO item FROM public.proc_items WHERE id=(line->>'item_id')::uuid AND active;
  IF item.id IS NULL OR item.id=ANY(ids) OR line->>'uom' IS DISTINCT FROM item.uom OR NOT EXISTS(SELECT 1 FROM public.proc_requirements q JOIN public.proc_rfq_items ri ON ri.requirement_id=q.id JOIN public.proc_rfq_suppliers rs ON rs.rfq_id=ri.rfq_id WHERE q.item_id=item.id AND rs.supplier_id=sid AND rs.status IN ('sent','quoted') AND EXISTS(SELECT 1 FROM public.proc_rfqs published WHERE published.id=rs.rfq_id AND published.status NOT IN ('draft','prepared')) AND (rs.requested_item_ids IS NULL OR ri.id=ANY(rs.requested_item_ids))) THEN RAISE EXCEPTION 'Uninvited, duplicate or changed item/unit'; END IF;
  amount:=(line->>'price')::numeric;available:=(line->>'quantity')::numeric;
  IF amount IS NULL OR amount<=0 OR amount::text IN ('NaN','Infinity','-Infinity') OR round(amount,2)<>amount OR available IS NULL OR available<=0 OR available::text IN ('NaN','Infinity','-Infinity') OR round(available,3)<>available OR length(coalesce(line->>'notes',''))>400 THEN RAISE EXCEPTION 'Valid price, available quantity and short remarks required'; END IF;
  ids:=array_append(ids,item.id);snaps:=snaps||jsonb_build_array(jsonb_build_object('item_id',item.id,'description',item.description,'size',item.size,'uom',item.uom));
 END LOOP;
 PERFORM pg_advisory_xact_lock(hashtextextended('supplier-standing:'||sid::text,0));
 IF p_id IS NULL THEN
  IF p_expected_revision<>0 OR p_expected_revision IS NULL OR (SELECT count(*) FROM private.proc_supplier_standing_prices WHERE supplier_id=sid AND state='draft')>=5 THEN RAISE EXCEPTION 'Use an existing draft or refresh the revision'; END IF;
  INSERT INTO private.proc_supplier_standing_prices(supplier_id) VALUES(sid) RETURNING * INTO saved;
 ELSE SELECT * INTO saved FROM private.proc_supplier_standing_prices WHERE id=p_id AND supplier_id=sid FOR UPDATE; END IF;
 IF saved.id IS NULL OR saved.state<>'draft' OR saved.revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'Standing-price version changed or is already submitted'; END IF;
 UPDATE private.proc_supplier_standing_prices SET revision=revision+1,lines=p_lines,snapshots=snaps,valid_until=p_valid_until,state=CASE WHEN p_confirm THEN 'submitted' ELSE 'draft' END,updated_at=clock_timestamp() WHERE id=saved.id RETURNING * INTO saved;
 RETURN to_jsonb(saved);
END $$;

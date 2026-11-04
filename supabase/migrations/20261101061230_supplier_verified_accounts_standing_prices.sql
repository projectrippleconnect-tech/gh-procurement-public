-- Stage 3 is additive and opt-in for new verified links. Existing links keep their
-- original deadline and can be revoked by staff. No orders or messages are created.
ALTER TABLE public.proc_supplier_portal_links ADD COLUMN verification_required boolean NOT NULL DEFAULT false;
CREATE TABLE private.proc_supplier_accounts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), supplier_id uuid NOT NULL UNIQUE REFERENCES public.proc_suppliers(id),
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[0-9a-f]{64}$'), revoked_at timestamptz,
 created_by uuid NOT NULL REFERENCES public.proc_profiles(id), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE private.proc_supplier_challenges(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token_hash text NOT NULL, supplier_id uuid NOT NULL REFERENCES public.proc_suppliers(id),
 phone text NOT NULL, code_hash text, issued_at timestamptz, delivered_at timestamptz,
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '5 minutes',
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5), used_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ON private.proc_supplier_challenges(supplier_id,created_at);
CREATE TABLE private.proc_supplier_sessions(
 token_hash text PRIMARY KEY, access_hash text NOT NULL, supplier_id uuid NOT NULL REFERENCES public.proc_suppliers(id),
 phone text NOT NULL, expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '12 hours'
);
CREATE TABLE private.proc_supplier_standing_prices(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), supplier_id uuid NOT NULL REFERENCES public.proc_suppliers(id),
 revision integer NOT NULL DEFAULT 0, state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','submitted','approved','rejected','superseded')),
 valid_until timestamptz, lines jsonb NOT NULL DEFAULT '[]', snapshots jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 approved_by uuid REFERENCES public.proc_profiles(id), approved_at timestamptz,
 CHECK(jsonb_typeof(lines)='array' AND jsonb_array_length(lines)<=100)
);
ALTER TABLE private.proc_supplier_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.proc_supplier_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.proc_supplier_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.proc_supplier_standing_prices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.proc_supplier_accounts,private.proc_supplier_challenges,private.proc_supplier_sessions,private.proc_supplier_standing_prices FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.proc_supplier_revoke_changed_phone() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.phone IS DISTINCT FROM OLD.phone OR NEW.whatsapp IS DISTINCT FROM OLD.whatsapp OR NEW.active IS DISTINCT FROM OLD.active THEN
  DELETE FROM private.proc_supplier_sessions WHERE supplier_id=NEW.id;
  UPDATE private.proc_supplier_challenges SET used_at=clock_timestamp() WHERE supplier_id=NEW.id AND used_at IS NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER supplier_phone_session_revocation AFTER UPDATE OF phone,whatsapp,active ON public.proc_suppliers FOR EACH ROW EXECUTE FUNCTION private.proc_supplier_revoke_changed_phone();

CREATE FUNCTION private.proc_supplier_phone(p_phone text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN regexp_replace(coalesce(p_phone,''),'[^0-9]','','g') ~ '^0[0-9]{9}$'
 THEN '+94'||substr(regexp_replace(p_phone,'[^0-9]','','g'),2)
 ELSE '+'||regexp_replace(coalesce(p_phone,''),'[^0-9]','','g') END
$$;
CREATE FUNCTION private.proc_supplier_identity(p_token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h text; result jsonb;
BEGIN
 IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
 h:=encode(extensions.digest(p_token,'sha256'),'hex');
 SELECT jsonb_build_object('supplier_id',s.id,'phone',private.proc_supplier_phone(coalesce(nullif(s.whatsapp,''),s.phone)),
 'kind','account','account_id',a.id,'hash',h) INTO result
 FROM private.proc_supplier_accounts a JOIN public.proc_suppliers s ON s.id=a.supplier_id
 WHERE a.token_hash=h AND a.revoked_at IS NULL AND s.active;
 IF result IS NULL THEN
  SELECT jsonb_build_object('supplier_id',s.id,'phone',private.proc_supplier_phone(coalesce(nullif(s.whatsapp,''),s.phone)),
  'kind','quote','link_id',l.id,'hash',h) INTO result
  FROM public.proc_supplier_portal_links l JOIN public.proc_rfq_suppliers rs ON rs.id=l.rfq_supplier_id
  JOIN public.proc_suppliers s ON s.id=rs.supplier_id
  WHERE l.token_hash=h AND l.revoked_at IS NULL AND l.closes_at>clock_timestamp() AND s.active;
 END IF;
 RETURN result;
END $$;
CREATE FUNCTION private.proc_supplier_session(p_token text,p_session text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ident jsonb;
BEGIN
 ident:=private.proc_supplier_identity(p_token);
 IF ident IS NULL OR p_session IS NULL OR p_session !~ '^[0-9a-f]{64}$' OR NOT EXISTS(
 SELECT 1 FROM private.proc_supplier_sessions s WHERE s.token_hash=encode(extensions.digest(p_session,'sha256'),'hex')
 AND s.access_hash=ident->>'hash' AND s.supplier_id=(ident->>'supplier_id')::uuid
 AND s.phone=ident->>'phone' AND s.expires_at>clock_timestamp()) THEN
 RAISE EXCEPTION 'Phone verification required' USING ERRCODE='42501'; END IF;
 RETURN ident;
END $$;

-- Retain the existing intake validation, locking, revision/history and sync logic.
-- Only trusted private callers can use the explicit link id; public entry points
-- below resolve ownership first. No client-supplied SQL context is trusted.
DO $copy$ DECLARE d text; n text; sig text; BEGIN
 FOR n,sig IN SELECT * FROM (VALUES
 ('read','public.proc_portal_read_v1(text)'),
 ('intake','private.proc_portal_intake_v1(text,jsonb,integer,boolean)'),
 ('submit','public.proc_portal_submit_v1(text,jsonb,integer,boolean)')) x(n,sig)
 LOOP
  d:=pg_get_functiondef(sig::regprocedure);
  d:=regexp_replace(d,'(public|private)\.proc_portal_(read|intake|submit)_v1\(', 'private.proc_supplier_'||n||'_core(');
  d:=replace(d,E')\n RETURNS',E', p_link_id uuid DEFAULT NULL)\n RETURNS');
  d:=regexp_replace(d,'if p_token is null[^;]*? then',
  'if p_link_id is null and (p_token is null or p_token!~''^[0-9a-f]{64}$'') then','i');
  d:=replace(d,'l.token_hash=encode(extensions.digest(p_token,''sha256''),''hex'')',
  '(l.id=p_link_id OR p_link_id IS NULL AND l.token_hash=encode(extensions.digest(p_token,''sha256''),''hex''))');
  d:=replace(d,'private.proc_portal_intake_v1(p_token,p_response,p_expected_revision,p_confirm)',
  'private.proc_supplier_intake_core(p_token,p_response,p_expected_revision,p_confirm,p_link_id)');
  IF d NOT LIKE '%p_link_id uuid DEFAULT NULL%' OR d NOT LIKE '%l.id=p_link_id%' THEN RAISE EXCEPTION 'Portal core signature changed; review migration'; END IF;
  EXECUTE d;
 END LOOP;
END $copy$;

CREATE OR REPLACE FUNCTION public.proc_portal_read_v1(p_token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.proc_supplier_portal_links WHERE token_hash=encode(extensions.digest(p_token,'sha256'),'hex') AND verification_required) THEN
 RETURN jsonb_build_object('verification_required',true); END IF;
 RETURN private.proc_supplier_read_core(p_token,NULL);
END $$;
CREATE OR REPLACE FUNCTION public.proc_portal_submit_v1(p_token text,p_response jsonb,p_expected_revision integer,p_confirm boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.proc_supplier_portal_links WHERE token_hash=encode(extensions.digest(p_token,'sha256'),'hex') AND verification_required) THEN
 RAISE EXCEPTION 'Phone verification required' USING ERRCODE='42501'; END IF;
 RETURN private.proc_supplier_submit_core(p_token,p_response,p_expected_revision,p_confirm,NULL);
END $$;
CREATE FUNCTION public.proc_portal_issue_verified_link_v1(p_rfq_supplier_id uuid,p_token_hash text,p_hours integer DEFAULT 6)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 result:=public.proc_portal_issue_link_v1(p_rfq_supplier_id,p_token_hash,p_hours);
 IF NOT EXISTS(SELECT 1 FROM public.proc_rfq_suppliers rs JOIN public.proc_suppliers s ON s.id=rs.supplier_id
 WHERE rs.id=p_rfq_supplier_id AND s.active AND private.proc_supplier_phone(coalesce(nullif(s.whatsapp,''),s.phone)) ~ '^\+94[0-9]{9}$') THEN RAISE EXCEPTION 'Set a valid directory phone before issuing a verified link'; END IF;
 UPDATE public.proc_supplier_portal_links SET verification_required=true WHERE rfq_supplier_id=p_rfq_supplier_id;
 RETURN result||jsonb_build_object('verification_required',true);
END $$;

CREATE FUNCTION public.proc_supplier_request_code_v1(p_token text,p_phone text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ident jsonb; cid uuid;
BEGIN
 ident:=private.proc_supplier_identity(p_token);
 IF ident IS NULL OR private.proc_supplier_phone(p_phone)<>ident->>'phone' OR ident->>'phone' !~ '^\+94[0-9]{9}$' THEN
 RETURN jsonb_build_object('ok',false,'error','Check the link and supplier directory phone number.'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('supplier-otp:'||(ident->>'supplier_id'),0));
 DELETE FROM private.proc_supplier_challenges WHERE supplier_id=(ident->>'supplier_id')::uuid AND created_at<clock_timestamp()-interval '7 days';
 IF EXISTS(SELECT 1 FROM private.proc_supplier_challenges WHERE supplier_id=(ident->>'supplier_id')::uuid AND created_at>clock_timestamp()-interval '60 seconds')
 OR (SELECT count(*) FROM private.proc_supplier_challenges WHERE supplier_id=(ident->>'supplier_id')::uuid AND created_at>clock_timestamp()-interval '1 hour')>=6 THEN
 RETURN jsonb_build_object('ok',false,'error','Please wait before requesting another code.'); END IF;
 UPDATE private.proc_supplier_challenges SET used_at=clock_timestamp() WHERE supplier_id=(ident->>'supplier_id')::uuid AND token_hash=ident->>'hash' AND used_at IS NULL;
 INSERT INTO private.proc_supplier_challenges(token_hash,supplier_id,phone) VALUES(ident->>'hash',(ident->>'supplier_id')::uuid,ident->>'phone') RETURNING id INTO cid;
 RETURN jsonb_build_object('ok',true,'challenge_id',cid,'expires_in',300,'method','admin_whatsapp');
END $$;
CREATE FUNCTION public.proc_supplier_issue_code_v1(p_challenge_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c private.proc_supplier_challenges; code text; bytes bytea;
BEGIN
 PERFORM private.proc_assert_access();
 IF auth.uid() IS NULL OR NOT private.proc_has_permission('procurement.rfq.manage') THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM private.proc_supplier_challenges WHERE id=p_challenge_id FOR UPDATE;
 IF NOT FOUND OR c.used_at IS NOT NULL OR c.expires_at<=clock_timestamp() OR c.issued_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.proc_suppliers s WHERE s.id=c.supplier_id AND s.active AND private.proc_supplier_phone(coalesce(nullif(s.whatsapp,''),s.phone))=c.phone) THEN RAISE EXCEPTION 'Request expired, already issued or directory number changed'; END IF;
 bytes:=extensions.gen_random_bytes(4);
 code:=lpad(((get_byte(bytes,0)::bigint*16777216+get_byte(bytes,1)*65536+get_byte(bytes,2)*256+get_byte(bytes,3))%1000000)::text,6,'0');
 UPDATE private.proc_supplier_challenges SET issued_at=clock_timestamp(),code_hash=encode(extensions.digest(c.id::text||':'||c.phone||':'||code,'sha256'),'hex') WHERE id=c.id;
 RETURN jsonb_build_object('challenge_id',c.id,'phone',c.phone,'code',code,'expires_at',c.expires_at);
END $$;
CREATE FUNCTION public.proc_supplier_mark_code_sent_v1(p_challenge_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM private.proc_assert_access();
 IF auth.uid() IS NULL OR NOT private.proc_has_permission('procurement.rfq.manage') THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 UPDATE private.proc_supplier_challenges SET delivered_at=clock_timestamp() WHERE id=p_challenge_id AND issued_at IS NOT NULL AND used_at IS NULL AND expires_at>clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION 'Code request expired'; END IF; RETURN true;
END $$;
CREATE FUNCTION public.proc_supplier_verify_code_v1(p_token text,p_challenge_id uuid,p_code text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c private.proc_supplier_challenges; ident jsonb; session_token text;
BEGIN
 ident:=private.proc_supplier_identity(p_token);
 SELECT * INTO c FROM private.proc_supplier_challenges WHERE id=p_challenge_id FOR UPDATE;
 IF ident IS NULL OR c.id IS NULL OR c.token_hash<>ident->>'hash' OR c.phone<>ident->>'phone' OR c.supplier_id<>(ident->>'supplier_id')::uuid OR c.used_at IS NOT NULL OR c.expires_at<=clock_timestamp() OR c.attempts>=5 OR c.delivered_at IS NULL THEN RETURN jsonb_build_object('ok',false,'error','Request a new code or wait for GH to send it.'); END IF;
 UPDATE private.proc_supplier_challenges SET attempts=attempts+1 WHERE id=c.id;
 IF p_code IS NULL OR p_code !~ '^[0-9]{6}$' OR c.code_hash IS DISTINCT FROM encode(extensions.digest(c.id::text||':'||c.phone||':'||p_code,'sha256'),'hex') THEN RETURN jsonb_build_object('ok',false,'error','Code did not match.','attempts_remaining',4-c.attempts); END IF;
 UPDATE private.proc_supplier_challenges SET used_at=clock_timestamp() WHERE id=c.id;
 DELETE FROM private.proc_supplier_sessions WHERE supplier_id=c.supplier_id AND expires_at<=clock_timestamp();
 session_token:=encode(extensions.gen_random_bytes(32),'hex');
 INSERT INTO private.proc_supplier_sessions(token_hash,access_hash,supplier_id,phone) VALUES(encode(extensions.digest(session_token,'sha256'),'hex'),ident->>'hash',c.supplier_id,c.phone);
 RETURN jsonb_build_object('ok',true,'session',session_token,'expires_in',43200);
END $$;

CREATE FUNCTION public.proc_supplier_account_issue_v1(p_supplier_id uuid,p_token_hash text,p_revoke boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE aid uuid;
BEGIN
 PERFORM private.proc_assert_access();
 IF auth.uid() IS NULL OR NOT private.proc_has_permission('procurement.rfq.manage') THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 IF p_revoke THEN UPDATE private.proc_supplier_accounts SET revoked_at=clock_timestamp(),updated_at=clock_timestamp() WHERE supplier_id=p_supplier_id; RETURN jsonb_build_object('revoked',true); END IF;
 IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' OR NOT EXISTS(SELECT 1 FROM public.proc_suppliers s WHERE s.id=p_supplier_id AND s.active AND private.proc_supplier_phone(coalesce(nullif(s.whatsapp,''),s.phone)) ~ '^\+94[0-9]{9}$') THEN RAISE EXCEPTION 'Active supplier and valid directory phone required'; END IF;
 INSERT INTO private.proc_supplier_accounts(supplier_id,token_hash,created_by) VALUES(p_supplier_id,p_token_hash,auth.uid()) ON CONFLICT(supplier_id) DO UPDATE SET token_hash=excluded.token_hash,revoked_at=NULL,created_by=auth.uid(),updated_at=clock_timestamp() RETURNING id INTO aid;
 RETURN jsonb_build_object('id',aid);
END $$;
CREATE FUNCTION public.proc_supplier_access_staff_v1() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM private.proc_assert_access();
 IF auth.uid() IS NULL OR NOT private.proc_has_permission('procurement.rfq.manage') THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('suppliers',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'phone',coalesce(nullif(s.whatsapp,''),s.phone),'account_id',a.id,'revoked',a.revoked_at IS NOT NULL) ORDER BY s.name),'[]') FROM public.proc_suppliers s LEFT JOIN private.proc_supplier_accounts a ON a.supplier_id=s.id WHERE s.active),
 'challenges',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'supplier',s.name,'phone',c.phone,'issued',c.issued_at IS NOT NULL,'sent',c.delivered_at IS NOT NULL,'expires_at',c.expires_at) ORDER BY c.created_at),'[]') FROM private.proc_supplier_challenges c JOIN public.proc_suppliers s ON s.id=c.supplier_id WHERE c.used_at IS NULL AND c.expires_at>clock_timestamp()),
 'standing',(SELECT coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('supplier_name',s.name) ORDER BY p.created_at DESC),'[]') FROM (SELECT * FROM private.proc_supplier_standing_prices ORDER BY created_at DESC LIMIT 100) p JOIN public.proc_suppliers s ON s.id=p.supplier_id),
 'reuse_requests',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',rs.id,'supplier_id',rs.supplier_id,'number',r.rfq_no,'revision',l.revision) ORDER BY r.created_at DESC),'[]') FROM public.proc_rfq_suppliers rs JOIN public.proc_rfqs r ON r.id=rs.rfq_id JOIN public.proc_supplier_portal_links l ON l.rfq_supplier_id=rs.id WHERE l.status='draft' AND l.response='[]'::jsonb AND l.revoked_at IS NULL AND l.closes_at>clock_timestamp() AND r.status IN ('draft','prepared','sent','partially_quoted','quoted')));
END $$;

CREATE FUNCTION private.proc_supplier_quote_link(p_ident jsonb,p_invitation uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE lid uuid; actor uuid;
BEGIN
 IF p_ident->>'kind'='quote' THEN RETURN (p_ident->>'link_id')::uuid; END IF;
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
CREATE FUNCTION public.proc_supplier_quote_read_v1(p_token text,p_session text,p_invitation uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ident jsonb; lid uuid;
BEGIN
 ident:=private.proc_supplier_session(p_token,p_session);lid:=private.proc_supplier_quote_link(ident,p_invitation);
 RETURN private.proc_supplier_read_core(NULL,lid);
END $$;
CREATE FUNCTION public.proc_supplier_quote_submit_v1(p_token text,p_session text,p_invitation uuid,p_response jsonb,p_expected_revision integer,p_confirm boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ident jsonb; lid uuid;
BEGIN
 ident:=private.proc_supplier_session(p_token,p_session);lid:=private.proc_supplier_quote_link(ident,p_invitation);
 RETURN private.proc_supplier_submit_core(NULL,p_response,p_expected_revision,p_confirm,lid);
END $$;
CREATE FUNCTION public.proc_supplier_account_read_v1(p_token text,p_session text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ident jsonb; sid uuid;
BEGIN
 ident:=private.proc_supplier_session(p_token,p_session);IF ident->>'kind'<>'account' THEN RAISE EXCEPTION 'Reusable supplier account required'; END IF;sid:=(ident->>'supplier_id')::uuid;
 RETURN jsonb_build_object('supplier',(SELECT name FROM public.proc_suppliers WHERE id=sid),
 'requests',(SELECT coalesce(jsonb_agg(jsonb_build_object('invitation',rs.id,'number',r.rfq_no,'status',r.status,'closes_at',l.closes_at,'revoked',l.revoked_at IS NOT NULL) ORDER BY r.created_at DESC),'[]') FROM public.proc_rfq_suppliers rs JOIN public.proc_rfqs r ON r.id=rs.rfq_id LEFT JOIN public.proc_supplier_portal_links l ON l.rfq_supplier_id=rs.id WHERE rs.supplier_id=sid AND r.status IN ('draft','prepared','sent','partially_quoted','quoted')),
 'items',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'description',i.description,'size',i.size,'uom',i.uom) ORDER BY i.description),'[]') FROM public.proc_items i WHERE i.active AND EXISTS(SELECT 1 FROM public.proc_requirements q JOIN public.proc_rfq_items ri ON ri.requirement_id=q.id JOIN public.proc_rfq_suppliers rs ON rs.rfq_id=ri.rfq_id WHERE q.item_id=i.id AND rs.supplier_id=sid AND (rs.requested_item_ids IS NULL OR ri.id=ANY(rs.requested_item_ids)))),
 'standing',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC),'[]') FROM (SELECT * FROM private.proc_supplier_standing_prices WHERE supplier_id=sid ORDER BY created_at DESC LIMIT 20) p));
END $$;
CREATE FUNCTION public.proc_supplier_logout_v1(p_token text,p_session text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM private.proc_supplier_session(p_token,p_session);
 DELETE FROM private.proc_supplier_sessions WHERE token_hash=encode(extensions.digest(p_session,'sha256'),'hex');
 RETURN true;
END $$;

CREATE FUNCTION public.proc_supplier_standing_save_v1(p_token text,p_session text,p_id uuid,p_expected_revision integer,p_lines jsonb,p_valid_until timestamptz,p_confirm boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ident jsonb; sid uuid; saved private.proc_supplier_standing_prices; line jsonb; item public.proc_items; ids uuid[]:='{}'; snaps jsonb:='[]'; amount numeric; available numeric;
BEGIN
 ident:=private.proc_supplier_session(p_token,p_session);IF ident->>'kind'<>'account' THEN RAISE EXCEPTION 'Reusable supplier account required'; END IF;sid:=(ident->>'supplier_id')::uuid;
 IF p_lines IS NULL OR jsonb_typeof(p_lines)<>'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 100 OR octet_length(p_lines::text)>100000 THEN RAISE EXCEPTION 'Choose 1–100 standing-price items'; END IF;
 IF p_valid_until IS NULL OR p_valid_until<=clock_timestamp() OR p_valid_until>clock_timestamp()+interval '90 days' THEN RAISE EXCEPTION 'Validity must end within the next 90 days'; END IF;
 FOR line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
  SELECT * INTO item FROM public.proc_items WHERE id=(line->>'item_id')::uuid AND active;
  IF item.id IS NULL OR item.id=ANY(ids) OR line->>'uom' IS DISTINCT FROM item.uom OR NOT EXISTS(SELECT 1 FROM public.proc_requirements q JOIN public.proc_rfq_items ri ON ri.requirement_id=q.id JOIN public.proc_rfq_suppliers rs ON rs.rfq_id=ri.rfq_id WHERE q.item_id=item.id AND rs.supplier_id=sid AND (rs.requested_item_ids IS NULL OR ri.id=ANY(rs.requested_item_ids))) THEN RAISE EXCEPTION 'Uninvited, duplicate or changed item/unit'; END IF;
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
CREATE FUNCTION public.proc_supplier_standing_review_v1(p_id uuid,p_expected_revision integer,p_approve boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE saved private.proc_supplier_standing_prices;
BEGIN
 PERFORM private.proc_assert_access();
 IF auth.uid() IS NULL OR NOT private.proc_has_permission('procurement.orders.approve') THEN RAISE EXCEPTION 'Order approval permission required' USING ERRCODE='42501'; END IF;
 SELECT supplier_id INTO saved.supplier_id FROM private.proc_supplier_standing_prices WHERE id=p_id;
 IF saved.supplier_id IS NULL THEN RAISE EXCEPTION 'Version unavailable'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('supplier-standing:'||saved.supplier_id::text,0));
 SELECT * INTO saved FROM private.proc_supplier_standing_prices WHERE id=p_id FOR UPDATE;
 IF saved.id IS NULL OR saved.state<>'submitted' OR saved.revision IS DISTINCT FROM p_expected_revision OR saved.valid_until<=clock_timestamp() THEN RAISE EXCEPTION 'Version unavailable, changed or expired'; END IF;
 IF p_approve THEN UPDATE private.proc_supplier_standing_prices SET state='superseded',updated_at=clock_timestamp() WHERE supplier_id=saved.supplier_id AND state='approved'; END IF;
 UPDATE private.proc_supplier_standing_prices SET state=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,approved_by=auth.uid(),approved_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO saved;
 INSERT INTO public.proc_audit_logs(table_name,record_id,action,new_data,user_id) VALUES('proc_supplier_standing_prices',p_id,'REVIEW',to_jsonb(saved),auth.uid());
 RETURN to_jsonb(saved);
END $$;
CREATE FUNCTION public.proc_supplier_standing_reuse_v1(p_id uuid,p_invitation uuid,p_expected_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE saved private.proc_supplier_standing_prices; link public.proc_supplier_portal_links; rs public.proc_rfq_suppliers; response jsonb;
BEGIN
 PERFORM private.proc_assert_access();
 IF auth.uid() IS NULL OR NOT private.proc_has_permission('procurement.rfq.manage') THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 SELECT * INTO saved FROM private.proc_supplier_standing_prices WHERE id=p_id AND state='approved' AND valid_until>clock_timestamp() FOR SHARE;
 SELECT * INTO rs FROM public.proc_rfq_suppliers WHERE id=p_invitation;
 PERFORM 1 FROM public.proc_rfqs WHERE id=rs.rfq_id FOR UPDATE;
 SELECT * INTO link FROM public.proc_supplier_portal_links WHERE rfq_supplier_id=p_invitation FOR UPDATE;
 IF saved.id IS NULL OR rs.id IS NULL OR rs.supplier_id<>saved.supplier_id OR link.id IS NULL OR link.revoked_at IS NOT NULL OR link.closes_at<=clock_timestamp() OR link.status<>'draft' OR link.revision IS DISTINCT FROM p_expected_revision OR link.response<>'[]'::jsonb THEN RAISE EXCEPTION 'Use an empty, current supplier draft and an approved unexpired matching version'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(saved.snapshots) snap JOIN public.proc_items i ON i.id=(snap->>'item_id')::uuid WHERE NOT i.active OR snap->>'description' IS DISTINCT FROM i.description OR snap->>'size' IS DISTINCT FROM i.size OR snap->>'uom' IS DISTINCT FROM i.uom) THEN RAISE EXCEPTION 'Item specifications changed; supplier reconfirmation required'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',ri.id,'status','in_stock','uom',i.uom,'price',line->'price','quantity',line->'quantity','terms_confirmed',false,'confirmation_scope','standing_draft','notes',left('Standing version '||saved.id::text||'. Staff review and supplier final confirmation required. '||coalesce(line->>'notes',''),500))),'[]') INTO response
 FROM public.proc_rfq_items ri JOIN public.proc_requirements q ON q.id=ri.requirement_id JOIN public.proc_items i ON i.id=q.item_id JOIN jsonb_array_elements(saved.lines) line ON (line->>'item_id')::uuid=i.id
 WHERE ri.rfq_id=rs.rfq_id AND (rs.requested_item_ids IS NULL OR ri.id=ANY(rs.requested_item_ids));
 IF jsonb_array_length(response)=0 THEN RAISE EXCEPTION 'No matching invited items'; END IF;
 INSERT INTO public.proc_audit_logs(table_name,record_id,action,new_data,user_id) VALUES('proc_supplier_standing_prices',saved.id,'REUSE',jsonb_build_object('invitation',p_invitation,'revision',saved.revision,'confirmation','draft only'),auth.uid());
 RETURN private.proc_supplier_submit_core(NULL,response,p_expected_revision,false,link.id);
END $$;

-- Explicit function ACLs: private helpers are never a supplier API surface.
DO $acl$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature,n.nspname,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname='private' AND p.proname LIKE 'proc_supplier_%') OR (n.nspname='public' AND p.proname IN ('proc_portal_issue_verified_link_v1','proc_supplier_request_code_v1','proc_supplier_issue_code_v1','proc_supplier_mark_code_sent_v1','proc_supplier_verify_code_v1','proc_supplier_account_issue_v1','proc_supplier_access_staff_v1','proc_supplier_quote_read_v1','proc_supplier_quote_submit_v1','proc_supplier_account_read_v1','proc_supplier_logout_v1','proc_supplier_standing_save_v1','proc_supplier_standing_review_v1','proc_supplier_standing_reuse_v1'))
 LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||f.signature||' FROM PUBLIC,anon,authenticated';
  IF f.nspname='public' THEN
   EXECUTE 'GRANT EXECUTE ON FUNCTION '||f.signature||' TO authenticated';
   IF f.proname IN ('proc_supplier_request_code_v1','proc_supplier_verify_code_v1','proc_supplier_quote_read_v1','proc_supplier_quote_submit_v1','proc_supplier_account_read_v1','proc_supplier_logout_v1','proc_supplier_standing_save_v1') THEN EXECUTE 'GRANT EXECUTE ON FUNCTION '||f.signature||' TO anon'; END IF;
  END IF;
 END LOOP;
END $acl$;

CREATE OR REPLACE FUNCTION public.proc_whatsapp_claim_dispatch(p_rfq_id uuid, p_supplier_id uuid, p_session text, p_image_sha256 text, p_caption text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid;
begin
 if auth.uid() is null or not private.proc_is_role(array['admin','procurement']) or not private.proc_has_permission('procurement.rfq.manage') then raise exception 'Unauthorized WhatsApp dispatch'; end if;
 if length(p_image_sha256)<>64 or length(p_caption)>2000 or length(p_session)>50 then raise exception 'Invalid dispatch fields'; end if;
 if not exists (select 1 from public.proc_rfqs r join public.proc_rfq_suppliers i on i.rfq_id=r.id join public.proc_suppliers s on s.id=i.supplier_id where r.id=p_rfq_id and s.id=p_supplier_id and s.active and i.status in ('pending','prepared') and r.status not in ('awarded','closed','cancelled')) then raise exception 'Supplier not eligible for RFQ'; end if;
 insert into public.proc_whatsapp_rfq_dispatches(rfq_id,supplier_id,sent_by,gateway_session,status,image_sha256,caption) values(p_rfq_id,p_supplier_id,auth.uid(),p_session,'sending',p_image_sha256,p_caption) returning id into v_id;
 return v_id;
end $function$
;

-- Source-only release: apply with the app on an explicitly requested deployment.
-- Read header and lines in one snapshot; all existing writers lock the RFQ row.
create or replace function public.proc_quote_snapshot_v1(p_rfq_id uuid,p_supplier_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare payload jsonb;
begin
 if auth.uid() is null or not (private.proc_has_permission('procurement.rfq.view') or private.proc_has_permission('procurement.rfq.manage')) then
  raise exception 'Quotation access denied' using errcode='42501';
 end if;
 select jsonb_build_object('quote',to_jsonb(q),'lines',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.proc_quote_lines l where l.quote_id=q.id),'[]'::jsonb)) into payload
 from public.proc_quotes q where q.rfq_id=p_rfq_id and q.supplier_id=p_supplier_id;
 payload:=coalesce(payload,jsonb_build_object('quote',null,'lines','[]'::jsonb));
 return payload||jsonb_build_object('revision',md5(payload::text));
end $fn$;
revoke all on function public.proc_quote_snapshot_v1(uuid,uuid) from public,anon;
grant execute on function public.proc_quote_snapshot_v1(uuid,uuid) to authenticated;

create or replace function public.proc_save_quote_guarded_v1(
 p_rfq_id uuid,p_supplier_id uuid,p_expected_revision text,p_quote_ref text,p_lines jsonb,
 p_additional_sizes jsonb default '[]'::jsonb,p_valid_until date default null,p_attachment_path text default null,
 p_notes text default null,p_freight_total numeric default 0,p_minimum_order_value numeric default 0
) returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare snapshot jsonb;
begin
 if auth.uid() is null or not private.proc_has_permission('procurement.rfq.manage') then
  raise exception 'Quotation edit denied' using errcode='42501';
 end if;
 -- Serializes with v3, additional-size saves and award creation, including first saves.
 perform 1 from public.proc_rfqs where id=p_rfq_id for update;
 if not found then raise exception 'RFQ not found'; end if;
 snapshot:=public.proc_quote_snapshot_v1(p_rfq_id,p_supplier_id);
 if p_expected_revision is null or p_expected_revision is distinct from snapshot->>'revision' then
  raise exception 'Saved supplier quotation changed. Your draft is preserved; reload and review before saving.' using errcode='40001';
 end if;
 if jsonb_typeof(p_additional_sizes)<>'array' then raise exception 'Additional sizes must be an array'; end if;
 if jsonb_array_length(p_additional_sizes)>0 then
  return public.proc_save_quote_with_sizes_v1(p_rfq_id,p_supplier_id,p_quote_ref,p_lines,p_additional_sizes,p_valid_until,p_attachment_path,p_notes,p_freight_total,p_minimum_order_value);
 end if;
 return public.proc_save_quote_v3(p_rfq_id,p_supplier_id,p_quote_ref,p_lines,p_valid_until,p_attachment_path,p_notes,p_freight_total,p_minimum_order_value);
end $fn$;
revoke all on function public.proc_save_quote_guarded_v1(uuid,uuid,text,text,jsonb,jsonb,date,text,text,numeric,numeric) from public,anon;
grant execute on function public.proc_save_quote_guarded_v1(uuid,uuid,text,text,jsonb,jsonb,date,text,text,numeric,numeric) to authenticated;

-- Adds deletion controls; no business records are deleted by this migration.
-- Original document references are retained; UUID relationships never change.
create table private.proc_document_counters(kind text primary key,value bigint not null check(value>=0));
alter table private.proc_document_counters enable row level security;
revoke all on private.proc_document_counters from public,anon,authenticated;

create function private.proc_simple_document_number()
returns trigger language plpgsql security definer set search_path='' as $$
declare n bigint; j jsonb;
begin
 insert into private.proc_document_counters(kind,value) values(tg_table_name,1)
 on conflict(kind) do update set value=private.proc_document_counters.value+1 returning value into n;
 j:=jsonb_build_object(tg_argv[0],lpad(n::text,greatest(3,length(n::text)),'0'));
 new:=jsonb_populate_record(new,j);return new;
end $$;
revoke all on function private.proc_simple_document_number() from public,anon,authenticated;

do $$declare t record; guard record; n bigint; previous_uid text:=current_setting('request.jwt.claim.sub',true); admin_id uuid;
begin
 select id into admin_id from public.proc_profiles where active and role_key='admin' limit 1;
 if admin_id is null then raise exception 'An active Super Admin is required to migrate document references';end if;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 for t in select * from (values('proc_rfqs','rfq_no'),('proc_purchase_orders','po_no'),('proc_requirements','requirement_no'),('proc_grns','grn_no'),('proc_stock_counts','count_no')) v(tab,col) loop
  execute format('lock table public.%I in access exclusive mode',t.tab);
  execute format('alter table public.%I add column legacy_document_no text',t.tab);
  -- Only the PO-number immutability guard is paused during the transactional backfill.
  for guard in select tgname from pg_trigger where tgrelid=format('public.%I',t.tab)::regclass and tgfoid='private.proc_po_status_guard()'::regprocedure and not tgisinternal loop
   execute format('alter table public.%I disable trigger %I',t.tab,guard.tgname);
  end loop;
  -- A temporary namespace avoids collisions with existing numeric references.
  execute format('update public.%I set legacy_document_no=%I,%I=''RENUMBER-''||id::text where id is not null',t.tab,t.col,t.col);
  execute format('with ranked as (select id,row_number() over(order by created_at,id) n from public.%I) update public.%I t set %I=lpad(r.n::text,greatest(3,length(r.n::text)),''0'') from ranked r where t.id=r.id',t.tab,t.tab,t.col);
  execute format('select count(*) from public.%I',t.tab) into n;
  insert into private.proc_document_counters values(t.tab,n);
  for guard in select tgname from pg_trigger where tgrelid=format('public.%I',t.tab)::regclass and tgfoid='private.proc_po_status_guard()'::regprocedure and not tgisinternal loop
   execute format('alter table public.%I enable trigger %I',t.tab,guard.tgname);
  end loop;
  execute format('create trigger aa_proc_simple_number before insert on public.%I for each row execute function private.proc_simple_document_number(%L)',t.tab,t.col);
 end loop;
 perform set_config('request.jwt.claim.sub',coalesce(previous_uid,''),true);
end $$;

create function private.proc_record_delete_tables()
returns text[] language sql immutable set search_path='' as $$
 select array['proc_automation_jobs','proc_whatsapp_po_dispatches','proc_whatsapp_rfq_dispatches','proc_po_balance_actions','proc_rejection_cases','proc_grn_lines','proc_grns','proc_invoice_lines','proc_supplier_invoices','proc_po_lines','proc_purchase_orders','proc_awards','proc_quote_lines','proc_quotes','proc_rfq_suppliers','proc_rfq_items','proc_rfqs','proc_item_requests','proc_requirements','proc_company_price_documents','proc_company_price_list_lines','proc_company_price_lists','proc_company_list_items','proc_stock_count_lines','proc_stock_counts','proc_supplier_scopes','proc_companies','proc_suppliers']
$$;
revoke all on function private.proc_record_delete_tables() from public,anon,authenticated;

create function private.proc_record_delete_plan(p_table text,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare allowed text[]:=private.proc_record_delete_tables(); roots text[]:=array['proc_rfqs','proc_purchase_orders','proc_requirements','proc_quotes','proc_supplier_invoices','proc_grns','proc_stock_counts','proc_item_requests','proc_company_price_lists','proc_company_list_items','proc_companies','proc_suppliers']; plan jsonb; prior jsonb; target jsonb; fk record; parent record; ids jsonb; tab text; snapshots jsonb:='{}'; counts jsonb:='{}'; label_v text;
begin
 perform private.proc_assert_data_admin();
 if p_table is null or not p_table=any(roots) then raise exception 'Unsupported record type';end if;
 execute format('select to_jsonb(t) from public.%I t where id=$1',p_table) into target using p_id;
 if target is null then raise exception 'Record no longer exists. Refresh the list.';end if;
 label_v:=coalesce(target->>'supplier_code',target->>'name',target->>'title',target->>'rfq_no',target->>'po_no',target->>'requirement_no',target->>'invoice_no',target->>'grn_no',target->>'count_no',nullif(target->>'quote_ref',''),target->>'id');
 plan:=jsonb_build_object(p_table,jsonb_build_array(p_id));
 loop
  prior:=plan;
  -- Remove complete orders, never just a line/receipt from an otherwise live PO.
  for parent in select * from (values('proc_po_lines'),('proc_grns')) v(tab) loop
   if plan ? parent.tab then
    execute format('select coalesce(jsonb_agg(distinct po_id),''[]''::jsonb) from public.%I where id in(select value::uuid from jsonb_array_elements_text($1)) and po_id is not null',parent.tab) into ids using plan->parent.tab;
    select coalesce(jsonb_agg(distinct value order by value),'[]'::jsonb) into ids from jsonb_array_elements(coalesce(plan->'proc_purchase_orders','[]'::jsonb)||ids);
    if jsonb_array_length(ids)>0 then plan:=jsonb_set(plan,'{proc_purchase_orders}',ids);end if;
   end if;
  end loop;
  for fk in select c.relname child,t.relname parent,a.attname col from pg_constraint f join pg_class c on c.oid=f.conrelid join pg_namespace ns on ns.oid=c.relnamespace join pg_class t on t.oid=f.confrelid join pg_attribute a on a.attrelid=c.oid and a.attnum=f.conkey[1] where f.contype='f' and ns.nspname='public' and c.relname=any(allowed) and t.relname=any(allowed) and cardinality(f.conkey)=1 and cardinality(f.confkey)=1 and not(c.relname='proc_companies' and t.relname='proc_suppliers') loop
   if plan ? fk.parent then
    execute format('select coalesce(jsonb_agg(id),''[]''::jsonb) from public.%I where %I in(select value::uuid from jsonb_array_elements_text($1))',fk.child,fk.col) into ids using plan->fk.parent;
    select coalesce(jsonb_agg(distinct value order by value),'[]'::jsonb) into ids from jsonb_array_elements(coalesce(plan->fk.child,'[]'::jsonb)||ids);
    if jsonb_array_length(ids)>0 then plan:=jsonb_set(plan,array[fk.child],ids);end if;
   end if;
  end loop;
  -- Automation jobs use polymorphic entity IDs rather than foreign keys.
  select coalesce(jsonb_agg(id),'[]'::jsonb) into ids from public.proc_automation_jobs where entity_id in(select x.value::uuid from jsonb_each(plan) e cross join lateral jsonb_array_elements_text(e.value) x(value));
  if jsonb_array_length(ids)>0 then plan:=jsonb_set(plan,'{proc_automation_jobs}',ids);end if;
  exit when plan=prior;
 end loop;
 foreach tab in array allowed loop
  if plan ? tab then
   execute format('select coalesce(jsonb_agg(to_jsonb(t) order by id),''[]''::jsonb) from public.%I t where id in(select value::uuid from jsonb_array_elements_text($1))',tab) into ids using plan->tab;
   snapshots:=snapshots||jsonb_build_object(tab,ids);counts:=counts||jsonb_build_object(tab,jsonb_array_length(ids));
  end if;
 end loop;
 if plan ? 'proc_suppliers' then
  select coalesce(jsonb_agg(to_jsonb(c) order by id),'[]'::jsonb) into ids from public.proc_companies c where default_supplier_id in(select value::uuid from jsonb_array_elements_text(plan->'proc_suppliers'));
  snapshots:=snapshots||jsonb_build_object('company_defaults',ids);
  if jsonb_array_length(ids)>0 then counts:=counts||jsonb_build_object('company_defaults_cleared',jsonb_array_length(ids));end if;
 end if;
 if exists(select 1 from public.proc_whatsapp_po_dispatches where id in(select value::uuid from jsonb_array_elements_text(coalesce(plan->'proc_whatsapp_po_dispatches','[]'))) and status in ('sending','unknown')) or exists(select 1 from public.proc_whatsapp_rfq_dispatches where id in(select value::uuid from jsonb_array_elements_text(coalesce(plan->'proc_whatsapp_rfq_dispatches','[]'))) and status in ('sending','unknown')) then raise exception 'Resolve pending or unknown WhatsApp sends before deleting these records';end if;
 return jsonb_build_object('table',p_table,'id',p_id,'label',label_v,'counts',counts,'plan',plan,'token',md5(snapshots::text));
end $$;
revoke all on function private.proc_record_delete_plan(text,uuid) from public,anon;
grant execute on function private.proc_record_delete_plan(text,uuid) to authenticated;

create function public.proc_admin_record_preview_v1(p_table text,p_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select private.proc_record_delete_plan(p_table,p_id)-'plan'
$$;
revoke all on function public.proc_admin_record_preview_v1(text,uuid) from public,anon;
grant execute on function public.proc_admin_record_preview_v1(text,uuid) to authenticated;

create function private.proc_delete_record(p_table text,p_id uuid,p_token text,p_confirmation text,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare preview jsonb; tab text; req uuid; reqs uuid[];
begin
 perform private.proc_assert_data_admin();
 if length(trim(coalesce(p_reason,'')))<5 then raise exception 'Enter a reason of at least five characters';end if;
 perform pg_advisory_xact_lock(704411);
 -- Same lock order for every deletion/reset. Protect preview against concurrent edits.
 foreach tab in array private.proc_record_delete_tables() loop execute format('lock table public.%I in share row exclusive mode',tab);end loop;
 preview:=private.proc_record_delete_plan(p_table,p_id);
 if p_token is distinct from preview->>'token' then raise exception 'Linked records changed. Review deletion again.';end if;
 if p_confirmation is distinct from 'DELETE '||(preview->>'label') then raise exception 'Type the exact deletion phrase';end if;
 select array_agg(distinct requirement_id) into reqs from (select requirement_id from public.proc_po_lines where po_id in(select value::uuid from jsonb_array_elements_text(coalesce(preview->'plan'->'proc_purchase_orders','[]'))) union select requirement_id from public.proc_rfq_items where id in(select value::uuid from jsonb_array_elements_text(coalesce(preview->'plan'->'proc_rfq_items','[]')))) affected;
 if preview->'plan' ? 'proc_suppliers' then update public.proc_companies set default_supplier_id=null where default_supplier_id in(select value::uuid from jsonb_array_elements_text(preview->'plan'->'proc_suppliers'));end if;
 foreach tab in array private.proc_record_delete_tables() loop
  if preview->'plan' ? tab then execute format('delete from public.%I where id in(select value::uuid from jsonb_array_elements_text($1))',tab) using preview->'plan'->tab;end if;
 end loop;
 foreach req in array coalesce(reqs,array[]::uuid[]) loop
  update public.proc_requirements r set ordered_qty=coalesce((select sum(l.qty-l.cancelled_qty) from public.proc_po_lines l join public.proc_purchase_orders p on p.id=l.po_id where l.requirement_id=req and p.status<>'cancelled'),0),received_qty=coalesce((select sum(gl.accepted_qty) from public.proc_grn_lines gl join public.proc_po_lines l on l.id=gl.po_line_id join public.proc_grns g on g.id=gl.grn_id where l.requirement_id=req and g.status='posted'),0) where r.id=req;
  if exists(select 1 from public.proc_requirements where id=req) then perform public.proc_refresh_requirement_status(req);end if;
 end loop;
 insert into public.proc_audit_logs(table_name,record_id,action,new_data,user_id) values(p_table,p_id,'ADMIN_DELETE',jsonb_build_object('reason',trim(p_reason),'preview',preview-'plan','stock_retained',true),auth.uid());
end $$;
revoke all on function private.proc_delete_record(text,uuid,text,text,text) from public,anon;
grant execute on function private.proc_delete_record(text,uuid,text,text,text) to authenticated;
create function public.proc_admin_delete_record_v1(p_table text,p_id uuid,p_token text,p_confirmation text,p_reason text)
returns void language sql security invoker set search_path='' as $$select private.proc_delete_record(p_table,p_id,p_token,p_confirmation,p_reason)$$;
revoke all on function public.proc_admin_delete_record_v1(text,uuid,text,text,text) from public,anon;
grant execute on function public.proc_admin_delete_record_v1(text,uuid,text,text,text) to authenticated;

create function private.proc_document_delete_admin_guard()
returns trigger language plpgsql security definer set search_path='' as $$begin perform private.proc_assert_data_admin();return old;end$$;
revoke all on function private.proc_document_delete_admin_guard() from public,anon,authenticated;
create trigger a_proc_delete_admin before delete on public.proc_rfqs for each row execute function private.proc_document_delete_admin_guard();
create trigger a_proc_delete_admin before delete on public.proc_purchase_orders for each row execute function private.proc_document_delete_admin_guard();

-- Creation RPCs must return the number assigned by the insert trigger, rather
-- than their obsolete timestamp-based local variable. Preserve all access guards.
do $$declare f record; definition text;begin
 for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('proc_create_rfq_v3','proc_straight_through_stock_count_v1','proc_straight_through_stock_count_v2','proc_receive_po_v2','proc_receive_po_v3') loop
  definition:=pg_get_functiondef(f.oid);
  definition:=regexp_replace(definition,'(insert into public.proc_rfqs\([^;]+;)','\1 select q.rfq_no into rfq_no from public.proc_rfqs q where q.id=rfq_id;','g');
  definition:=regexp_replace(definition,'(insert into public.proc_grns\([^;]+;)','\1 select g.grn_no into gno from public.proc_grns g where g.id=gid;','g');
  execute definition;
 end loop;
end $$;

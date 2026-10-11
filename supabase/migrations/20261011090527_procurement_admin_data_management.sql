-- Adds controls only; this migration does not clear any business records.
create or replace function private.proc_assert_data_admin()
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.proc_profiles p join public.proc_roles r on r.role_key=p.role_key where p.id=auth.uid() and p.active and p.role_key='admin' and r.enabled) then
  raise exception 'Only an active Super Admin can delete items or reset data' using errcode='42501';
 end if;
 perform private.proc_assert_permission('admin.configure_app');
end $$;
revoke all on function private.proc_assert_data_admin() from public,anon,authenticated;

create or replace function private.proc_data_reset_tables(p_scope text)
returns text[] language sql immutable set search_path='' as $$
 select case p_scope
 when 'procurement' then array['proc_automation_jobs','proc_whatsapp_po_dispatches','proc_whatsapp_rfq_dispatches','proc_po_balance_actions','proc_rejection_cases','proc_grn_lines','proc_grns','proc_invoice_lines','proc_supplier_invoices','proc_po_lines','proc_purchase_orders','proc_awards','proc_quote_lines','proc_quotes','proc_rfq_suppliers','proc_rfq_items','proc_rfqs','proc_item_requests','proc_requirements']
 when 'lists' then array['proc_company_price_documents','proc_company_price_list_lines','proc_company_price_lists','proc_company_list_items']
 when 'stock' then array['proc_stock_count_drafts','proc_stock_balances']
 when 'full' then private.proc_data_reset_tables('procurement')||private.proc_data_reset_tables('lists')||array['proc_stock_ledger','proc_stock_count_lines','proc_stock_counts','proc_stock_count_drafts','proc_stock_balances']
 else null end
$$;
revoke all on function private.proc_data_reset_tables(text) from public,anon,authenticated;

create or replace function public.proc_admin_reset_preview_v1(p_scope text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare tables text[]; tab text; n bigint; counts jsonb:='{}'; revision jsonb; result jsonb;
begin
 perform private.proc_assert_data_admin();
 tables:=private.proc_data_reset_tables(p_scope);
 if tables is null then raise exception 'Invalid reset option';end if;
 foreach tab in array tables loop
  execute format('select count(*) from public.%I',tab) into n;
  counts:=counts||jsonb_build_object(tab,n);
 end loop;
 select value into revision from public.proc_settings where key='data_reset_revision';
 result:=jsonb_build_object('scope',p_scope,'counts',counts,'revision',revision);
 return result||jsonb_build_object('token',md5(result::text));
end $$;
revoke all on function public.proc_admin_reset_preview_v1(text) from public,anon;
grant execute on function public.proc_admin_reset_preview_v1(text) to authenticated;

create or replace function public.proc_admin_reset_data_v1(p_scope text,p_token text,p_confirmation text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare tab text; tables text[]; preview jsonb; revision text:=gen_random_uuid()::text;
begin
 perform private.proc_assert_data_admin();
 if p_confirmation is distinct from 'CLEAR '||upper(p_scope) then raise exception 'Type the exact confirmation phrase';end if;
 if length(trim(coalesce(p_reason,'')))<5 then raise exception 'Enter a reason of at least five characters';end if;
 tables:=private.proc_data_reset_tables(p_scope);
 if tables is null then raise exception 'Invalid reset option';end if;
 perform pg_advisory_xact_lock(704411);
 -- Lock the complete operation before preview validation; no partial clears.
 foreach tab in array tables loop execute format('lock table public.%I in share row exclusive mode',tab);end loop;
 preview:=public.proc_admin_reset_preview_v1(p_scope);
 if p_token is distinct from preview->>'token' then raise exception 'Data changed. Preview the reset again.';end if;
 foreach tab in array tables loop
  if tab='proc_stock_balances' and p_scope='stock' then
   insert into public.proc_stock_ledger(item_id,location_id,txn_type,qty_delta,balance_after,source_type,note,created_by)
   select item_id,location_id,'ADJUSTMENT',-qty,0,'admin_reset',trim(p_reason),auth.uid() from public.proc_stock_balances where qty<>0;
   update public.proc_stock_balances set qty=0,last_counted_at=null;
  else execute format('delete from public.%I',tab);end if;
 end loop;
 insert into public.proc_settings(key,value,description) values('data_reset_revision',jsonb_build_object('id',revision,'scope',p_scope,'at',clock_timestamp()),'Invalidates operational browser drafts after admin reset') on conflict(key) do update set value=excluded.value,updated_at=now();
 if p_scope in ('stock','full') then
  insert into public.proc_settings(key,value) values('stock_reset_revision',to_jsonb(revision)) on conflict(key) do update set value=excluded.value,updated_at=now();
 end if;
 if p_scope in ('procurement','full') then
  insert into public.proc_settings(key,value) values('procurement_reset_revision',to_jsonb(revision)) on conflict(key) do update set value=excluded.value,updated_at=now();
 end if;
 insert into public.proc_audit_logs(table_name,action,old_data,new_data,user_id) values('system_reset','RESET',preview,jsonb_build_object('scope',p_scope,'reason',trim(p_reason),'revision',revision),auth.uid());
 return jsonb_build_object('ok',true,'scope',p_scope,'revision',revision);
end $$;
revoke all on function public.proc_admin_reset_data_v1(text,text,text,text) from public,anon;
grant execute on function public.proc_admin_reset_data_v1(text,text,text,text) to authenticated;

create or replace function public.proc_admin_delete_item_v1(p_item_id uuid,p_confirmation text)
returns void language plpgsql security definer set search_path='' as $$
declare item public.proc_items; fk record; used boolean;
begin
 perform private.proc_assert_data_admin();
 select * into item from public.proc_items where id=p_item_id for update;
 if item.id is null then raise exception 'Item not found';end if;
 if p_confirmation is distinct from item.item_code then raise exception 'Type the item code to confirm deletion';end if;
 if exists(select 1 from public.proc_stock_balances where item_id=p_item_id and qty<>0) then raise exception 'Item has current stock. Reset its stock first, or disable it.';end if;
 -- Even cascading references are checked, so deletion never erases business history.
 for fk in select n.nspname schema_name,c.relname table_name,a.attname column_name from pg_constraint f join pg_class c on c.oid=f.conrelid join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum=f.conkey[1] where f.contype='f' and f.confrelid='public.proc_items'::regclass and c.relname<>'proc_stock_balances' loop
  execute format('select exists(select 1 from %I.%I where %I=$1)',fk.schema_name,fk.table_name,fk.column_name) into used using p_item_id;
  if used then raise exception 'Item is used in procurement records or lists. Disable it, or clear those records first.';end if;
 end loop;
 delete from public.proc_items where id=p_item_id;
end $$;
revoke all on function public.proc_admin_delete_item_v1(uuid,text) from public,anon;
grant execute on function public.proc_admin_delete_item_v1(uuid,text) to authenticated;

-- Direct Data API deletion also requires the real admin role.
create or replace function private.proc_item_delete_admin_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin perform private.proc_assert_data_admin();return old;end $$;
revoke all on function private.proc_item_delete_admin_guard() from public,anon,authenticated;
create trigger a_proc_item_delete_admin before delete on public.proc_items for each row execute function private.proc_item_delete_admin_guard();

create or replace function public.proc_admin_clear_po_v1(p_po_id uuid,p_confirmation text,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare po public.proc_purchase_orders; req uuid; quote_ids uuid[]; req_ids uuid[];
begin
 perform private.proc_assert_data_admin();
 select * into po from public.proc_purchase_orders where id=p_po_id for update;
 if po.id is null then raise exception 'Order not found';end if;
 if p_confirmation is distinct from po.po_no or length(trim(coalesce(p_reason,'')))<5 then raise exception 'Enter the PO number and a reason of at least five characters';end if;
 if exists(select 1 from public.proc_grns where po_id=p_po_id) or exists(select 1 from public.proc_supplier_invoices where po_id=p_po_id) then raise exception 'Order has receipts or invoices. Use the admin procurement reset to clear linked history together.';end if;
 if exists(select 1 from public.proc_whatsapp_po_dispatches where po_id=p_po_id and status in ('sending','unknown')) then raise exception 'Resolve the pending WhatsApp dispatch before clearing this order';end if;
 select array_agg(distinct requirement_id),array_agg(distinct source_quote_line_id) into req_ids,quote_ids from public.proc_po_lines where po_id=p_po_id;
 delete from public.proc_whatsapp_po_dispatches where po_id=p_po_id;
 delete from public.proc_po_balance_actions where po_line_id in(select id from public.proc_po_lines where po_id=p_po_id);
 delete from public.proc_po_lines where po_id=p_po_id;
 delete from public.proc_purchase_orders where id=p_po_id;
 delete from public.proc_awards a where a.quote_line_id=any(quote_ids) and not exists(select 1 from public.proc_po_lines l where l.source_quote_line_id=a.quote_line_id);
 foreach req in array coalesce(req_ids,array[]::uuid[]) loop
  update public.proc_requirements r set ordered_qty=coalesce((select sum(l.qty-l.cancelled_qty) from public.proc_po_lines l join public.proc_purchase_orders p on p.id=l.po_id where l.requirement_id=req and p.status<>'cancelled'),0) where r.id=req;
  perform public.proc_refresh_requirement_status(req);
 end loop;
 insert into public.proc_audit_logs(table_name,record_id,action,old_data,new_data,user_id) values('proc_purchase_orders',p_po_id,'ADMIN_CLEAR',to_jsonb(po),jsonb_build_object('reason',trim(p_reason)),auth.uid());
end $$;
revoke all on function public.proc_admin_clear_po_v1(uuid,text,text) from public,anon;
grant execute on function public.proc_admin_clear_po_v1(uuid,text,text) to authenticated;

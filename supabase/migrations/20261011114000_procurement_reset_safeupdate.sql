-- Align Admin reset operations with pg-safeupdate without weakening database safety.
-- This is a function definition only. It NEVER resets business data when applied.
create or replace function public.proc_admin_reset_data_v1(
  p_scope text, p_token text, p_confirmation text, p_reason text
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
 tab text; tables text[]; preview jsonb;
 revision text:=gen_random_uuid()::text;
begin
 perform private.proc_assert_data_admin();
 if p_confirmation is distinct from 'CLEAR '||upper(p_scope) then
  raise exception 'Type the exact confirmation phrase';
 end if;
 if length(trim(coalesce(p_reason,'')))<5 then
  raise exception 'Enter a reason of at least five characters';
 end if;
 tables:=private.proc_data_reset_tables(p_scope);
 if tables is null then raise exception 'Invalid reset option'; end if;
 perform pg_advisory_xact_lock(704411);
 foreach tab in array tables loop
  execute format('lock table public.%I in share row exclusive mode',tab);
 end loop;
 preview:=public.proc_admin_reset_preview_v1(p_scope);
 if p_token is distinct from preview->>'token' then
  raise exception 'Data changed. Preview the reset again.';
 end if;
 foreach tab in array tables loop
  if tab='proc_stock_balances' and p_scope='stock' then
   insert into public.proc_stock_ledger(
    item_id,location_id,txn_type,qty_delta,balance_after,
    source_type,source_id,note,created_by
   )
   select item_id,location_id,'ADJUSTMENT',-qty,0,'admin_reset',
          revision::uuid,trim(p_reason),auth.uid()
   from public.proc_stock_balances where qty<>0;
   update public.proc_stock_balances
   set qty=0,last_counted_at=null
   where qty is distinct from 0 or last_counted_at is not null;
  else
   -- Intentional full-table removal, only after privileged preview confirmation.
   -- The explicit predicate is required by pg-safeupdate.
   execute format('delete from public.%I where ctid is not null',tab);
  end if;
 end loop;
 insert into public.proc_settings(key,value,description)
 values('data_reset_revision',
  jsonb_build_object('id',revision,'scope',p_scope,'at',clock_timestamp()),
  'Invalidates operational browser drafts after admin reset')
 on conflict(key) do update set value=excluded.value,updated_at=now();
 if p_scope in ('stock','full') then
  insert into public.proc_settings(key,value)
  values('stock_reset_revision',to_jsonb(revision))
  on conflict(key) do update set value=excluded.value,updated_at=now();
 end if;
 if p_scope in ('procurement','full') then
  insert into public.proc_settings(key,value)
  values('procurement_reset_revision',to_jsonb(revision))
  on conflict(key) do update set value=excluded.value,updated_at=now();
 end if;
 insert into public.proc_audit_logs(table_name,action,old_data,new_data,user_id)
 values('system_reset','RESET',preview,
        jsonb_build_object('scope',p_scope,'reason',trim(p_reason),
                           'revision',revision),auth.uid());
 return jsonb_build_object('ok',true,'scope',p_scope,'revision',revision);
end
$function$;
revoke all on function public.proc_admin_reset_data_v1(text,text,text,text) from public,anon;
grant execute on function public.proc_admin_reset_data_v1(text,text,text,text) to authenticated;

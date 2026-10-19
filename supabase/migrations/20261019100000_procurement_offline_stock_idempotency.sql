-- GH Procurement offline stock replay. Apply during a reviewed, explicit release only.
-- An operation and its response commit atomically with the existing stock submission.
-- Private receipt data is never exposed through the Supabase Data API.
create table if not exists private.proc_offline_stock_operations (
 operation_id uuid primary key,
 owner_id uuid not null,
 kind text not null check (kind in ('general','company')),
 payload_hash text not null,
 result jsonb not null,
 created_at timestamptz not null default now()
);
create index if not exists proc_offline_stock_operations_owner_idx
 on private.proc_offline_stock_operations(owner_id,created_at);
revoke all on private.proc_offline_stock_operations from public,anon,authenticated;

create or replace function public.proc_submit_offline_stock_v1(
 p_operation_id uuid,
 p_kind text,
 p_lines jsonb,
 p_company_id uuid default null,
 p_category text default '',
 p_started_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path=''
as $offline$
declare
 caller uuid:=auth.uid();
 receipt private.proc_offline_stock_operations;
 hash_v text;
 result_v jsonb;
begin
 if caller is null then raise exception 'Sign in to synchronize stock.' using errcode='42501';end if;
 perform private.proc_assert_access();
 if not private.proc_has_permission('stock.count.enter') then
  raise exception 'Stock count permission required.' using errcode='42501';
 end if;
 if p_operation_id is null or p_kind not in ('general','company') or p_kind is null then
  raise exception 'Invalid stock operation.';
 end if;
 if p_kind='company' and p_company_id is null then raise exception 'Company required.';end if;
 if p_kind='general' and p_company_id is not null then raise exception 'Unexpected company for general stock.';end if;
 if p_lines is null or jsonb_typeof(p_lines)<>'array'
  or jsonb_array_length(p_lines) not between 1 and 1000
  or length(p_lines::text)>250000 then raise exception 'Invalid stock lines.';end if;
 if length(coalesce(p_category,''))>100 then raise exception 'Category too long.';end if;

 hash_v:=md5(concat_ws('|',p_kind,coalesce(p_company_id::text,''),
  coalesce(p_category,''),coalesce(p_started_at::text,''),p_lines::text));
 -- Lock BEFORE checking the receipt, so simultaneous reconnects cannot double-submit.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_operation_id::text));
 select * into receipt from private.proc_offline_stock_operations where operation_id=p_operation_id;
 if found then
  if receipt.owner_id<>caller or receipt.kind<>p_kind or receipt.payload_hash<>hash_v then
   raise exception 'Offline operation identifier already belongs to another submission.' using errcode='23505';
  end if;
  return receipt.result || jsonb_build_object('offline_replayed',true);
 end if;

 if p_kind='general' then
  result_v:=public.proc_submit_stock_and_continue_v3(p_category,p_lines,null,null);
 else
  result_v:=public.proc_submit_company_list_check_v2(p_company_id,p_lines,null,p_started_at);
 end if;
 insert into private.proc_offline_stock_operations(operation_id,owner_id,kind,payload_hash,result)
 values(p_operation_id,caller,p_kind,hash_v,result_v);
 return result_v || jsonb_build_object('offline_replayed',false);
end
$offline$;

revoke all on function public.proc_submit_offline_stock_v1(uuid,text,jsonb,uuid,text,timestamptz) from public,anon;
grant execute on function public.proc_submit_offline_stock_v1(uuid,text,jsonb,uuid,text,timestamptz) to authenticated;

-- Database-owned round processing; no web process, JWT impersonation or HTTP secret.
-- Installing this migration does not schedule or activate purchasing.
begin;

-- Keep one implementation of purchasing safeguards. The existing public entry point
-- retains its authorization checks; only the database owner can call the private core.
do $migration$
declare definition text; staff_guard text := 'if coalesce(auth.role(),'''')<>''service_role'' then perform private.proc_portal_require_staff(''procurement.orders.approve''); end if;';
 approver_guard text := 'if coalesce(auth.role(),'''')<>''service_role'' and auth.uid()<>rd.approved_by then raise exception ''Only the approving admin may process this round''; end if;';
begin
 definition:=pg_catalog.pg_get_functiondef('public.proc_portal_process_round_v1(uuid)'::regprocedure);
 if position(staff_guard in definition)=0 or position(approver_guard in definition)=0 then
  raise exception 'Unexpected round processor definition; review scheduler migration prerequisites';
 end if;
 definition:=replace(definition,'public.proc_portal_process_round_v1(', 'private.proc_portal_process_round_core_v1(');
 definition:=replace(replace(definition,staff_guard,''),approver_guard,'');
 execute definition;
end $migration$;
revoke all on function private.proc_portal_process_round_core_v1(uuid) from public,anon,authenticated,service_role;

create or replace function public.proc_portal_process_round_v1(p_round_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare approver uuid;
begin
 if coalesce(auth.role(),'')<>'service_role' then
  perform private.proc_portal_require_staff('procurement.orders.approve');
  perform pg_advisory_xact_lock(74121,1);
  select approved_by into approver from public.proc_portal_rounds where id=p_round_id for update;
  if not found then raise exception 'Round not found'; end if;
  if auth.uid() is distinct from approver then raise exception 'Only the approving admin may process this round'; end if;
 end if;
 return private.proc_portal_process_round_core_v1(p_round_id);
end $$;
revoke all on function public.proc_portal_process_round_v1(uuid) from public,anon;
grant execute on function public.proc_portal_process_round_v1(uuid) to authenticated,service_role;

create table private.proc_portal_scheduler_control(
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 batch_limit integer not null default 5 check(batch_limit between 1 and 10),
 last_run_at timestamptz,
 last_result jsonb
);
alter table private.proc_portal_scheduler_control enable row level security;
revoke all on private.proc_portal_scheduler_control from public,anon,authenticated,service_role;
insert into private.proc_portal_scheduler_control(singleton) values(true);

-- SECURITY INVOKER is deliberate: a cron job runs as its database owner. API
-- callers have neither execution permission nor access to the activation switch.
create function private.proc_portal_run_due_rounds_v1()
returns jsonb language plpgsql security invoker set search_path='' set statement_timeout='45s' as $$
declare control private.proc_portal_scheduler_control; candidate record; outcome jsonb;
 results jsonb:='[]'::jsonb; failure text;
begin
 if not pg_try_advisory_xact_lock(74121,2) then return jsonb_build_object('status','busy'); end if;
 select * into control from private.proc_portal_scheduler_control where singleton for update;
 if not found or not control.enabled then return jsonb_build_object('status','disabled'); end if;
 for candidate in
  select id from public.proc_portal_rounds where state='open' and closes_at<=clock_timestamp()
  order by closes_at,id limit control.batch_limit
 loop
  begin
   outcome:=private.proc_portal_process_round_core_v1(candidate.id);
   results:=results||jsonb_build_array(jsonb_build_object('round_id',candidate.id,'status',outcome->>'status'));
  exception when others then
   failure:=left(sqlerrm,500);
   update public.proc_portal_rounds set state='exception',result=jsonb_build_object('status','exception','reason',failure)
    where id=candidate.id and state='open';
   if found then
    insert into public.proc_portal_round_audit(round_id,kind,detail)
     values(candidate.id,'exception',jsonb_build_object('reason',failure,'source','database_scheduler'));
   end if;
   results:=results||jsonb_build_array(jsonb_build_object('round_id',candidate.id,'status','exception'));
  end;
 end loop;
 outcome:=jsonb_build_object('status','completed','rounds',results);
 update private.proc_portal_scheduler_control set last_run_at=clock_timestamp(),last_result=outcome where singleton;
 return outcome;
end $$;
revoke all on function private.proc_portal_run_due_rounds_v1() from public,anon,authenticated,service_role;
commit;

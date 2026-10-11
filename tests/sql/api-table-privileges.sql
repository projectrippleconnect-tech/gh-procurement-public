-- Read-only certification assertions; never attempt TRUNCATE on business data.
begin;
set local statement_timeout='15s';
do $test$
declare t record; r text; p text;
begin
  for t in select c.oid,c.relname,c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') and left(c.relname,5)='proc_'
  loop
    if not t.relrowsecurity then raise exception 'RLS disabled: %',t.relname; end if;
    foreach r in array array['anon','authenticated'] loop
      foreach p in array array['TRUNCATE','REFERENCES','TRIGGER'] loop
        if has_table_privilege(r,t.oid,p) then
          raise exception 'Unexpected % privilege for % on %',p,r,t.relname;
        end if;
      end loop;
    end loop;
  end loop;
  if has_table_privilege('anon','public.proc_whatsapp_rfq_dispatches','SELECT') then
    raise exception 'Anonymous dispatch audit read granted';
  end if;
  if not has_table_privilege('authenticated','public.proc_whatsapp_rfq_dispatches','SELECT') then
    raise exception 'Authenticated audit read removed';
  end if;
  foreach p in array array['INSERT','UPDATE','DELETE'] loop
    if has_table_privilege('authenticated','public.proc_whatsapp_rfq_dispatches',p) then
      raise exception 'Browser dispatch mutation privilege: %',p;
    end if;
  end loop;
  if has_function_privilege('authenticated','public.proc_finalize_award_plan_v1(uuid,jsonb)','EXECUTE') then
    raise exception 'Legacy award implementation exposed to browser clients';
  end if;
  if not has_function_privilege('authenticated','public.proc_finalize_award_plan_v2(uuid,jsonb)','EXECUTE') then
    raise exception 'Current award entrypoint removed';
  end if;
end $test$;
select 'PASS: all procurement tables retain RLS; API table-control privileges denied; dispatch audit read preserved' as result;
rollback;
